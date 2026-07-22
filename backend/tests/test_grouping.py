"""Regression tests for the photo-burst caption grouping flow.

Covers the real-world failure: production WAHA nests the message under the
'payload' key, which the webhook previously never inspected for text — so
the first text after a photo burst never grouped the photos.
"""
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

def _nested_photo(doc_id: str, sender: str = '628777@c.us', body: str = '') -> dict:
    """A photo message in the REAL WAHA shape: everything under 'payload'."""
    msg = {'id': doc_id, 'from': sender, 'hasMedia': True,
           'media': {'mimetype': 'image/jpeg', 'filename': f'{doc_id}.jpg',
                     'url': f'https://example.com/{doc_id}'}}
    if body:
        msg['body'] = body
    r = client.post('/webhook/waha', json={'event': 'message', 'session': 'default', 'payload': msg})
    return r.json()

def test_waha_nested_payload_media_accepted():
    r = _nested_photo('np1')
    assert r.get('accepted') is True, r


def test_first_text_after_burst_groups_photos():
    """Photos 1..N arrive first; the FIRST text afterwards becomes the
    explanation and groups every ungrouped photo from the same sender."""
    h = _auth()
    for i in range(1, 6):  # a burst of 5 photos, nested WAHA format
        r = _nested_photo(f'burst{i}')
        assert r.get('accepted') is True, r
    # first text after the burst — also in nested format
    r = client.post('/webhook/waha', json={
        'event': 'message', 'session': 'default',
        'payload': {'id': 'burst-text', 'from': '628777@c.us', 'body': 'Dokumentasi giat patroli malam'}})
    j = r.json()
    assert j.get('accepted') is True and j.get('images') == 5, j
    d = client.get('/api/documents/burst1', headers=h).json()
    assert d['metadata']['explanation'] == 'Dokumentasi giat patroli malam'
    assert d['metadata']['group_id'] == j['caption_group']
    # all five share the same group
    for i in range(2, 6):
        di = client.get(f'/api/documents/burst{i}', headers=h).json()
        assert di['metadata']['group_id'] == j['caption_group']


def test_second_text_does_not_regroup():
    """Once grouped, later texts must not steal or re-group the photos."""
    h = _auth()
    r = client.post('/webhook/waha', json={
        'event': 'message', 'session': 'default',
        'payload': {'id': 'burst-text-2', 'from': '628777@c.us', 'body': 'teks susulan yang harus diabaikan'}})
    j = r.json()
    # nothing left to attach -> plain text-only rejection
    assert j.get('accepted') is False
    d = client.get('/api/documents/burst1', headers=h).json()
    assert d['metadata']['explanation'] == 'Dokumentasi giat patroli malam'


def test_caption_on_last_photo_groups_burst():
    """A caption sent together with a photo (album style) groups the burst
    exactly like a separate text message would."""
    h = _auth()
    _nested_photo('cap1', sender='628555@c.us')
    _nested_photo('cap2', sender='628555@c.us', body='Kegiatan gotong royong RT 05')
    d1 = client.get('/api/documents/cap1', headers=h).json()
    d2 = client.get('/api/documents/cap2', headers=h).json()
    assert d1['metadata'].get('group_id')
    assert d1['metadata']['group_id'] == d2['metadata'].get('group_id')
    assert d1['metadata']['explanation'] == 'Kegiatan gotong royong RT 05'


def test_photos_without_text_stay_ungrouped():
    """No follow-up text -> photos stay in the Inbox individually, as before."""
    h = _auth()
    _nested_photo('solo-img', sender='628111@c.us')
    d = client.get('/api/documents/solo-img', headers=h).json()
    assert d['status'] == 'unanalyzed'
    assert 'group_id' not in d['metadata']
    assert 'explanation' not in d['metadata']


def test_non_message_events_ignored():
    """Acks, reactions and session status events are skipped early."""
    r = client.post('/webhook/waha', json={'event': 'session.status', 'payload': {'status': 'WORKING'}})
    assert r.json().get('accepted') is False
    r = client.post('/webhook/waha', json={'event': 'message.ack', 'payload': {'id': 'ack1', 'body': 'x'}})
    assert r.json().get('accepted') is False
