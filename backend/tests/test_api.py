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

def test_settings_branding_roundtrip():
    """Logo/favicon data URLs saved via settings must come back on GET."""
    h = _auth()
    r = client.put('/api/settings', headers=h, json={
        'theme': 'dark', 'language': 'id', 'auto_analyze': False,
        'logo_data': 'data:image/png;base64,AA==', 'favicon_data': 'data:image/png;base64,BB=='})
    assert r.status_code == 200
    g = client.get('/api/settings', headers=h).json()
    assert g.get('logo_data') == 'data:image/png;base64,AA=='
    assert g.get('favicon_data') == 'data:image/png;base64,BB=='

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

def test_image_grouping_and_verify():
    """Text after a photo burst groups the images; verify files them without AI."""
    h = _auth()
    _wh('g1', 'foto1.jpg', 'image/jpeg', sender='628999')
    _wh('g2', 'foto2.jpg', 'image/jpeg', sender='628999')
    # first text from the same sender becomes the explanation
    payload = {'id': 'evt-gtext', 'session': 'default', 'message': {'id': 'gtext', 'from': '628999', 'body': 'Giat patroli 21 Juli'}}
    r = client.post('/webhook/waha', json=payload)
    assert r.json().get('accepted') is True and r.json().get('images') == 2
    d1 = client.get('/api/documents/g1', headers=h).json()
    assert d1['metadata']['explanation'] == 'Giat patroli 21 Juli'
    gid = d1['metadata']['group_id']
    assert gid and client.get('/api/documents/g2', headers=h).json()['metadata']['group_id'] == gid
    # text without pending images is still rejected as text-only
    r2 = client.post('/webhook/waha', json={'id': 'evt-solo', 'message': {'id': 'solo1', 'from': '628000', 'body': 'halo'}})
    assert r2.json().get('accepted') is False
    # edit explanation + manual folder for the whole group
    r3 = client.put(f'/api/documents/group/{gid}', headers=h, json={'explanation': 'Giat bhakti sosial', 'folder': 'kegiatan sosial'})
    assert r3.status_code == 200 and r3.json()['updated'] == 2
    # verify -> analyzed, identity from explanation, manual folder as doc_type
    r4 = client.post('/api/documents/verify', headers=h, json={'ids': ['g1', 'g2']})
    assert r4.json()['verified'] == 2
    d1 = client.get('/api/documents/g1', headers=h).json()
    assert d1['status'] == 'analyzed'
    assert d1['metadata']['identity']['summary'] == 'Giat bhakti sosial'
    assert d1['metadata']['identity']['doc_type'] == 'kegiatan sosial'
    assert d1['metadata']['folder'] == 'kegiatan sosial'

def test_webhook_auto_analyze():
    """With auto_analyze on, webhook docs go straight to processing."""
    h = _auth()
    client.put('/api/settings', headers=h, json={'theme': 'dark', 'language': 'id', 'auto_analyze': True})
    try:
        r = _wh('d-auto', 'auto.pdf')
        assert r.get('accepted') is True
        doc = client.get('/api/documents/d-auto', headers=h).json()
        assert doc['status'] in ('processing', 'failed')  # fetch is blocked in tests, either is fine
    finally:
        client.put('/api/settings', headers=h, json={'theme': 'dark', 'language': 'id', 'auto_analyze': False})

def test_office_text_extraction():
    """docx/pptx text is pulled from the OOXML zip without extra deps."""
    import io, zipfile
    from app import analysis

    def make_zip(files: dict) -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, 'w') as zf:
            for name, content in files.items():
                zf.writestr(name, content)
        return buf.getvalue()

    pptx = make_zip({'ppt/slides/slide1.xml': '<p:sld><a:t>Hello</a:t> <a:t>World &amp; Co</a:t></p:sld>',
                     'ppt/slides/slide2.xml': '<p:sld><a:t>Second slide</a:t></p:sld>'})
    text = analysis.office_text(pptx, 'application/vnd.openxmlformats-officedocument.presentationml.presentation')
    assert 'Hello World & Co' in text and 'Second slide' in text

    docx = make_zip({'word/document.xml': '<w:doc><w:p><w:r><w:t>Isi dokumen</w:t></w:r></w:p></w:doc>'})
    assert analysis.office_text(docx, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') == 'Isi dokumen'

    # not a zip / unknown office mime -> empty, never raises
    assert analysis.office_text(b'not a zip', 'application/vnd.openxmlformats-officedocument.presentationml.presentation') == ''
    assert analysis.office_text(pptx, 'application/pdf') == ''

def test_office_extract_via_pipeline():
    """extract_text routes OOXML mimes to office_text."""
    import asyncio, io, zipfile
    from app import analysis
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w') as zf:
        zf.writestr('ppt/slides/slide1.xml', '<p:sld><a:t>Slide content</a:t></p:sld>')
    text, method = asyncio.run(analysis.extract_text(buf.getvalue(), 'application/vnd.openxmlformats-officedocument.presentationml.presentation', None))
    assert method == 'office-text' and 'Slide content' in text

def test_memory_repo_persists_to_file(tmp_path, monkeypatch):
    """Settings/providers/docs must survive a process restart when DATA_FILE is set."""
    import asyncio
    from app.repository import MemoryRepository
    monkeypatch.setenv('DATA_FILE', str(tmp_path / 'state.json'))
    r = MemoryRepository()
    asyncio.run(r.save_settings({'theme': 'dark', 'vision_model': 'vm-x'}))
    asyncio.run(r.add_provider({'id': 'p1', 'name': 'p1', 'kind': 'groq'}))
    asyncio.run(r.add_document({'id': 'doc1', 'filename': 'a.pdf', 'created_at': '2026-01-01'}))
    # new instance (simulates restart) loads the same state
    r2 = MemoryRepository()
    assert asyncio.run(r2.get_settings())['vision_model'] == 'vm-x'
    assert asyncio.run(r2.get_providers())[0]['name'] == 'p1'
    assert asyncio.run(r2.get_document('doc1'))['filename'] == 'a.pdf'

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
    assert r.status_code in (200, 404)

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


def test_delete_document():
    _wh('d-del', 'todelete.pdf')
    h = _auth()
    r = client.delete('/api/documents/d-del', headers=h)
    assert r.status_code == 200 and r.json().get('deleted') is True
    assert client.get('/api/documents/d-del', headers=h).status_code == 404
    # deleting again is a 404, and unauthenticated delete is rejected
    assert client.delete('/api/documents/d-del', headers=h).status_code == 404
    _wh('d-del2', 'todelete2.pdf')
    assert client.delete('/api/documents/d-del2').status_code == 401

def test_websocket_auth():
    # rejected without a token
    connected = True
    try:
        with client.websocket_connect('/ws'):
            pass
    except Exception:
        connected = False
    assert not connected
    # accepted with a valid token, answers ping with pong
    tok = _auth()['Authorization'].split()[1]
    with client.websocket_connect(f'/ws?token={tok}') as ws:
        ws.send_text('ping')
        assert ws.receive_json()['type'] == 'pong'
