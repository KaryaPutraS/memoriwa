from __future__ import annotations
import hashlib, hmac, asyncio, json
import logging
from datetime import datetime, timezone
from typing import Any
from fastapi import APIRouter, HTTPException, Depends, Header, WebSocket, WebSocketDisconnect, Query

logger = logging.getLogger('memoriwa')
from pydantic import BaseModel

from .auth import (
    ADMIN_USERNAME, ADMIN_PASSWORD_HASH, WEBHOOK_SECRET,
    verify_password, create_token, get_current_user,
    encrypt_api_key, decrypt_api_key,
)
from .repository import Repository, get_repository

router = APIRouter()


class LoginRequest(BaseModel):
    username: str
    password: str


class ProviderRequest(BaseModel):
    name: str
    base_url: str = ''
    api_key: str = ''
    model: str = ''


class SettingsRequest(BaseModel):
    theme: str = 'system'
    language: str = 'id'
    auto_analyze: bool = False
    waha_base_url: str = ''
    waha_api_key: str = ''
    waha_timeout: int = 30


def _is_document(mime: str = '', filename: str = '') -> bool:
    doc_mimes = (
        'application/pdf', 'image/', 'text/',
        'application/msword', 'application/vnd',
    )
    doc_exts = (
        '.pdf', '.doc', '.docx', '.xls', '.xlsx',
        '.ppt', '.pptx', '.txt', '.csv',
        '.jpg', '.jpeg', '.png', '.webp',
    )
    return (
        any(mime.lower().startswith(m) for m in doc_mimes) or
        any(filename.lower().endswith(e) for e in doc_exts)
    )


class WebSocketManager:
    def __init__(self):
        self.clients: set[WebSocket] = set()

    async def broadcast(self, msg: dict):
        gone: set[WebSocket] = set()
        for ws in list(self.clients):
            try:
                await ws.send_json(msg)
            except Exception:
                gone.add(ws)
        self.clients -= gone


ws_manager = WebSocketManager()

# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

@router.get('/health')
async def health():
    import os
    storage = 'memory'
    if os.getenv('MONGO_URI', ''):
        try:
            repo = await get_repository()
            storage = type(repo).__name__.replace('Repository', '').lower()
        except Exception:
            pass
    return {'status': 'ok', 'storage': storage}

# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

@router.post('/api/auth/login')
async def login(body: LoginRequest):
    if not hmac.compare_digest(body.username, ADMIN_USERNAME):
        raise HTTPException(401, 'Invalid credentials')
    if not verify_password(body.password, ADMIN_PASSWORD_HASH):
        raise HTTPException(401, 'Invalid credentials')
    return {
        'access_token': create_token(body.username),
        'token_type': 'bearer',
    }

# ---------------------------------------------------------------------------
# Webhook
# ---------------------------------------------------------------------------

@router.post('/webhook/waha')
async def webhook(payload: dict, x_webhook_secret: str | None = Header(None)):
    if not WEBHOOK_SECRET:
        raise HTTPException(401, 'Webhook secret not configured on server')
    if not x_webhook_secret:
        raise HTTPException(401, 'Missing X-Webhook-Secret header')
    if not hmac.compare_digest(x_webhook_secret, WEBHOOK_SECRET):
        raise HTTPException(401, 'Invalid webhook secret')

    repo = await get_repository()
    eid = str(payload.get('id') or payload.get('event_id') or '')
    if not eid:
        raise HTTPException(400, 'Missing event id — payload must include id or event_id')

    if not await repo.add_event(eid):
        return {'accepted': False, 'duplicate': True}

    msg = payload.get('message', payload)
    media = msg.get('media') or {}
    mime = media.get('mimetype', msg.get('mimetype', ''))
    filename = media.get('filename', msg.get('filename', ''))

    if not _is_document(mime, filename):
        return {'accepted': False, 'duplicate': False, 'reason': 'not a document or image'}

    did = msg.get('id', eid)
    doc = {
        'id': did,
        'filename': filename or 'whatsapp-file',
        'mime_type': mime or 'application/octet-stream',
        'source': 'whatsapp',
        'sender': str(msg.get('from', '')),
        'url': media.get('url', ''),
        'status': 'unanalyzed',
        'created_at': datetime.now(timezone.utc).isoformat(),
        'metadata': {'event_id': eid},
    }
    await repo.add_document(doc)
    await ws_manager.broadcast({'type': 'document.created', 'data': doc})
    return {'accepted': True, 'duplicate': False, 'document_id': did}

# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

@router.get('/api/documents')
async def list_documents(
    q: str | None = None,
    status: str | None = None,
    limit: int = 50,
    user: str = Depends(get_current_user),
):
    repo = await get_repository()
    return await repo.get_documents(q=q, status=status, limit=limit)


@router.get('/api/documents/{doc_id}')
async def get_document(doc_id: str, user: str = Depends(get_current_user)):
    repo = await get_repository()
    doc = await repo.get_document(doc_id)
    if not doc:
        raise HTTPException(404, 'Document not found')
    return doc


@router.patch('/api/documents/{doc_id}')
async def update_document(doc_id: str, data: dict, user: str = Depends(get_current_user)):
    repo = await get_repository()
    doc = await repo.update_document(doc_id, data)
    if not doc:
        raise HTTPException(404, 'Document not found')
    await ws_manager.broadcast({'type': 'document.updated', 'data': doc})
    return doc


@router.delete('/api/documents/{doc_id}')
async def delete_document(doc_id: str, user: str = Depends(get_current_user)):
    repo = await get_repository()
    if not await repo.delete_document(doc_id):
        raise HTTPException(404, 'Document not found')
    return {'deleted': True}

# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------

@router.post('/api/analysis/run')
async def run_analysis(user: str = Depends(get_current_user)):
    """Queue all unanalyzed documents for analysis (manual only)."""
    repo = await get_repository()
    result = await repo.get_documents(status='unanalyzed', limit=1000)
    queued = 0
    for doc in result['items']:
        doc['status'] = 'processing'
        await repo.update_document(doc['id'], doc)
        await ws_manager.broadcast({'type': 'document.updated', 'data': doc})
        queued += 1

    async def _analyze():
        for doc in result['items']:
            await asyncio.sleep(0)
            try:
                doc['status'] = 'analyzed'
                doc['metadata'] = {**(doc.get('metadata') or {}),
                                   'analysis': {'provider': 'none',
                                                'extracted': False,
                                                'note': 'No AI provider configured. Add a provider in Settings.'}}
            except Exception as exc:
                logger.error('Analysis failed for doc %s: %s', doc['id'], exc, exc_info=True)
                doc['status'] = 'failed'
                doc['metadata'] = {**(doc.get('metadata') or {}),
                                   'analysis': {'error': 'Analysis failed — check server logs for details'}}
            await repo.update_document(doc['id'], doc)
            await ws_manager.broadcast({'type': 'document.updated', 'data': doc})

    asyncio.create_task(_analyze())
    return {'queued': queued, 'message': f'Analysis queued for {queued} document(s)'}


@router.post('/api/analysis/run/{doc_id}')
async def analyze_single(doc_id: str, user: str = Depends(get_current_user)):
    """Run analysis on a single document (manual only)."""
    repo = await get_repository()
    doc = await repo.get_document(doc_id)
    if not doc:
        raise HTTPException(404, 'Document not found')

    doc['status'] = 'processing'
    await repo.update_document(doc_id, doc)
    await ws_manager.broadcast({'type': 'document.updated', 'data': doc})

    async def _analyze_one():
        await asyncio.sleep(0)
        try:
            doc['status'] = 'analyzed'
            doc['metadata'] = {**(doc.get('metadata') or {}),
                               'analysis': {'provider': 'none',
                                            'extracted': False,
                                            'note': 'No AI provider configured. Add a provider in Settings.'}}
        except Exception as exc:
            logger.error('Analysis failed for doc %s: %s', doc_id, exc, exc_info=True)
            doc['status'] = 'failed'
            doc['metadata'] = {**(doc.get('metadata') or {}),
                               'analysis': {'error': 'Analysis failed — check server logs for details'}}
        await repo.update_document(doc_id, doc)
        await ws_manager.broadcast({'type': 'document.updated', 'data': doc})

    asyncio.create_task(_analyze_one())
    return {'queued': 1, 'message': f'Analysis queued for document {doc_id}'}

# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@router.get('/api/stats')
async def get_stats(user: str = Depends(get_current_user)):
    repo = await get_repository()
    return await repo.get_stats()

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

@router.get('/api/settings')
async def get_settings(user: str = Depends(get_current_user)):
    repo = await get_repository()
    settings = await repo.get_settings()
    if not settings:
        settings = SettingsRequest().model_dump()
    return settings


@router.put('/api/settings')
async def save_settings(body: SettingsRequest, user: str = Depends(get_current_user)):
    repo = await get_repository()
    return await repo.save_settings(body.model_dump())

# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------

@router.get('/api/providers')
async def list_providers(user: str = Depends(get_current_user)):
    repo = await get_repository()
    providers = await repo.get_providers()
    masked = [{k: v for k, v in p.items() if k != 'api_key'} for p in providers]
    return {'items': masked}


@router.post('/api/providers', status_code=201)
async def create_provider(body: ProviderRequest, user: str = Depends(get_current_user)):
    repo = await get_repository()
    data = body.model_dump()
    if data['api_key']:
        data['api_key'] = encrypt_api_key(data['api_key'])
    data['id'] = data['name']
    await repo.add_provider(data)
    return {k: v for k, v in data.items() if k != 'api_key'}


@router.delete('/api/providers/{provider_name}')
async def delete_provider(provider_name: str, user: str = Depends(get_current_user)):
    repo = await get_repository()
    if await repo.delete_provider(provider_name):
        return {'deleted': True, 'name': provider_name}
    raise HTTPException(404, 'Provider not found')


@router.put('/api/providers/{provider_name}')
async def update_provider(
    provider_name: str, body: ProviderRequest, user: str = Depends(get_current_user),
):
    repo = await get_repository()
    providers = await repo.get_providers()
    for p in providers:
        if p.get('name') == provider_name:
            data = body.model_dump()
            if data['api_key']:
                data['api_key'] = encrypt_api_key(data['api_key'])
            else:
                data['api_key'] = p.get('api_key', '')
            data['id'] = data['name']
            p.update(data)
            await repo.add_provider(data)
            return {k: v for k, v in p.items() if k != 'api_key'}
    raise HTTPException(404, 'Provider not found')

# ---------------------------------------------------------------------------
# Provider Presets
# ---------------------------------------------------------------------------

PROVIDER_PRESETS = [
    {"key": "openai", "name": "OpenAI", "base_url": "https://api.openai.com/v1", "models": ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"]},
    {"key": "anthropic", "name": "Anthropic Claude", "base_url": "https://api.anthropic.com/v1", "models": ["claude-sonnet-4-20250514", "claude-3-5-haiku-latest"]},
    {"key": "deepseek", "name": "DeepSeek", "base_url": "https://api.deepseek.com/v1", "models": ["deepseek-chat", "deepseek-reasoner"]},
    {"key": "gemini", "name": "Google Gemini", "base_url": "https://generativelanguage.googleapis.com/v1beta", "models": ["gemini-2.5-flash", "gemini-2.5-pro"]},
    {"key": "groq", "name": "Groq", "base_url": "https://api.groq.com/openai/v1", "models": ["llama-4-scout-17b-16e-instruct", "mixtral-8x7b-32768"]},
    {"key": "ollama", "name": "Ollama (Local)", "base_url": "http://localhost:11434/v1", "models": ["llama3.2", "mistral", "gemma3"]},
    {"key": "openrouter", "name": "OpenRouter", "base_url": "https://openrouter.ai/api/v1", "models": ["openai/gpt-4o", "anthropic/claude-sonnet-4"]},
    {"key": "custom", "name": "Custom Provider", "base_url": "", "models": []},
]

@router.get('/api/provider-presets')
async def get_provider_presets(user: str = Depends(get_current_user)):
    return {'presets': PROVIDER_PRESETS}

# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

@router.get('/api/sessions')
async def list_sessions(user: str = Depends(get_current_user)):
    repo = await get_repository()
    sessions = await repo.get_sessions()
    return {'items': sessions}

# ---------------------------------------------------------------------------
# WAHA Connection
# ---------------------------------------------------------------------------

@router.post('/api/waha/test')
async def test_waha(user: str = Depends(get_current_user)):
    import httpx
    repo = await get_repository()
    settings = await repo.get_settings()
    base_url = (settings or {}).get('waha_base_url', '')
    api_key = (settings or {}).get('waha_api_key', '')
    timeout = (settings or {}).get('waha_timeout', 30)
    if not base_url:
        raise HTTPException(400, 'WAHA base URL not configured')
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            headers = {'X-Api-Key': api_key} if api_key else {}
            r = await client.get(f'{base_url.rstrip("/")}/api/sessions', headers=headers)
            if r.status_code == 200:
                data = r.json()
                return {'ok': True, 'sessions': data if isinstance(data, list) else data.get('data', [])}
            return {'ok': False, 'status': r.status_code, 'error': r.text[:200]}
    except Exception as e:
        return {'ok': False, 'error': str(e)[:200]}

@router.get('/api/waha/sessions')
async def waha_sessions_list(user: str = Depends(get_current_user)):
    import httpx
    repo = await get_repository()
    settings = await repo.get_settings()
    base_url = (settings or {}).get('waha_base_url', '')
    api_key = (settings or {}).get('waha_api_key', '')
    timeout = (settings or {}).get('waha_timeout', 30)
    if not base_url:
        return {'sessions': []}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            headers = {'X-Api-Key': api_key} if api_key else {}
            r = await client.get(f'{base_url.rstrip("/")}/api/sessions', headers=headers)
            if r.status_code == 200:
                data = r.json()
                sessions = data if isinstance(data, list) else data.get('data', [])
                return {'sessions': sessions}
            return {'sessions': [], 'error': f'WAHA returned {r.status_code}'}
    except Exception as e:
        return {'sessions': [], 'error': str(e)[:200]}

# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------

@router.websocket('/ws')
async def ws_endpoint(socket: WebSocket):
    from jose import JWTError
    from .auth import JWT_SECRET, ALGO
    from jose import jwt as jose_jwt
    import os

    # Validate Origin header
    allowed_origins = [o.strip() for o in os.getenv('CORS_ORIGINS', '').split(',') if o.strip()]
    if not allowed_origins:
        env = (os.getenv('ENV', 'production') or 'production').lower()
        if env in ('dev', 'development', 'test'):
            allowed_origins = ['http://localhost:5173', 'http://127.0.0.1:5173']
    origin = socket.headers.get('origin', '')
    if allowed_origins and origin and origin not in allowed_origins:
        await socket.close(code=1008, reason='Origin not allowed')
        return

    # Accept token via Sec-WebSocket-Protocol (subprotocol approach)
    token = ''
    subprotocol = socket.headers.get('sec-websocket-protocol', '')
    if subprotocol.startswith('access_token.'):
        token = subprotocol[len('access_token.'):]
    else:
        # Fallback to query param for backward compatibility
        token = socket.query_params.get('token', '')

    if not token:
        await socket.close(code=1008, reason='Missing token')
        return
    try:
        payload = jose_jwt.decode(token, JWT_SECRET, algorithms=[ALGO])
    except JWTError:
        await socket.close(code=1008, reason='Invalid token')
        return
    await socket.accept(subprotocol='access_token' if subprotocol.startswith('access_token.') else None)
    ws_manager.clients.add(socket)
    try:
        while True:
            raw = await socket.receive_text()
            if raw == 'ping':
                await socket.send_json({'type': 'pong'})
    except WebSocketDisconnect:
        ws_manager.clients.discard(socket)
