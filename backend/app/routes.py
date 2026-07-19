"""MemoriWA Routes — WAHA built-in, QR scan, document intelligence."""
from __future__ import annotations
import hashlib, hmac, asyncio, json, logging, os, base64 as b64
from datetime import datetime, timezone
from typing import Any
from fastapi import APIRouter, HTTPException, Depends, Header, WebSocket, WebSocketDisconnect, Query
from pydantic import BaseModel
import app.auth as auth
from app.repository import Repository, get_repository
from app.waha_client import WAHAClient

logger = logging.getLogger("memoriwa")
router = APIRouter()

# Global WAHA client — set by main.py lifespan
waha: WAHAClient | None = None

def get_waha() -> WAHAClient:
    if waha is None:
        raise HTTPException(503, "WAHA service not available")
    return waha

# ========== Models ==========
class LoginRequest(BaseModel):
    username: str
    password: str

class ProviderRequest(BaseModel):
    name: str
    base_url: str = ""
    api_key: str = ""
    model: str = ""

class SettingsRequest(BaseModel):
    theme: str = "system"
    language: str = "id"
    auto_analyze: bool = False
    waha_api_key: str = ""

class WAHASessionRequest(BaseModel):
    name: str = "default"

PROVIDER_PRESETS = [
    {"key":"openai","name":"OpenAI","base_url":"https://api.openai.com/v1","models":["gpt-4o","gpt-4o-mini","gpt-4-turbo"]},
    {"key":"anthropic","name":"Anthropic Claude","base_url":"https://api.anthropic.com/v1","models":["claude-sonnet-4-20250514","claude-3-5-haiku-latest"]},
    {"key":"deepseek","name":"DeepSeek","base_url":"https://api.deepseek.com/v1","models":["deepseek-chat","deepseek-reasoner"]},
    {"key":"gemini","name":"Google Gemini","base_url":"https://generativelanguage.googleapis.com/v1beta","models":["gemini-2.5-flash","gemini-2.5-pro"]},
    {"key":"groq","name":"Groq","base_url":"https://api.groq.com/openai/v1","models":["llama-4-scout-17b-16e-instruct","mixtral-8x7b-32768"]},
    {"key":"ollama","name":"Ollama (Local)","base_url":"http://localhost:11434/v1","models":["llama3.2","mistral","gemma3"]},
    {"key":"openrouter","name":"OpenRouter","base_url":"https://openrouter.ai/api/v1","models":["openai/gpt-4o","anthropic/claude-sonnet-4"]},
    {"key":"custom","name":"Custom Provider","base_url":"","models":[]},
]

def _is_document(mime: str = "", filename: str = "") -> bool:
    doc_mimes = ("application/pdf","image/","text/","application/msword","application/vnd")
    doc_exts = (".pdf",".doc",".docx",".xls",".xlsx",".ppt",".pptx",".txt",".csv",".jpg",".jpeg",".png",".webp")
    return any(mime.lower().startswith(m) for m in doc_mimes) or any(filename.lower().endswith(e) for e in doc_exts)

class WebSocketManager:
    def __init__(self): self.clients: set[WebSocket] = set()
    async def broadcast(self, msg: dict):
        gone: set[WebSocket] = set()
        for ws in list(self.clients):
            try: await ws.send_json(msg)
            except Exception: gone.add(ws)
        self.clients -= gone
ws_manager = WebSocketManager()

# ========== Auth ==========
@router.post("/api/auth/login")
async def login(body: LoginRequest):
    if not hmac.compare_digest(body.username, auth.ADMIN_USERNAME):
        raise HTTPException(401, "Invalid credentials")
    if not auth.verify_password(body.password, auth.ADMIN_PASSWORD_HASH):
        raise HTTPException(401, "Invalid credentials")
    return {"access_token": auth.create_token(body.username), "token_type": "bearer"}

# ========== WAHA Sessions (Built-in) ==========
@router.get("/api/waha/sessions")
async def waha_list_sessions(user: str = Depends(auth.get_current_user)):
    """List WAHA sessions from built-in WAHA container."""
    wh = get_waha()
    try:
        sessions = await wh.list_sessions()
        # Enrich with QR availability
        for s in sessions:
            s["has_qr"] = s.get("status") == "SCAN_QR_CODE"
        return {"sessions": sessions}
    except Exception as e:
        logger.error(f"WAHA list sessions failed: {e}")
        return {"sessions": [], "error": str(e)[:200]}

@router.post("/api/waha/sessions")
async def waha_create_session(body: WAHASessionRequest, user: str = Depends(auth.get_current_user)):
    """Create a new WAHA session, register webhook, and start it."""
    wh = get_waha()
    # Determine webhook URL — use our own external URL
    webhook_url = os.getenv("MEMORIWA_WEBHOOK_URL", "")
    if not webhook_url:
        # Fallback: use the same origin as the request
        webhook_url = "http://memoriwa-api:8000/webhook/waha"
    
    # Create session
    session = await wh.create_session(body.name, webhook_url)
    
    # Store in our DB
    repo = await get_repository()
    await repo.add_waha_session({
        "name": body.name,
        "status": session.get("status", "STARTING"),
        "engine": session.get("engine", {}).get("engine", "WEBJS"),
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    
    await ws_manager.broadcast({"type": "waha.session.created", "data": session})
    return session

@router.post("/api/waha/sessions/{name}/start")
async def waha_start_session(name: str, user: str = Depends(auth.get_current_user)):
    wh = get_waha()
    result = await wh.start_session(name)
    await ws_manager.broadcast({"type": "waha.session.started", "data": {"name": name}})
    return result

@router.post("/api/waha/sessions/{name}/stop")
async def waha_stop_session(name: str, user: str = Depends(auth.get_current_user)):
    wh = get_waha()
    result = await wh.stop_session(name)
    await ws_manager.broadcast({"type": "waha.session.stopped", "data": {"name": name}})
    return result

@router.delete("/api/waha/sessions/{name}")
async def waha_delete_session(name: str, user: str = Depends(auth.get_current_user)):
    wh = get_waha()
    result = await wh.logout_session(name)
    # Clean up from our DB
    repo = await get_repository()
    await repo.remove_waha_session(name)
    await ws_manager.broadcast({"type": "waha.session.deleted", "data": {"name": name}})
    return result

@router.get("/api/waha/sessions/{name}/qr")
async def waha_get_qr(name: str, user: str = Depends(auth.get_current_user)):
    """Get QR code as base64 PNG for scanning."""
    wh = get_waha()
    qr = await wh.get_qr(name)
    if qr is None:
        raise HTTPException(404, "QR not available. Session may not be in SCAN_QR_CODE state.")
    return {"qr": qr, "session": name}

@router.get("/api/waha/sessions/{name}/status")
async def waha_session_status(name: str, user: str = Depends(auth.get_current_user)):
    """Get detailed status of a WAHA session."""
    wh = get_waha()
    sessions = await wh.list_sessions()
    for s in sessions:
        if s.get("name") == name:
            me_info = await wh.get_me(name)
            return {"session": s, "me": me_info}
    raise HTTPException(404, f"Session '{name}' not found")

@router.get("/api/waha/health")
async def waha_health(user: str = Depends(auth.get_current_user)):
    wh = get_waha()
    ok = await wh.health()
    return {"ok": ok, "base_url": wh.base_url}

# ========== Webhook ==========
@router.post("/webhook/waha")
async def webhook(payload: dict, x_webhook_secret: str | None = Header(None)):
    """Receive messages from WAHA webhook. Only document/image messages stored.
    Security: validates X-Webhook-Secret ONLY if WEBHOOK_SECRET env is explicitly set."""
    # Webhook secret is optional — only enforce if explicitly configured
    import os as _os
    wh_secret = _os.getenv("WEBHOOK_SECRET", "")
    if wh_secret and wh_secret not in ("", "change-me", "d60aa707cd3968b95028ee1c81dd8a91bf66b8b087776f9e"):
        if not x_webhook_secret or not hmac.compare_digest(x_webhook_secret, wh_secret):
            raise HTTPException(401, "Invalid webhook secret")
    
    # Extract event ID for idempotency
    eid = str(payload.get("id") or payload.get("event_id") or "")
    if not eid:
        # Generate from hash for idempotency
        eid = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:16]
    
    repo = await get_repository()
    if not await repo.add_event(eid):
        return {"accepted": False, "duplicate": True}
    
    # Extract message
    msg = payload.get("message") or payload.get("data") or payload
    media = msg.get("media") or {}
    mime = media.get("mimetype", msg.get("mimetype", ""))
    filename = media.get("filename", msg.get("filename", ""))
    
    if not _is_document(mime, filename):
        return {"accepted": False, "duplicate": False, "reason": "not a document or image"}
    
    did = msg.get("id", eid)
    session_name = payload.get("session", "default")
    doc = {
        "id": did,
        "filename": filename or "whatsapp-file",
        "mime_type": mime or "application/octet-stream",
        "source": "whatsapp",
        "sender": str(msg.get("from", "")),
        "url": media.get("url", ""),
        "status": "unanalyzed",
        "waha_session": session_name,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "metadata": {"event_id": eid},
    }
    await repo.add_document(doc)
    await ws_manager.broadcast({"type": "document.created", "data": doc})
    return {"accepted": True, "duplicate": False, "document_id": did}

# ========== Documents ==========
@router.get("/api/documents")
async def list_documents(q: str|None=None, status: str|None=None, limit: int=50, user: str=Depends(auth.get_current_user)):
    return await (await get_repository()).get_documents(q=q, status=status, limit=limit)

@router.get("/api/documents/{doc_id}")
async def get_document(doc_id: str, user: str=Depends(auth.get_current_user)):
    doc = await (await get_repository()).get_document(doc_id)
    if not doc: raise HTTPException(404, "Document not found")
    return doc

@router.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str, user: str=Depends(auth.get_current_user)):
    if not await (await get_repository()).delete_document(doc_id): raise HTTPException(404)
    return {"deleted": True}

# ========== Analysis (manual only) ==========
@router.post("/api/analysis/run")
async def run_analysis(user: str=Depends(auth.get_current_user)):
    repo = await get_repository()
    result = await repo.get_documents(status="unanalyzed", limit=1000)
    for doc in result["items"]:
        doc["status"] = "processing"
        await repo.update_document(doc["id"], doc)
        await ws_manager.broadcast({"type": "document.updated", "data": doc})
    async def _analyze():
        for doc in result["items"]:
            await asyncio.sleep(0)
            doc["status"] = "analyzed"
            doc["metadata"] = {**(doc.get("metadata") or {}), "analysis": {"provider": "none", "extracted": False, "note": "No AI provider configured"}}
            await repo.update_document(doc["id"], doc)
            await ws_manager.broadcast({"type": "document.updated", "data": doc})
    asyncio.create_task(_analyze())
    return {"queued": len(result["items"])}

@router.post("/api/analysis/run/{doc_id}")
async def analyze_single(doc_id: str, user: str=Depends(auth.get_current_user)):
    repo = await get_repository()
    doc = await repo.get_document(doc_id)
    if not doc: raise HTTPException(404)
    doc["status"] = "processing"
    await repo.update_document(doc_id, doc)
    await ws_manager.broadcast({"type": "document.updated", "data": doc})
    async def _do():
        doc["status"] = "analyzed"
        doc["metadata"] = {**(doc.get("metadata") or {}), "analysis": {"provider": "none", "extracted": False}}
        await repo.update_document(doc_id, doc)
        await ws_manager.broadcast({"type": "document.updated", "data": doc})
    asyncio.create_task(_do())
    return {"queued": 1}

# ========== Stats, Settings, Providers ==========
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
            if data["api_key"]: data["api_key"] = auth.encrypt_api_key(data["api_key"])
            else: data["api_key"] = p.get("api_key","")
            data["id"] = data["name"]
            p.update(data)
            await repo.add_provider(p)
            return {k:v for k,v in p.items() if k!="api_key"}
    raise HTTPException(404)

@router.get("/api/provider-presets")
async def get_provider_presets(user: str=Depends(auth.get_current_user)):
    return {"presets": PROVIDER_PRESETS}

# ========== WebSocket ==========
@router.websocket("/ws")
async def ws_endpoint(socket: WebSocket):
    from jose import JWTError
    from jose import jwt as jose_jwt
    allowed = [o.strip() for o in os.getenv("CORS_ORIGINS","").split(",") if o.strip()]
    if not allowed and (os.getenv("ENV","") or "production").lower() in ("dev","test"):
        allowed = ["http://localhost:5173","http://127.0.0.1:5173"]
    origin = socket.headers.get("origin","")
    if allowed and origin and origin not in allowed:
        await socket.close(code=1008); return
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
