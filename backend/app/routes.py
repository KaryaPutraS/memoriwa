"""MemoriWA Routes — single-tenant."""
from __future__ import annotations
import hashlib, hmac, asyncio, json, logging, os
from datetime import datetime, timezone
from typing import Any
from fastapi import APIRouter, HTTPException, Depends, Header, WebSocket, WebSocketDisconnect, Query
from pydantic import BaseModel
import app.auth as auth
from app.repository import Repository, get_repository
from app.waha_client import WAHAClient

logger = logging.getLogger("memoriwa")
router = APIRouter()
waha: WAHAClient | None = None

def get_waha() -> WAHAClient:
    if waha is None: raise HTTPException(503, "WAHA not available")
    return waha

class LoginRequest(BaseModel): username: str; password: str
class ProviderRequest(BaseModel): name: str; base_url: str = ""; api_key: str = ""; model: str = ""; active: bool | None = None
class SettingsRequest(BaseModel): theme: str = "system"; language: str = "id"; auto_analyze: bool = False

PROVIDER_PRESETS = [
    {"key":"openai","name":"OpenAI","base_url":"https://api.openai.com/v1","models":["gpt-5.5","gpt-5.4"]},
    {"key":"anthropic","name":"Anthropic Claude","base_url":"https://api.anthropic.com/v1","models":["claude-sonnet-5","claude-opus-4-8","claude-haiku-4-5"]},
    {"key":"deepseek","name":"DeepSeek","base_url":"https://api.deepseek.com/v1","models":["deepseek-v4-flash","deepseek-v4-pro"]},
    {"key":"gemini","name":"Google Gemini","base_url":"https://generativelanguage.googleapis.com/v1beta","models":["gemini-3.5-flash","gemini-3.1-pro-preview","gemini-3.1-flash-lite"]},
    {"key":"groq","name":"Groq","base_url":"https://api.groq.com/openai/v1","models":["meta-llama/llama-4-scout-17b-16e-instruct","llama-3.3-70b-versatile","openai/gpt-oss-120b"]},
    {"key":"ollama","name":"Ollama (Local)","base_url":"http://localhost:11434/v1","models":["llama3.3","qwen3","mistral"]},
    {"key":"openrouter","name":"OpenRouter","base_url":"https://openrouter.ai/api/v1","models":["openai/gpt-5.5","anthropic/claude-sonnet-5","deepseek/deepseek-v4-flash"]},
    {"key":"custom","name":"Custom Provider","base_url":"","models":[]},
]

DOC_MIMES = ("application/pdf","image/","text/","application/msword","application/vnd","application/zip")

def _extract_media(payload: dict) -> dict:
    """Extract media info from various WAHA webhook formats."""
    # Format 1: payload.message.media (most common)
    msg = payload.get("message") or payload.get("data") or payload
    if isinstance(msg, dict):
        media = msg.get("media") or msg.get("mediaData") or {}
        if media:
            return media
        # Format 2: payload.payload.media
        inner = payload.get("payload") or {}
        if isinstance(inner, dict):
            return inner.get("media") or {}
    return {}

class WSManager:
    def __init__(self): self.clients: set[WebSocket] = set()
    async def broadcast(self, msg: dict):
        gone: set[WebSocket] = set()
        for ws in list(self.clients):
            try: await ws.send_json(msg)
            except Exception: gone.add(ws)
        self.clients -= gone
ws_manager = WSManager()

# Auth
@router.post("/api/auth/login")
async def login(body: LoginRequest):
    if not hmac.compare_digest(body.username, auth.ADMIN_USERNAME): raise HTTPException(401)
    if not auth.verify_password(body.password, auth.ADMIN_PASSWORD_HASH): raise HTTPException(401)
    return {"access_token": auth.create_token(body.username), "token_type": "bearer"}

# WAHA
@router.get("/api/waha/status")
async def waha_status(user: str = Depends(auth.get_current_user)):
    wh = get_waha()
    session = await wh.get_session()
    me = await wh.get_me() if session and session.get("status") == "WORKING" else None
    return {"connected": session.get("status") == "WORKING" if session else False, "status": session.get("status", "UNKNOWN") if session else "NOT_CREATED", "me": me}

@router.post("/api/waha/start")
async def waha_start(user: str = Depends(auth.get_current_user)):
    wh = get_waha()
    webhook_url = os.getenv("MEMORIWA_WEBHOOK_URL", "http://43.156.71.166:8082/webhook/waha")
    if auth.WEBHOOK_SECRET:
        sep = "&" if "?" in webhook_url else "?"
        webhook_url = f"{webhook_url}{sep}secret={auth.WEBHOOK_SECRET}"
    await wh.ensure_session(webhook_url)
    result = await wh.start()
    await ws_manager.broadcast({"type": "waha.status", "status": result.get("status", "STARTING")})
    return {"status": result.get("status", "STARTING")}

@router.post("/api/waha/stop")
async def waha_stop(user: str = Depends(auth.get_current_user)):
    result = await get_waha().stop()
    await ws_manager.broadcast({"type": "waha.status", "status": "STOPPED"})
    return result

@router.post("/api/waha/logout")
async def waha_logout(user: str = Depends(auth.get_current_user)):
    await get_waha().logout()
    await ws_manager.broadcast({"type": "waha.status", "status": "NOT_CREATED"})
    return {"deleted": True}

@router.get("/api/waha/qr")
async def waha_qr(user: str = Depends(auth.get_current_user)):
    wh = get_waha()
    qr = await wh.get_qr()
    if qr is None:
        try:
            await waha_start(user=user)
            import asyncio as _a; await _a.sleep(3)
            qr = await wh.get_qr()
        except Exception: pass
    if qr is None: raise HTTPException(404, "QR not available yet")
    return {"qr": qr}

@router.get("/api/waha/health")
async def waha_health_check():
    if waha is None: return {"ok": False}
    return {"ok": await waha.health()}

# Webhook — handles ALL WAHA formats
def _check_webhook_secret(secret: str | None, header_secret: str | None) -> None:
    """Enforce shared-secret auth on the webhook when WEBHOOK_SECRET is set.

    The secret travels either as ?secret=... (embedded in the webhook URL
    registered in WAHA) or as the X-Webhook-Secret header.
    """
    expected = auth.WEBHOOK_SECRET
    if not expected:
        return  # dev/test mode — enforcement disabled
    provided = secret or header_secret or ""
    if not provided or not hmac.compare_digest(provided, expected):
        raise HTTPException(401, "Invalid webhook secret")

@router.post("/webhook/waha")
async def webhook(payload: dict, secret: str | None = Query(None), x_webhook_secret: str | None = Header(None)):
    """Receive messages from WAHA. Accepts multiple WAHA payload formats."""
    _check_webhook_secret(secret, x_webhook_secret)
    repo = await get_repository()
    
    # Generate event ID for idempotency
    eid = str(payload.get("id") or payload.get("eventId") or "")
    if not eid:
        # Try nested
        msg = payload.get("message") or payload.get("data") or payload.get("payload") or {}
        if isinstance(msg, dict):
            eid = str(msg.get("id") or "")
    if not eid:
        eid = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:16]
    
    # Idempotency check
    if not await repo.add_event(eid):
        return {"accepted": False, "duplicate": True, "event_id": eid}
    
    # Extract media
    media = _extract_media(payload)
    if not media:
        # Check if message has body only (text)
        msg = payload.get("message") or payload.get("data") or {}
        body = msg.get("body", "") if isinstance(msg, dict) else ""
        if body and not media:
            return {"accepted": False, "reason": "text-only message", "event_id": eid}
        return {"accepted": False, "reason": "no media found", "event_id": eid}
    
    # Extract sender
    msg = payload.get("message") or payload.get("data") or payload.get("payload") or {}
    sender = ""
    if isinstance(msg, dict):
        sender = str(msg.get("from") or msg.get("author") or msg.get("sender") or "")
        # Clean WA ID format
        if "@" in sender:
            sender = sender.split("@")[0]
    
    mime = str(media.get("mimetype") or media.get("mimeType") or "application/octet-stream")
    filename = str(media.get("filename") or media.get("fileName") or "untitled")
    
    # Check if document/image
    is_doc = any(mime.lower().startswith(m) for m in DOC_MIMES)
    is_img = mime.lower().startswith("image/")
    if not is_doc:
        return {"accepted": False, "reason": f"unsupported mime: {mime}", "event_id": eid}
    
    did = str(msg.get("id") or eid)
    doc = {
        "id": did,
        "filename": filename,
        "mime_type": mime,
        "source": "whatsapp",
        "sender": sender,
        "url": str(media.get("url") or ""),
        "file_url": str(media.get("url") or ""),
        "status": "unanalyzed",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "metadata": {
            "event_id": eid,
            "media_url": str(media.get("url") or ""),
            "mimetype": mime,
            "size": media.get("size") or media.get("fileSize") or 0,
            "caption": str(msg.get("body") or msg.get("caption") or ""),
        },
    }
    await repo.add_document(doc)
    await ws_manager.broadcast({"type": "document.created", "data": doc})
    return {"accepted": True, "document_id": did, "event_id": eid}

# Documents
@router.get("/api/documents")
async def list_documents(q: str|None=None, status: str|None=None, limit: int=50, user: str=Depends(auth.get_current_user)):
    return await (await get_repository()).get_documents(q=q, status=status, limit=limit)

@router.get("/api/documents/{doc_id}")
async def get_document(doc_id: str, user: str=Depends(auth.get_current_user)):
    doc = await (await get_repository()).get_document(doc_id)
    if not doc: raise HTTPException(404)
    return doc

@router.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str, user: str=Depends(auth.get_current_user)):
    if not await (await get_repository()).delete_document(doc_id): raise HTTPException(404)
    return {"deleted": True}

# Analysis
@router.post("/api/analysis/run")
async def run_analysis(user: str=Depends(auth.get_current_user)):
    repo = await get_repository()
    result = await repo.get_documents(status="unanalyzed", limit=1000)
    for doc in result["items"]:
        doc["status"] = "processing"; await repo.update_document(doc["id"], doc)
        await ws_manager.broadcast({"type": "document.updated", "data": doc})
    async def _a():
        for doc in result["items"]:
            await asyncio.sleep(0)
            doc["status"] = "analyzed"
            doc["metadata"] = {**(doc.get("metadata") or {}), "analysis": {"provider": "stub", "note": "No AI provider configured"}}
            await repo.update_document(doc["id"], doc)
            await ws_manager.broadcast({"type": "document.updated", "data": doc})
    asyncio.create_task(_a())
    return {"queued": len(result["items"])}

@router.post("/api/analysis/run/{doc_id}")
async def analyze_single(doc_id: str, user: str=Depends(auth.get_current_user)):
    repo = await get_repository()
    doc = await repo.get_document(doc_id)
    if not doc: raise HTTPException(404)
    doc["status"] = "processing"; await repo.update_document(doc_id, doc)
    await ws_manager.broadcast({"type": "document.updated", "data": doc})
    async def _d():
        doc["status"] = "analyzed"
        doc["metadata"] = {**(doc.get("metadata") or {}), "analysis": {"provider": "stub"}}
        await repo.update_document(doc_id, doc)
        await ws_manager.broadcast({"type": "document.updated", "data": doc})
    asyncio.create_task(_d())
    return {"queued": 1}

# Stats, Settings, Providers
@router.get("/api/stats")
async def get_stats(user: str=Depends(auth.get_current_user)):
    return await (await get_repository()).get_stats()

@router.get("/api/settings")
async def get_settings(user: str=Depends(auth.get_current_user)):
    s = await (await get_repository()).get_settings()
    return s or SettingsRequest().model_dump()

@router.put("/api/settings")
async def save_settings(body: SettingsRequest, user: str=Depends(auth.get_current_user)):
    return await (await get_repository()).save_settings(body.model_dump())

@router.get("/api/providers")
async def list_providers(user: str=Depends(auth.get_current_user)):
    providers = await (await get_repository()).get_providers()
    return {"items": [{k:v for k,v in p.items() if k!="api_key"} for p in providers]}

@router.post("/api/providers", status_code=201)
async def create_provider(body: ProviderRequest, user: str=Depends(auth.get_current_user)):
    data = body.model_dump()
    data["active"] = bool(data.get("active"))
    if data["api_key"]: data["api_key"] = auth.encrypt_api_key(data["api_key"])
    data["id"] = data["name"]
    await (await get_repository()).add_provider(data)
    return {k:v for k,v in data.items() if k!="api_key"}

@router.delete("/api/providers/{provider_name}")
async def delete_provider(provider_name: str, user: str=Depends(auth.get_current_user)):
    if await (await get_repository()).delete_provider(provider_name): return {"deleted": True}
    raise HTTPException(404)

@router.put("/api/providers/{provider_name}")
async def update_provider(provider_name: str, body: ProviderRequest, user: str=Depends(auth.get_current_user)):
    repo = await get_repository()
    for p in await repo.get_providers():
        if p.get("name") == provider_name:
            data = body.model_dump()
            if data["active"] is None:
                data.pop("active")  # not a toggle request — keep current state
            if data["api_key"]: data["api_key"] = auth.encrypt_api_key(data["api_key"])
            else: data["api_key"] = p.get("api_key","")
            p.update(data); await repo.add_provider(p)
            return {k:v for k,v in p.items() if k!="api_key"}
    raise HTTPException(404)

@router.get("/api/provider-presets")
async def get_provider_presets(user: str=Depends(auth.get_current_user)):
    return {"presets": PROVIDER_PRESETS}

# File Download Proxy — Bearer auth only.
# Query-param tokens were removed on purpose: URLs end up in nginx access
# logs, browser history and Referer headers, which would leak live JWTs.
@router.get("/api/files/{doc_id}/raw")
async def download_file(doc_id: str, user: str = Depends(auth.get_current_user)):
    repo = await get_repository()
    doc = await repo.get_document(doc_id)
    if not doc: raise HTTPException(404)
    
    mime = doc.get("mime_type", "image/jpeg")
    filename = doc.get("filename", "file")
    
    # Try to get the file from WAHA using the media URL from webhook
    file_url = doc.get("file_url") or doc.get("url") or ""
    wh = get_waha() if waha else None

    # SSRF guard: the media URL comes from webhook payloads, so only ever
    # fetch from the WAHA service itself — never arbitrary hosts.
    from urllib.parse import urlparse
    allowed_hosts = {"localhost:3000", "127.0.0.1:3000", "waha:3000"}
    fetch_url = ""
    if file_url:
        parsed = urlparse(file_url.replace("http://localhost:3000", "http://waha:3000"))
        if parsed.scheme == "http" and parsed.netloc in allowed_hosts:
            fetch_url = parsed.geturl()
        else:
            logger.warning("Blocked non-WAHA media URL for doc %s: %s", doc_id, file_url[:120])

    if wh and fetch_url:
        try:
            import httpx
            safe_name = "".join(c for c in filename if c not in '\r\n";\\')[:120] or "file"
            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.get(fetch_url, headers=wh._headers(), follow_redirects=False)
                if r.status_code == 200 and len(r.content) > 100:
                    from fastapi.responses import Response
                    return Response(
                        content=r.content,
                        media_type=mime,
                        headers={"Cache-Control": "private, no-store", "Content-Disposition": f'inline; filename="{safe_name}"'}
                    )
        except Exception:
            pass
    
    # Fallback: return a placeholder SVG for images, or plain info for docs
    if mime.startswith("image/"):
        svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" style="background:#f0f0f0;border:2px solid #111">
            <rect width="200" height="150" fill="#eee" stroke="#111" stroke-width="2"/>
            <text x="100" y="75" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#555">{filename[:30]}</text>
            <text x="100" y="95" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#999">Preview not available</text>
        </svg>'''
        from fastapi.responses import Response
        return Response(content=svg.encode(), media_type="image/svg+xml")
    
    if mime == "application/pdf":
        svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150">
            <rect width="200" height="150" fill="#f2504b" stroke="#111" stroke-width="2"/>
            <text x="100" y="70" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#fff" font-weight="bold">PDF</text>
            <text x="100" y="100" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#fff">Document</text>
        </svg>'''
        from fastapi.responses import Response
        return Response(content=svg.encode(), media_type="image/svg+xml")
    
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(f"File: {filename}\nType: {mime}\nPreview not available for this type.")

# WebSocket
@router.websocket("/ws")
async def ws_endpoint(socket: WebSocket):
    from jose import JWTError
    from jose import jwt as jose_jwt
    allowed = [o.strip() for o in os.getenv("CORS_ORIGINS","").split(",") if o.strip()]
    if not allowed and (os.getenv("ENV","") or "production").lower() in ("dev","test"):
        allowed = ["http://localhost:5173","http://127.0.0.1:5173"]
    origin = socket.headers.get("origin","")
    if allowed and origin and origin not in allowed: await socket.close(code=1008); return
    token = socket.headers.get("sec-websocket-protocol","")
    if token.startswith("access_token."): token = token[13:]
    else: token = socket.query_params.get("token","")
    if not token: await socket.close(code=1008); return
    try: jose_jwt.decode(token, auth.JWT_SECRET, algorithms=[auth.ALGO])
    except JWTError: await socket.close(code=1008); return
    await socket.accept()
    ws_manager.clients.add(socket)
    try:
        while True:
            raw = await socket.receive_text()
            if raw == "ping": await socket.send_json({"type": "pong"})
    except WebSocketDisconnect: ws_manager.clients.discard(socket)
