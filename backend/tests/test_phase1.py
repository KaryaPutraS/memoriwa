import os
os.environ['ENV'] = 'test'
os.environ['JWT_SECRET'] = 'test-jwt-secret-must-be-32-chars-long!!'
os.environ['WEBHOOK_SECRET'] = ''
os.environ['ADMIN_USERNAME'] = 'admin'
os.environ['ADMIN_PASSWORD'] = 'admin-test-password'

import pytest
import io
import asyncio
from fastapi.testclient import TestClient
import app.auth as auth
auth.init_auth()

from app.main import app
from app.repository import get_repository
import app.analysis as analysis

client = TestClient(app)

def _auth():
    r = client.post('/api/auth/login', json={'username': 'admin', 'password': 'admin-test-password'})
    assert r.status_code == 200
    return {'Authorization': f'Bearer {r.json()["access_token"]}'}

def test_hybrid_relevance_scoring():
    docs = [
        {
            "id": "doc1",
            "filename": "kwitansi_pembelian_semen.pdf",
            "sender": "628123456",
            "metadata": {
                "identity": {
                    "title": "Kwitansi Pembelian Semen Toko Bangunan",
                    "doc_type": "kwitansi",
                    "summary": "Pembelian 50 sak semen gresik senilai Rp 3.500.000",
                    "tags": ["semen", "bangunan", "kwitansi"]
                },
                "extracted_text": "Toko Bangunan Jaya. Kwitansi Lunas Semen Gresik."
            }
        },
        {
            "id": "doc2",
            "filename": "laporan_kegiatan_patroli.pdf",
            "sender": "628999999",
            "metadata": {
                "identity": {
                    "title": "Laporan Patroli Malam Mako",
                    "doc_type": "laporan",
                    "summary": "Patroli rutin keamanan wilayah kantor.",
                    "tags": ["patroli", "keamanan"]
                },
                "extracted_text": "Situasi aman dan kondusif."
            }
        }
    ]
    
    results = analysis.compute_hybrid_relevance("pembelian semen", docs)
    assert len(results) >= 1
    assert results[0]["id"] == "doc1"
    assert results[0]["metadata"]["relevance_score"] > 0.3

def test_hybrid_relevance_edge_cases():
    docs = [
        {"id": "d1", "filename": "empty.pdf", "metadata": {}},
        {"id": "d2", "filename": "laporan.docx", "metadata": {"identity": {"title": "Laporan Tahunan"}}}
    ]
    # Empty query should return original list
    assert len(analysis.compute_hybrid_relevance("", docs)) == 2
    # Symbols only should return original list
    assert len(analysis.compute_hybrid_relevance("!@#$%^&*", docs)) == 2
    # Query matching d2
    res = analysis.compute_hybrid_relevance("laporan", docs)
    assert len(res) >= 1
    assert res[0]["id"] == "d2"

def test_upload_documents_valid():
    headers = _auth()
    file_content = b"Dummy text file for upload testing."
    files = [("files", ("test_upload.txt", io.BytesIO(file_content), "text/plain"))]
    
    response = client.post("/api/documents/upload", files=files, data={"folder": "TestFolder"}, headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["uploaded"] == 1
    doc = data["items"][0]
    assert doc["filename"] == "test_upload.txt"
    assert doc["source"] == "upload"
    
    # Test reading raw uploaded file back
    raw_res = client.get(f"/api/files/{doc['id']}/raw", headers=headers)
    assert raw_res.status_code == 200
    assert raw_res.content == file_content

def test_upload_documents_unicode_and_multiple():
    headers = _auth()
    f1 = ("files", ("Laporan Kegiatan 2026 (Pagi) & Tim.txt", io.BytesIO(b"Isi laporan 1"), "text/plain"))
    f2 = ("files", ("Foto Kegiatan - Bid TIK.png", io.BytesIO(b"PNGFakeDataHeader123"), "image/png"))
    
    response = client.post("/api/documents/upload", files=[f1, f2], data={"folder": "Dokumentasi"}, headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert data["uploaded"] == 2
    filenames = [item["filename"] for item in data["items"]]
    assert "Laporan Kegiatan 2026 (Pagi) & Tim.txt" in filenames
    assert "Foto Kegiatan - Bid TIK.png" in filenames

def test_upload_documents_disallowed_extension():
    headers = _auth()
    file_content = b"echo 'hacked'"
    files = [("files", ("malicious.exe", io.BytesIO(file_content), "application/x-msdownload"))]
    
    response = client.post("/api/documents/upload", files=files, headers=headers)
    assert response.status_code == 400
    assert "not allowed for security reasons" in response.json()["detail"]

def test_export_group_pdf():
    headers = _auth()
    gid = "test_pdf_group_123"
    
    async def _setup():
        repo = await get_repository()
        doc1 = {
            "id": "pdf_doc1",
            "filename": "foto1.jpg",
            "mime_type": "image/jpeg",
            "source": "whatsapp",
            "sender": "62811111",
            "status": "unanalyzed",
            "metadata": {
                "group_id": gid,
                "explanation": "Kegiatan Apel Pagi Bersama\n\nDetail:\n1. Persiapan Mako\n2. Pengarahan Komandan",
                "identity": {
                    "title": "Apel Pagi Tim",
                    "doc_type": "apel pagi",
                    "tags": ["apel", "pagi", "mako"]
                }
            }
        }
        await repo.add_document(doc1)
    
    asyncio.run(_setup())
    
    response = client.get(f"/api/groups/{gid}/export-pdf", headers=headers)
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert len(response.content) > 500

def test_export_group_pdf_not_found():
    headers = _auth()
    response = client.get("/api/groups/non_existent_group_id_99999/export-pdf", headers=headers)
    assert response.status_code == 404

def test_list_documents_semantic_search():
    headers = _auth()
    response = client.get("/api/documents?q=apel", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert len(data["items"]) >= 1
