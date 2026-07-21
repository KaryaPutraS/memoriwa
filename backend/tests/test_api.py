"""Regression tests for MemoriWA backend."""
import os, time
os.environ['ENV'] = 'test'
os.environ['JWT_SECRET'] = 'test-jwt-secret-must-be-32-chars-long!!'
os.environ['WEBHOOK_SECRET'] = ''
os.environ['ADMIN_USERNAME'] = 'admin'
os.environ['ADMIN_PASSWORD'] = 'admin-test-password'
os.environ['CORS_ORIGINS'] = 'http://localhost:5173'

from app.auth import init_auth
init_auth()
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

_cached_token: dict | None = None

def _auth() -> dict:
    global _cached_token
    if _cached_token is None:
        r = client.post('/api/auth/login', json={'username': 'admin', 'password': 'admin-test-password'})
        assert r.status_code == 200, f'Login failed: {r.text}'
        _cached_token = {'Authorization': f'Bearer {r.json()["access_token"]}'}
    return _cached_token

def _wh(doc_id: str, filename: str = 'test.pdf', mime: str = 'application/pdf', sender: str = '628123') -> dict:
    payload = {'id': f'evt-{doc_id}', 'session': 'default', 'message': {'id': doc_id, 'from': sender, 'media': {'mimetype': mime, 'filename': filename, 'url': f'https://example.com/{doc_id}'}}}
    r = client.post('/webhook/waha', json=payload)
    return r.json()

def test_login():
    h = _auth()
    assert 'Authorization' in h

def test_webhook_document_accepted():
    r = _wh('d1', 'laporan.pdf', 'application/pdf')
    assert r.get('accepted') is True

def test_webhook_text_rejected():
    r = _wh('d2', '', 'audio/mp3')
    assert r.get('accepted') is False

def test_webhook_idempotency():
    _wh('d3', 'doc.pdf')
    r2 = _wh('d3', 'doc.pdf')
    assert r2.get('duplicate') is True

def test_list_documents():
    _wh('d4', 'faktur.pdf')
    r = client.get('/api/documents', headers=_auth())
    assert r.status_code == 200
    assert len(r.json()['items']) >= 1

def test_unauthenticated():
    for method, path in [('GET', '/api/documents'), ('GET', '/api/stats'), ('POST', '/api/analysis/run')]:
        r = client.request(method, path)
        assert r.status_code == 401, f'{method} {path} got {r.status_code}'

def test_stats():
    _wh('d5', 'invoice.pdf')
    r = client.get('/api/stats', headers=_auth())
    assert r.status_code == 200
    assert 'total' in r.json()

def test_settings():
    r = client.put('/api/settings', headers=_auth(), json={'theme': 'dark', 'language': 'en', 'auto_analyze': False})
    assert r.status_code == 200

def test_vision_settings_key_never_exposed():
    """Vision OCR config: key is write-only, model/base_url round-trip."""
    import asyncio
    from app import analysis
    from app.repository import get_repository
    h = _auth()
    r = client.put('/api/settings', headers=h, json={
        'theme': 'dark', 'language': 'en', 'auto_analyze': False,
        'vision_base_url': 'https://v.test/v1', 'vision_model': 'vm-x', 'vision_api_key': 'sk-vis'})
    assert r.status_code == 200
    body = r.json()
    assert 'vision_api_key' not in body and 'sk-vis' not in str(body)
    assert body.get('vision_api_key_set') is True
    # GET also never leaks the key
    g = client.get('/api/settings', headers=h).json()
    assert 'vision_api_key' not in g and 'sk-vis' not in str(g)
    assert g.get('vision_api_key_set') is True
    # _vision_config resolves the stored config
    repo = asyncio.run(get_repository())
    cfg = asyncio.run(analysis._vision_config(repo))
    assert cfg is not None
    assert cfg['ocr_model'] == 'vm-x'
    assert cfg['base_url'] == 'https://v.test/v1'
    assert cfg['api_key'] == 'sk-vis'
    # PUT without a key keeps the stored one
    r = client.put('/api/settings', headers=h, json={'theme': 'dark', 'language': 'en', 'auto_analyze': False})
    assert r.json().get('vision_api_key_set') is True
    # cleanup: drop the test key straight from the in-memory store
    if hasattr(repo, 'settings'):
        repo.settings.pop('vision_api_key', None)
        repo.settings.pop('vision_base_url', None)
        repo.settings.pop('vision_model', None)

def test_provider_crud():
    h = _auth()
    r = client.post('/api/providers', headers=h, json={'name': 'test-prov', 'base_url': 'https://api.test.com', 'api_key': 'sk-123', 'model': 'gpt-4'})
    assert r.status_code == 201
    assert 'api_key' not in r.json()
    r = client.get('/api/providers', headers=h)
    assert r.status_code == 200
    assert len(r.json()['items']) >= 1
    r = client.put('/api/providers/test-prov', headers=h, json={'name': 'test-prov', 'base_url': 'https://api.test.com', 'model': 'gpt-4', 'active': True})
    assert r.status_code == 200
    assert r.json().get('active') is True
    r = client.delete('/api/providers/test-prov', headers=h)
    assert r.status_code == 200

def test_provider_presets():
    r = client.get('/api/provider-presets', headers=_auth())
    assert r.status_code == 200
    assert len(r.json()['presets']) >= 7

def test_analysis():
    _wh('d6', 'report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    r = client.post('/api/analysis/run', headers=_auth())
    assert r.status_code == 200

def test_llm_config_uses_settings_model():
    """Identity/summary must use the model configured on the active provider."""
    import asyncio
    from app import analysis
    from app.repository import get_repository
    h = _auth()
    r = client.post('/api/providers', headers=h, json={'name': 'cfg-test', 'kind': 'groq', 'base_url': 'https://api.groq.com/openai/v1', 'api_key': 'gsk-fake', 'model': 'my-chosen-model', 'active': True})
    assert r.status_code == 201
    try:
        cfg = asyncio.run(analysis._llm_config(asyncio.run(get_repository())))
        assert cfg is not None
        assert cfg['text_model'] == 'my-chosen-model'
    finally:
        client.delete('/api/providers/cfg-test', headers=h)

def test_analysis_pipeline_helpers():
    """Unit tests for the free OCR/identity pipeline (no network needed)."""
    import asyncio
    from app import analysis

    # parse_identity tolerates prose + markdown fences around the JSON
    raw = 'Sure! Here is the result:\n```json\n{"title":"Invoice PLN Maret","doc_type":"invoice","tags":["pln","invoice"],"extra":"dropped"}\n```'
    ident = analysis.parse_identity(raw)
    assert ident['title'] == 'Invoice PLN Maret'
    assert ident['doc_type'] == 'invoice'
    assert 'extra' not in ident

    # digital PDF -> text layer extraction without any OCR model
    import fitz
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), 'INVOICE PT Contoh Sejahtera Nomor 001 tanggal 2026-07-01 total Rp 1.500.000')
    pdf_bytes = doc.tobytes()
    text, method = asyncio.run(analysis.extract_text(pdf_bytes, 'application/pdf', None))
    assert method == 'pdf-text'
    assert 'INVOICE' in text

def test_file_download_requires_auth():
    """File proxy must require a Bearer token — no token-in-URL support."""
    _wh('d7', 'gambar.jpg', 'image/jpeg')
    r = client.get('/api/files/d7/raw')
    assert r.status_code == 401
    r = client.get('/api/files/d7/raw?token=whatever')
    assert r.status_code == 401
    r = client.get('/api/files/d7/raw', headers=_auth())
    assert r.status_code == 200

def test_webhook_secret_enforced_when_configured():
    """When WEBHOOK_SECRET is set, webhook rejects callers without the secret."""
    import app.auth as auth_mod
    original = auth_mod.WEBHOOK_SECRET
    auth_mod.WEBHOOK_SECRET = 'test-webhook-secret-123'
    try:
        payload = {'id': 'evt-sec1', 'message': {'id': 'sec1', 'from': '628123', 'media': {'mimetype': 'application/pdf', 'filename': 's.pdf', 'url': 'https://example.com/s.pdf'}}}
        r = client.post('/webhook/waha', json=payload)
        assert r.status_code == 401
        r = client.post('/webhook/waha?secret=wrong', json=payload)
        assert r.status_code == 401
        r = client.post('/webhook/waha?secret=test-webhook-secret-123', json=payload)
        assert r.status_code == 200 and r.json().get('accepted') is True
        r = client.post('/webhook/waha', json={**payload, 'id': 'evt-sec2', 'message': {**payload['message'], 'id': 'sec2'}}, headers={'X-Webhook-Secret': 'test-webhook-secret-123'})
        assert r.status_code == 200 and r.json().get('accepted') is True
    finally:
        auth_mod.WEBHOOK_SECRET = original

