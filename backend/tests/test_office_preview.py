import os
os.environ['ENV'] = 'test'
os.environ['JWT_SECRET'] = 'test-jwt-secret-must-be-32-chars-long!!'
os.environ['WEBHOOK_SECRET'] = ''
os.environ['ADMIN_USERNAME'] = 'admin'
os.environ['ADMIN_PASSWORD'] = 'admin-test-password'

import pytest
import asyncio
import zipfile
import io

from app.analysis import office_text, extract_text, pdf_text_layer

def test_docx_text_extraction():
    # Construct minimal in-memory docx file
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("word/document.xml", "<w:document><w:body><w:p><w:t>Laporan Keuangan Bulanan 2026</w:t></w:p></w:body></w:document>")
    data = buf.getvalue()
    
    text = office_text(data, "application/octet-stream", "laporan.docx")
    assert "Laporan Keuangan Bulanan 2026" in text

def test_xlsx_text_extraction():
    # Construct minimal in-memory xlsx file
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("xl/sharedStrings.xml", "<sst><si><t>Daftar Inventaris TIK</t></si></sst>")
    data = buf.getvalue()
    
    text = office_text(data, "application/octet-stream", "inventaris.xlsx")
    assert "Daftar Inventaris TIK" in text

def test_pptx_text_extraction():
    # Construct minimal in-memory pptx file
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("ppt/slides/slide1.xml", "<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:t>Presentasi Rapat Koordinasi</a:t></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>")
    data = buf.getvalue()
    
    text = office_text(data, "application/octet-stream", "presentasi.pptx")
    assert "Presentasi Rapat Koordinasi" in text

def test_plain_text_and_csv_extraction():
    data = "Nama,Jumlah,Keterangan\nLaptop,5,Baik\nPrinter,2,Perbaikan".encode("utf-8")
    text, method = asyncio.run(extract_text(data, "text/csv", None, "rekap.csv"))
    assert method == "plain-text"
    assert "Daftar Inventaris" not in text
    assert "Laptop,5,Baik" in text
