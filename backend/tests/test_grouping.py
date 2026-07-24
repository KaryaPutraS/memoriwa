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
    # different sender from the burst tests below — the caption window
    # groups by sender, so tests must not leak into each other
    r = _nested_photo('np1', sender='628778@c.us')
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


def test_caption_on_first_photo_groups_subsequent_photos_in_burst():
    """When Photo 1 carries a caption (e.g. WhatsApp album), subsequent photos
    arriving without caption within the burst window automatically join Photo 1's group."""
    h = _auth()
    _nested_photo('alb1', sender='628999@c.us', body='Piket Senkom dan Pengecekan MSO')
    import time; time.sleep(0.1)
    _nested_photo('alb2', sender='628999@c.us')
    _nested_photo('alb3', sender='628999@c.us')
    
    d1 = client.get('/api/documents/alb1', headers=h).json()
    d2 = client.get('/api/documents/alb2', headers=h).json()
    d3 = client.get('/api/documents/alb3', headers=h).json()
    
    gid = d1['metadata'].get('group_id')
    assert gid is not None
    assert d2['metadata'].get('group_id') == gid
    assert d3['metadata'].get('group_id') == gid
    assert d2['metadata'].get('explanation') == 'Piket Senkom dan Pengecekan MSO'
    assert d3['metadata'].get('explanation') == 'Piket Senkom dan Pengecekan MSO'


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


def _insert_old_photo(doc_id: str, sender: str, minutes_ago: float):
    """Insert an ungrouped photo straight into the store with a past timestamp."""
    import asyncio
    from datetime import datetime, timezone, timedelta
    from app.repository import get_repository
    repo = asyncio.run(get_repository())
    asyncio.run(repo.add_document({
        'id': doc_id, 'filename': f'{doc_id}.jpg', 'mime_type': 'image/jpeg',
        'sender': sender, 'status': 'unanalyzed',
        'created_at': (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).isoformat(),
        'metadata': {}}))


def test_text_only_groups_latest_burst():
    """The user's exact case: two DIFFERENT activities inside 10 minutes.
    Photos of activity A (6 min ago), then photos of activity B (now),
    then ONE text -> only activity B is grouped; A stays untouched."""
    h = _auth()
    _insert_old_photo('oldA1', '628333', 6.0)
    _insert_old_photo('oldA2', '628333', 5.5)
    _nested_photo('newB1', sender='628333@c.us')
    _nested_photo('newB2', sender='628333@c.us')
    r = client.post('/webhook/waha', json={
        'event': 'message', 'session': 'default',
        'payload': {'id': 'mix-text', 'from': '628333@c.us', 'body': 'Dokumentasi kegiatan B'}})
    j = r.json()
    assert j.get('accepted') is True and j.get('images') == 2, j
    # activity B grouped with the text
    d_new = client.get('/api/documents/newB1', headers=h).json()
    assert d_new['metadata']['explanation'] == 'Dokumentasi kegiatan B'
    assert client.get('/api/documents/newB2', headers=h).json()['metadata']['group_id'] == d_new['metadata']['group_id']
    # activity A untouched — still waiting in the Inbox, ungrouped
    d_old = client.get('/api/documents/oldA1', headers=h).json()
    assert 'group_id' not in d_old['metadata']
    assert 'explanation' not in d_old['metadata']


def test_back_to_back_activities_each_get_their_text():
    """Photos A -> text A -> photos B -> text B: two separate groups,
    each with its own explanation."""
    h = _auth()
    _nested_photo('actA1', sender='628444@c.us')
    _nested_photo('actA2', sender='628444@c.us')
    r1 = client.post('/webhook/waha', json={
        'event': 'message', 'session': 'default',
        'payload': {'id': 'textA', 'from': '628444@c.us', 'body': 'Kegiatan A — apel pagi'}})
    assert r1.json().get('images') == 2
    _nested_photo('actB1', sender='628444@c.us')
    r2 = client.post('/webhook/waha', json={
        'event': 'message', 'session': 'default',
        'payload': {'id': 'textB', 'from': '628444@c.us', 'body': 'Kegiatan B — rapat koordinasi'}})
    j2 = r2.json()
    assert j2.get('accepted') is True and j2.get('images') == 1, j2
    dA = client.get('/api/documents/actA1', headers=h).json()
    dB = client.get('/api/documents/actB1', headers=h).json()
    assert dA['metadata']['explanation'] == 'Kegiatan A — apel pagi'
    assert dB['metadata']['explanation'] == 'Kegiatan B — rapat koordinasi'
    assert dA['metadata']['group_id'] != dB['metadata']['group_id']
