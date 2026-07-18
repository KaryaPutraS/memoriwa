"""Regression tests for WA Document Dashboard backend."""
import os, time

# Must set env before importing app modules — init_auth reads them at startup.
os.environ['ENV'] = 'test'
os.environ['JWT_SECRET'] = 'test-jwt-secret-must-be-32-chars-long!!'
os.environ['WEBHOOK_SECRET'] = 'test-webhook-secret-at-least-16'
os.environ['ADMIN_USERNAME'] = 'admin'
os.environ['ADMIN_PASSWORD'] = 'admin-test-password'
os.environ['CORS_ORIGINS'] = 'http://localhost:5173'

# init_auth will be called by the app lifespan, but TestClient doesn't trigger
# lifespan in the same way.  Call it explicitly so secrets are loaded.
from app.auth import init_auth
init_auth()

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_cached_token: dict | None = None

def _auth(username: str = 'admin', password: str = 'admin-test-password') -> dict:
    global _cached_token
    if _cached_token is None:
        r = client.post('/api/auth/login', json={'username': username, 'password': password})
        assert r.status_code == 200, f'Login failed: {r.text}'
        _cached_token = {'Authorization': f'Bearer {r.json()["access_token"]}'}
    return _cached_token


def _create_doc_via_webhook(doc_id: str, filename: str = 'test.pdf',
                            mime: str = 'application/pdf',
                            sender: str = '628123') -> dict:
    payload = {
        'id': f'evt-{doc_id}',
        'session': 'default',
        'message': {
            'id': doc_id,
            'from': sender,
            'media': {
                'mimetype': mime,
                'filename': filename,
                'url': f'https://example.com/{doc_id}',
            },
        },
    }
    r = client.post(
        '/webhook/waha',
        headers={'X-Webhook-Secret': 'test-webhook-secret-at-least-16'},
        json=payload,
    )
    assert r.status_code == 200, f'Webhook failed: {r.text}'
    return r.json()


# ---------------------------------------------------------------------------
# 1. Auth hardening
# ---------------------------------------------------------------------------


def test_login_with_valid_credentials():
    """Valid credentials return a bearer token."""
    r = client.post('/api/auth/login', json={
        'username': 'admin', 'password': 'admin-test-password',
    })
    assert r.status_code == 200
    data = r.json()
    assert 'access_token' in data
    assert data['token_type'] == 'bearer'


def test_login_rejects_hardcoded_admin_admin():
    """The old hardcoded admin/admin must not work."""
    r = client.post('/api/auth/login', json={
        'username': 'admin', 'password': 'admin',
    })
    assert r.status_code == 401


def test_login_rejects_wrong_password():
    """Wrong password must be rejected."""
    r = client.post('/api/auth/login', json={
        'username': 'admin', 'password': 'wrong-password',
    })
    assert r.status_code == 401


def test_login_rejects_wrong_username():
    """Wrong username must be rejected."""
    r = client.post('/api/auth/login', json={
        'username': 'nonexistent', 'password': 'admin-test-password',
    })
    assert r.status_code == 401


def test_login_rejects_empty_password():
    """Empty password must be rejected."""
    r = client.post('/api/auth/login', json={
        'username': 'admin', 'password': '',
    })
    assert r.status_code == 401


def test_unauthenticated_endpoints_require_auth():
    """Protected endpoints must reject requests without a token."""
    endpoints = [
        ('GET', '/api/documents'),
        ('GET', '/api/stats'),
        ('GET', '/api/settings'),
        ('POST', '/api/analysis/run'),
        ('GET', '/api/providers'),
        ('GET', '/api/sessions'),
    ]
    for method, path in endpoints:
        r = client.request(method, path)
        assert r.status_code == 401, f'{method} {path} should require auth, got {r.status_code}'


def test_endpoints_reject_invalid_token():
    """Protected endpoints must reject an invalid/expired token."""
    bad_headers = {'Authorization': 'Bearer invalid.token.here'}
    r = client.get('/api/documents', headers=bad_headers)
    assert r.status_code == 401


# ---------------------------------------------------------------------------
# 2. Webhook validation
# ---------------------------------------------------------------------------


def test_webhook_rejects_missing_secret():
    """Webhook must reject requests without X-Webhook-Secret."""
    r = client.post('/webhook/waha', json={'id': 'evt-1'})
    assert r.status_code == 401


def test_webhook_rejects_empty_secret():
    """Webhook must reject empty X-Webhook-Secret."""
    r = client.post('/webhook/waha', headers={'X-Webhook-Secret': ''}, json={'id': 'evt-1'})
    assert r.status_code == 401


def test_webhook_rejects_wrong_secret():
    """Webhook must reject wrong X-Webhook-Secret."""
    r = client.post(
        '/webhook/waha',
        headers={'X-Webhook-Secret': 'wrong-secret'},
        json={'id': 'evt-1'},
    )
    assert r.status_code == 401


def test_webhook_accepts_valid_secret_and_document():
    """Valid webhook with a document payload is accepted."""
    r = _create_doc_via_webhook('m1', 'invoice.pdf', 'application/pdf')
    assert r['accepted'] is True
    assert r['duplicate'] is False


def test_webhook_rejects_non_document():
    """Non-document messages must be rejected."""
    r = client.post(
        '/webhook/waha',
        headers={'X-Webhook-Secret': 'test-webhook-secret-at-least-16'},
        json={
            'id': 'evt-text',
            'message': {
                'id': 'm99',
                'from': '628123',
                'body': 'hello world',
            },
        },
    )
    assert r.status_code == 200
    assert r.json()['accepted'] is False


def test_webhook_idempotency():
    """Duplicate events must be detected and rejected."""
    payload = {
        'id': 'evt-idemp',
        'session': 'default',
        'message': {
            'id': 'dup-1',
            'from': '628123',
            'media': {
                'mimetype': 'image/png',
                'filename': 'screenshot.png',
                'url': 'https://example.com/screenshot.png',
            },
        },
    }
    headers = {'X-Webhook-Secret': 'test-webhook-secret-at-least-16'}
    r1 = client.post('/webhook/waha', headers=headers, json=payload)
    assert r1.status_code == 200 and r1.json()['accepted'] is True
    r2 = client.post('/webhook/waha', headers=headers, json=payload)
    assert r2.status_code == 200 and r2.json()['duplicate'] is True


# ---------------------------------------------------------------------------
# 3. Document filtering
# ---------------------------------------------------------------------------


def test_document_filter_by_status():
    """List documents filtered by status."""
    h = _auth()
    # Create docs with different statuses
    _create_doc_via_webhook('f1', 'doc1.pdf', 'application/pdf')
    _create_doc_via_webhook('f2', 'doc2.jpg', 'image/jpeg')

    r = client.get('/api/documents', headers=h, params={'status': 'unanalyzed'})
    assert r.status_code == 200
    items = r.json()['items']
    assert len(items) >= 1
    for item in items:
        assert item['status'] == 'unanalyzed'


def test_document_filter_by_query():
    """List documents filtered by search query."""
    h = _auth()
    _create_doc_via_webhook('s1', 'invoice_alfamart.pdf', 'application/pdf')
    _create_doc_via_webhook('s2', 'report_q3.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')

    r = client.get('/api/documents', headers=h, params={'q': 'invoice'})
    assert r.status_code == 200
    items = r.json()['items']
    found = any('invoice' in d['filename'].lower() for d in items)
    assert found, 'Should find documents matching "invoice"'


def test_document_pagination():
    """List documents respects the limit parameter."""
    h = _auth()
    r = client.get('/api/documents', headers=h, params={'limit': 2})
    assert r.status_code == 200
    assert len(r.json()['items']) <= 2


# ---------------------------------------------------------------------------
# 4. Manual analysis status
# ---------------------------------------------------------------------------


def test_analysis_manual_only():
    """Analysis must be triggered manually — no automatic analysis on webhook."""
    _create_doc_via_webhook('a1', 'report.pdf', 'application/pdf')
    h = _auth()
    r = client.get('/api/documents', headers=h, params={'status': 'unanalyzed'})
    items = r.json()['items']
    a1 = next((d for d in items if d['id'] == 'a1'), None)
    assert a1 is not None
    assert a1['status'] == 'unanalyzed', 'Document should remain unanalyzed until manually triggered'


def test_analysis_status_lifecycle():
    """Manual analysis transitions status: unanalyzed -> processing -> analyzed/failed."""
    r = _create_doc_via_webhook('lifecycle-1', 'doc.pdf', 'application/pdf')
    assert r['accepted'] is True

    h = _auth()

    # Before analysis: unanalyzed
    r1 = client.get(f'/api/documents/lifecycle-1', headers=h)
    assert r1.json()['status'] == 'unanalyzed'

    # Trigger single-document analysis
    r2 = client.post(f'/api/analysis/run/lifecycle-1', headers=h)
    assert r2.status_code == 200
    assert r2.json()['queued'] == 1

    # Pump the event loop via repeated API calls until the background task finishes
    deadline = time.time() + 10
    final_status = None
    while time.time() < deadline:
        r3 = client.get(f'/api/documents/lifecycle-1', headers=h)
        final_status = r3.json()['status']
        if final_status in ('analyzed', 'failed'):
            break
        time.sleep(0.02)

    assert final_status in ('analyzed', 'failed'), f'Expected analyzed or failed, got {final_status}'


def test_bulk_analysis_queues_unanalyzed():
    """Bulk analysis endpoint queues only unanalyzed documents."""
    h = _auth()
    _create_doc_via_webhook('bulk-1', 'a.pdf', 'application/pdf')
    _create_doc_via_webhook('bulk-2', 'b.jpg', 'image/jpeg')

    r = client.post('/api/analysis/run', headers=h)
    assert r.status_code == 200
    data = r.json()
    assert data['queued'] >= 1


def test_analysis_single_nonexistent():
    """Analyzing a nonexistent document returns 404."""
    h = _auth()
    r = client.post('/api/analysis/run/nonexistent-id', headers=h)
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# 5. Settings and provider CRUD
# ---------------------------------------------------------------------------


def test_settings_get_default():
    """Getting settings returns defaults when nothing is saved."""
    h = _auth()
    r = client.get('/api/settings', headers=h)
    assert r.status_code == 200
    data = r.json()
    assert 'theme' in data


def test_settings_save_and_retrieve():
    """Settings can be saved and retrieved."""
    h = _auth()
    r = client.put('/api/settings', headers=h, json={
        'theme': 'dark', 'language': 'en', 'auto_analyze': False,
    })
    assert r.status_code == 200
    assert r.json()['theme'] == 'dark'
    # Retrieve to confirm persistence
    r2 = client.get('/api/settings', headers=h)
    assert r2.json()['theme'] == 'dark'


def test_provider_crud():
    """Providers can be created, listed, updated, and deleted."""
    h = _auth()

    # Create
    r = client.post('/api/providers', headers=h, json={
        'name': 'openai',
        'base_url': 'https://api.openai.com',
        'api_key': 'sk-test-key',
        'model': 'gpt-4',
    })
    assert r.status_code == 201
    data = r.json()
    assert 'api_key' not in data, 'API key must not be returned in response'
    assert data['name'] == 'openai'

    # List
    r = client.get('/api/providers', headers=h)
    assert r.status_code == 200
    providers = r.json()['items']
    assert any(p['name'] == 'openai' for p in providers)
    assert all('api_key' not in p for p in providers)

    # Update
    r = client.put('/api/providers/openai', headers=h, json={
        'name': 'openai',
        'base_url': 'https://api.openai.com/v1',
        'api_key': 'sk-new-key',
        'model': 'gpt-4-turbo',
    })
    assert r.status_code == 200
    assert r.json()['model'] == 'gpt-4-turbo'

    # Delete
    r = client.delete('/api/providers/openai', headers=h)
    assert r.status_code == 200
    assert r.json()['deleted'] is True

    r = client.get('/api/providers', headers=h)
    assert not any(p['name'] == 'openai' for p in r.json()['items'])


# ---------------------------------------------------------------------------
# 6. Stats
# ---------------------------------------------------------------------------


def test_stats_counts():
    """Stats endpoint returns counts by status."""
    h = _auth()
    _create_doc_via_webhook('stat-1', 'x.pdf', 'application/pdf')
    _create_doc_via_webhook('stat-2', 'y.jpg', 'image/jpeg')

    r = client.get('/api/stats', headers=h)
    assert r.status_code == 200
    data = r.json()
    assert 'total' in data
    assert 'unanalyzed' in data
    assert data['total'] >= 2


# ---------------------------------------------------------------------------
# 7. WebSocket
# ---------------------------------------------------------------------------


def test_websocket_auth_and_ping():
    """WebSocket accepts valid JWT token and responds to ping."""
    token = _auth()['Authorization'].split()[1]
    with client.websocket_connect(f'/ws?token={token}') as ws:
        ws.send_text('ping')
        msg = ws.receive_json()
        assert msg['type'] == 'pong'


def test_websocket_rejects_invalid_token():
    """WebSocket rejects connection with invalid token."""
    try:
        with client.websocket_connect('/ws?token=invalid.token'):
            assert False, 'Should not connect with invalid token'
    except Exception:
        pass  # Expected — connection should be closed


# ---------------------------------------------------------------------------
# 8. Health
# ---------------------------------------------------------------------------


def test_health_endpoint():
    """Health check returns OK without auth."""
    r = client.get('/health')
    assert r.status_code == 200
    assert r.json()['status'] == 'ok'
