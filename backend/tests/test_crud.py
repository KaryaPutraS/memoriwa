"""Tests for the document CRUD actions used by the Files/Inbox UI:
edit one document, bulk move to folder, rename folder, delete group."""
import os
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

def _wh(doc_id: str, filename: str = 'doc.pdf', mime: str = 'application/pdf', sender: str = '628123') -> dict:
    payload = {'id': f'evt-{doc_id}', 'session': 'default',
               'message': {'id': doc_id, 'from': sender,
                           'media': {'mimetype': mime, 'filename': filename,
                                     'url': f'https://example.com/{doc_id}'}}}
    return client.post('/webhook/waha', json=payload).json()

def test_update_document_folder_and_explanation():
    h = _auth()
    _wh('e1', 'surat.pdf')
    r = client.put('/api/documents/e1', headers=h, json={'folder': 'surat masuk', 'explanation': 'Surat undangan rapat'})
    assert r.status_code == 200
    d = client.get('/api/documents/e1', headers=h).json()
    assert d['metadata']['folder'] == 'surat masuk'
    assert d['metadata']['explanation'] == 'Surat undangan rapat'
    # unknown doc -> 404
    assert client.put('/api/documents/nope', headers=h, json={'folder': 'x'}).status_code == 404
    # unauthenticated -> 401
    assert client.put('/api/documents/e1', json={'folder': 'x'}).status_code == 401

def test_update_document_ungroup():
    h = _auth()
    _wh('u1', 'a.jpg', 'image/jpeg', sender='628500')
    _wh('u2', 'b.jpg', 'image/jpeg', sender='628500')
    client.post('/webhook/waha', json={'id': 'evt-utext', 'message': {'id': 'utext', 'from': '628500', 'body': 'Dok giat'}})
    d1 = client.get('/api/documents/u1', headers=h).json()
    assert d1['metadata'].get('group_id')
    # remove u1 from the group
    r = client.put('/api/documents/u1', headers=h, json={'ungroup': True})
    assert r.status_code == 200
    d1 = client.get('/api/documents/u1', headers=h).json()
    assert 'group_id' not in d1['metadata']
    assert 'explanation' not in d1['metadata']
    # u2 still grouped
    assert client.get('/api/documents/u2', headers=h).json()['metadata'].get('group_id')

def test_move_documents_to_folder():
    h = _auth()
    _wh('m1', 'a.pdf'); _wh('m2', 'b.pdf')
    r = client.post('/api/documents/move', headers=h, json={'ids': ['m1', 'm2', 'missing'], 'folder': 'arsip 2026'})
    assert r.status_code == 200 and r.json()['moved'] == 2
    for did in ('m1', 'm2'):
        d = client.get(f'/api/documents/{did}', headers=h).json()
        assert d['metadata']['folder'] == 'arsip 2026'
    assert client.post('/api/documents/move', json={'ids': [], 'folder': 'x'}).status_code == 401

def test_rename_folder():
    h = _auth()
    _wh('r1', 'a.pdf'); _wh('r2', 'b.pdf')
    client.post('/api/documents/move', headers=h, json={'ids': ['r1', 'r2'], 'folder': 'lama'})
    r = client.post('/api/folders/rename', headers=h, json={'old': 'lama', 'new': 'baru'})
    assert r.status_code == 200 and r.json()['renamed'] == 2
    d = client.get('/api/documents/r1', headers=h).json()
    assert d['metadata']['folder'] == 'baru'
    # renaming a folder nobody uses -> 404
    assert client.post('/api/folders/rename', headers=h, json={'old': 'nope', 'new': 'x'}).status_code == 404

def test_delete_group():
    h = _auth()
    _wh('x1', 'p1.jpg', 'image/jpeg', sender='628600')
    _wh('x2', 'p2.jpg', 'image/jpeg', sender='628600')
    client.post('/webhook/waha', json={'id': 'evt-xtext', 'message': {'id': 'xtext', 'from': '628600', 'body': 'hapus saya'}})
    gid = client.get('/api/documents/x1', headers=h).json()['metadata']['group_id']
    r = client.delete(f'/api/documents/group/{gid}', headers=h)
    assert r.status_code == 200 and r.json()['deleted'] == 2
    assert client.get('/api/documents/x1', headers=h).status_code == 404
    assert client.get('/api/documents/x2', headers=h).status_code == 404
    # deleting again -> 404
    assert client.delete(f'/api/documents/group/{gid}', headers=h).status_code == 404
    assert client.delete(f'/api/documents/group/{gid}').status_code == 401
