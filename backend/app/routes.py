"""MemoriWA Routes — single-tenant."""
from __future__ import annotations
import hashlib, hmac, asyncio, json, logging, os
from datetime import datetime, timezone, timedelta
from typing import Any
from fastapi import APIRouter, HTTPException, Depends, Header, WebSocket, WebSocketDisconnect, Query
from pydantic import BaseModel
import app.auth as auth
import app.analysis as analysis
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
class SettingsRequest(BaseModel):
    theme: str = "system"; language: str = "id"; auto_analyze: bool = False
    # Dedicated vision/OCR endpoint (OpenAI-compatible). vision_api_key is
    # write-only: never returned by GET /api/settings.
    vision_base_url: str = ""; vision_model: str = ""; vision_api_key: str = ""
    # Branding: data URLs (e.g. "data:image/png;base64,...") for the
    # dashboard logo and favicon, set from Settings -> General.
    logo_data: str = ""; favicon_data: str = ""

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

def _extract_message(payload: dict) -> dict:
    """Normalize WAHA webhook shapes: the message object may live under
    'message', 'data', or 'payload' (the real WAHA format), or at top level.

    This is the piece that makes caption grouping work in production: real
    WAHA webhooks nest everything under payload.payload, and the old text
    branch never looked there — so explanation texts were never seen.
    """
    for key in ("message", "data", "payload"):
        m = payload.get(key)
        if isinstance(m, dict) and any(k in m for k in ("id", "from", "author", "body", "media", "mediaData")):
            return m
    return payload if isinstance(payload, dict) else {}

def _extract_media(payload: dict) -> dict:
    """Extract media info from various WAHA webhook formats."""
    msg = _extract_message(payload)
    if isinstance(msg, dict):
        # Format 1: msg.media / msg.mediaData (most common)
        media = msg.get("media") or msg.get("mediaData") or {}
        if media:
            return media
        # Format 2: payload.payload.media
        inner = payload.get("payload") or {}
        if isinstance(inner, dict) and inner is not msg:
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
    # Default: WAHA reaches the webhook inside the docker network — the
    # endpoint never has to be exposed to the internet.
    webhook_url = os.getenv("MEMORIWA_WEBHOOK_URL", "http://api:8000/webhook/waha")
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
        # Session missing/stopped/FAILED — (re)start it and wait for the
        # engine to reach SCAN_QR_CODE (Chromium boot can take ~10s).
        try:
            session = await wh.get_session()
            if session and session.get("status") == "FAILED":
                try: await wh.stop()
                except Exception: pass
            await waha_start(user=user)
            import asyncio as _a
            for _ in range(8):
                await _a.sleep(2)
                qr = await wh.get_qr()
                if qr: break
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

    # Only process real message events — skip acks, reactions, session status.
    event = str(payload.get("event") or "")
    if event and event not in ("message", "message.any"):
        return {"accepted": False, "reason": f"ignored event: {event}"}

    repo = await get_repository()
    msg = _extract_message(payload)

    # Generate event ID for idempotency
    eid = str(payload.get("id") or payload.get("eventId") or "")
    if not eid and isinstance(msg, dict):
        eid = str(msg.get("id") or "")
    if not eid:
        eid = hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()[:16]

    # Idempotency check
    if not await repo.add_event(eid):
        return {"accepted": False, "duplicate": True, "event_id": eid}

    # Extract media
    media = _extract_media(payload)
    if not media:
        # Text-only message: the first text after a burst of photos becomes
        # their explanation and groups them (activity documentation flow).
        body = msg.get("body", "") if isinstance(msg, dict) else ""
        if body:
            attached = await _attach_caption(repo, msg, body, eid)
            if attached:
                for d in attached:
                    await ws_manager.broadcast({"type": "document.updated", "data": d})
                # Background: turn the raw report text into a clean identity
                # (keywords title/tags) with the configured AI.
                asyncio.create_task(_ai_identify_burst(repo, attached, body))
                return {"accepted": True, "caption_group": eid, "images": len(attached), "event_id": eid}
            return {"accepted": False, "reason": "text-only message", "event_id": eid}
        return {"accepted": False, "reason": "no media found", "event_id": eid}

    # Extract sender
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

    did = str(msg.get("id") or eid) if isinstance(msg, dict) else eid
    caption = str(msg.get("body") or msg.get("caption") or "") if isinstance(msg, dict) else ""
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
            "caption": caption,
        },
    }
    await repo.add_document(doc)
    await ws_manager.broadcast({"type": "document.created", "data": doc})

    # A caption carried by a photo doubles as the explanation for the whole
    # burst — group this photo with the recent ungrouped images of the same
    # sender, exactly like a text message sent right after the photos.
    if is_img and caption:
        attached = await _attach_caption(repo, msg, caption, eid)
        for d in attached:
            await ws_manager.broadcast({"type": "document.updated", "data": d})
        asyncio.create_task(_ai_identify_burst(repo, attached, caption))

    settings = await repo.get_settings() or {}
    # Images are not auto-analyzed: activity photos wait for their caption
    # text and then human verification instead of AI analysis.
    if settings.get("auto_analyze") and not is_img:
        # WAHA only keeps media files briefly — analyze immediately while
        # the bytes are still downloadable.
        doc["status"] = "processing"
        await repo.update_document(did, doc)
        await ws_manager.broadcast({"type": "document.updated", "data": doc})
        async def _auto():
            await analysis.analyze_document(doc, waha, repo,
                on_update=lambda d: ws_manager.broadcast({"type": "document.updated", "data": d}))
        asyncio.create_task(_auto())
    return {"accepted": True, "document_id": did, "event_id": eid}

# Documents
CAPTION_WINDOW_MINUTES = 10  # hard outer lookback limit (safety net only)
CAPTION_BURST_GAP_SECONDS = int(os.getenv("CAPTION_BURST_GAP_SEC", "120"))

async def _attach_caption(repo, msg: dict, body: str, eid: str) -> list[dict]:
    """Attach a text message as explanation to the LATEST photo burst from
    the same sender.

    A burst = consecutive ungrouped images where each arrived within
    CAPTION_BURST_GAP_SECONDS of the previous one. This keeps different
    activities separate even inside the outer 10-minute window: photos A,
    text A, photos B, text B — each text only explains its own burst, and
    an older burst is never swallowed by a newer explanation. Photos with
    no follow-up text simply stay ungrouped in the Inbox (the fallback).
    """
    sender = str(msg.get("from") or msg.get("author") or msg.get("sender") or "") if isinstance(msg, dict) else ""
    if "@" in sender:
        sender = sender.split("@")[0]
    if not sender:
        return []
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=CAPTION_WINDOW_MINUTES)
    result = await repo.get_documents(limit=100)
    cands: list[tuple[datetime, dict]] = []
    for d in result["items"]:
        if d.get("sender") != sender:
            continue
        if not str(d.get("mime_type") or "").startswith("image/"):
            continue
        if d.get("status") == "analyzed":
            continue
        meta = d.get("metadata") or {}
        if meta.get("group_id") or meta.get("explanation"):
            continue
        try:
            ts = datetime.fromisoformat(str(d.get("created_at")))
        except Exception:
            continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if ts < cutoff:
            continue
        cands.append((ts, d))
    if not cands:
        return []
    cands.sort(key=lambda x: x[0])
    # Keep only the newest contiguous burst: walk backwards from the latest
    # photo while the gap between consecutive photos is small enough to be
    # one activity. A larger gap marks an older, separate burst.
    burst: list[tuple[datetime, dict]] = [cands[-1]]
    for prev in reversed(cands[:-1]):
        gap = (burst[0][0] - prev[0]).total_seconds()
        if gap <= CAPTION_BURST_GAP_SECONDS:
            burst.insert(0, prev)
        else:
            break
    out: list[dict] = []
    for _, d in burst:
        meta = dict(d.get("metadata") or {})
        meta["explanation"] = body
        meta["group_id"] = eid
        d["metadata"] = meta
        await repo.update_document(d["id"], d)
        out.append(d)
    return out

async def _ai_identify_burst(repo, docs: list[dict], text: str) -> None:
    """Background task: ask the configured AI to condense the raw report text
    into a keyword identity (short title, activity doc_type, tags) and stamp it
    on every photo of the burst, so Files/Inbox show "Apel Pagi Bid TIK"
    instead of the full greeting-laden caption."""
    try:
        ident = await analysis.caption_identity(repo, text)
        if not ident:
            return
        for d in docs:
            cur = await repo.get_document(d["id"])
            if not cur:
                continue
            if cur.get("status") == "analyzed":
                continue  # never clobber a finished analysis
            meta = dict(cur.get("metadata") or {})
            meta["identity"] = ident
            cur["metadata"] = meta
            await repo.update_document(cur["id"], cur)
            await ws_manager.broadcast({"type": "document.updated", "data": cur})
    except Exception as e:
        logger.warning("burst identity failed: %s", e)

class VerifyRequest(BaseModel): ids: list[str]; folder: str = ""
class GroupUpdateRequest(BaseModel): explanation: str | None = None; folder: str | None = None

@router.post("/api/documents/verify")
async def verify_documents(body: VerifyRequest, user: str=Depends(auth.get_current_user)):
    """Human-verified docs: identity comes from the explanation, no AI run."""
    repo = await get_repository()
    done = 0
    for did in body.ids:
        doc = await repo.get_document(did)
        if not doc: continue
        meta = dict(doc.get("metadata") or {})
        expl = str(meta.get("explanation") or meta.get("caption") or doc.get("filename") or "Dokumentasi")
        if body.folder:
            meta["folder"] = body.folder
        # Keep an identity the AI already built from the caption (clean
        # keyword title) — only fall back to the raw explanation when none
        # exists yet.
        _ident = meta.get("identity")
        if not (isinstance(_ident, dict) and _ident.get("title")):
            meta["identity"] = {
                "title": expl[:80],
                "doc_type": meta.get("folder") or "dokumentasi kegiatan",
                "summary": expl,
                "tags": meta.get("tags") or [],
            }
        meta["progress"] = 100
        doc["metadata"] = meta
        doc["status"] = "analyzed"
        await repo.update_document(did, doc)
        await ws_manager.broadcast({"type": "document.updated", "data": doc})
        done += 1
    return {"verified": done}

@router.put("/api/documents/group/{group_id}")
async def update_group(group_id: str, body: GroupUpdateRequest, user: str=Depends(auth.get_current_user)):
    """Edit the explanation and/or folder of every doc in a photo group."""
    repo = await get_repository()
    result = await repo.get_documents(limit=100)
    n = 0
    for doc in result["items"]:
        if (doc.get("metadata") or {}).get("group_id") != group_id: continue
        meta = dict(doc.get("metadata") or {})
        if body.explanation is not None: meta["explanation"] = body.explanation
        if body.folder: meta["folder"] = body.folder
        doc["metadata"] = meta
        await repo.update_document(doc["id"], doc)
        await ws_manager.broadcast({"type": "document.updated", "data": doc})
        n += 1
    if not n: raise HTTPException(404)
    return {"updated": n}

class DocUpdateRequest(BaseModel):
    folder: str | None = None
    explanation: str | None = None
    title: str | None = None
    ungroup: bool = False
    group: str | None = None  # target group_id — move this doc into another group

@router.put("/api/documents/{doc_id}")
async def update_document_meta(doc_id: str, body: DocUpdateRequest, user: str=Depends(auth.get_current_user)):
    """Edit one document: change folder, explanation/title, or remove it
    from its photo group (ungroup)."""
    repo = await get_repository()
    doc = await repo.get_document(doc_id)
    if not doc: raise HTTPException(404)
    meta = dict(doc.get("metadata") or {})
    if body.folder is not None:
        meta["folder"] = body.folder
        ident = meta.get("identity")
        if isinstance(ident, dict) and ident.get("doc_type"):
            ident["doc_type"] = body.folder or ident["doc_type"]
    if body.explanation is not None:
        meta["explanation"] = body.explanation
        ident = meta.get("identity")
        if isinstance(ident, dict):
            ident["summary"] = body.explanation
            ident["title"] = body.explanation[:80]
    if body.title is not None:
        ident = meta.get("identity")
        if isinstance(ident, dict):
            ident["title"] = body.title
        else:
            meta["title"] = body.title
    if body.ungroup:
        meta.pop("group_id", None)
        meta.pop("explanation", None)
    if body.group is not None:
        # Drag-and-drop move: adopt the target group's explanation and
        # identity so the moved photo looks like a native member.
        result = await repo.get_documents(limit=100)
        members = [d for d in result["items"]
                   if (d.get("metadata") or {}).get("group_id") == body.group and d.get("id") != doc_id]
        if not members:
            raise HTTPException(404, "target group not found")
        mmeta = members[0].get("metadata") or {}
        meta["group_id"] = body.group
        if mmeta.get("explanation") is not None:
            meta["explanation"] = mmeta.get("explanation")
        if isinstance(mmeta.get("identity"), dict):
            meta["identity"] = mmeta["identity"]
    doc["metadata"] = meta
    await repo.update_document(doc_id, doc)
    await ws_manager.broadcast({"type": "document.updated", "data": doc})
    return doc

class MoveRequest(BaseModel): ids: list[str]; folder: str

@router.post("/api/documents/move")
async def move_documents(body: MoveRequest, user: str=Depends(auth.get_current_user)):
    """Move several documents into a folder at once."""
    repo = await get_repository()
    n = 0
    for did in body.ids:
        doc = await repo.get_document(did)
        if not doc: continue
        meta = dict(doc.get("metadata") or {})
        meta["folder"] = body.folder
        ident = meta.get("identity")
        if isinstance(ident, dict) and ident.get("doc_type"):
            ident["doc_type"] = body.folder or ident["doc_type"]
        doc["metadata"] = meta
        await repo.update_document(did, doc)
        await ws_manager.broadcast({"type": "document.updated", "data": doc})
        n += 1
    return {"moved": n}

class RenameFolderRequest(BaseModel): old: str; new: str

@router.post("/api/folders/rename")
async def rename_folder(body: RenameFolderRequest, user: str=Depends(auth.get_current_user)):
    """Rename a folder across every document that uses it."""
    repo = await get_repository()
    result = await repo.get_documents(limit=100)
    n = 0
    for doc in result["items"]:
        meta = doc.get("metadata") or {}
        if meta.get("folder") != body.old: continue
        meta = dict(meta)
        meta["folder"] = body.new
        ident = meta.get("identity")
        if isinstance(ident, dict) and ident.get("doc_type") == body.old:
            ident["doc_type"] = body.new
        doc["metadata"] = meta
        await repo.update_document(doc["id"], doc)
        await ws_manager.broadcast({"type": "document.updated", "data": doc})
        n += 1
    if not n: raise HTTPException(404)
    return {"renamed": n}

@router.delete("/api/documents/group/{group_id}")
async def delete_group(group_id: str, user: str=Depends(auth.get_current_user)):
    """Delete every document belonging to a photo group."""
    repo = await get_repository()
    result = await repo.get_documents(limit=100)
    n = 0
    for doc in result["items"]:
        if (doc.get("metadata") or {}).get("group_id") != group_id: continue
        await repo.delete_document(doc["id"])
        n += 1
    if not n: raise HTTPException(404)
    return {"deleted": n}

@router.post("/api/documents/group/{group_id}/identify")
async def identify_group(group_id: str, user: str=Depends(auth.get_current_user)):
    """Re-run AI keyword extraction for a whole photo group: one AI call on
    the group's explanation/caption, applied to every member."""
    repo = await get_repository()
    result = await repo.get_documents(limit=100)
    members = [d for d in result["items"] if (d.get("metadata") or {}).get("group_id") == group_id]
    if not members: raise HTTPException(404)
    text = ""
    for d in members:
        m = d.get("metadata") or {}
        text = str(m.get("explanation") or m.get("caption") or "")
        if text: break
    if not text: raise HTTPException(400, "Group has no explanation/caption text")
    ident = await analysis.caption_identity(repo, text)
    if ident is None: raise HTTPException(503, "No AI provider configured or the request failed")
    for d in members:
        m = dict(d.get("metadata") or {})
        m["identity"] = ident
        d["metadata"] = m
        await repo.update_document(d["id"], d)
        await ws_manager.broadcast({"type": "document.updated", "data": d})
    return {"identified": len(members), "identity": ident}

@router.post("/api/documents/{doc_id}/identify")
async def identify_document(doc_id: str, user: str=Depends(auth.get_current_user)):
    """Re-run AI keyword extraction for one document from its
    explanation/caption text (fixes greeting-laden raw titles)."""
    repo = await get_repository()
    doc = await repo.get_document(doc_id)
    if not doc: raise HTTPException(404)
    meta = doc.get("metadata") or {}
    text = str(meta.get("explanation") or meta.get("caption") or "")
    if not text: raise HTTPException(400, "No explanation/caption text to identify from")
    ident = await analysis.caption_identity(repo, text)
    if ident is None: raise HTTPException(503, "No AI provider configured or the request failed")
    meta = dict(meta)
    meta["identity"] = ident
    doc["metadata"] = meta
    await repo.update_document(doc_id, doc)
    await ws_manager.broadcast({"type": "document.updated", "data": doc})
    return doc

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
            await analysis.analyze_document(doc, waha, repo,
                on_update=lambda d: ws_manager.broadcast({"type": "document.updated", "data": d}))
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
        await analysis.analyze_document(doc, waha, repo,
            on_update=lambda d: ws_manager.broadcast({"type": "document.updated", "data": d}))
    asyncio.create_task(_d())
    return {"queued": 1}

# Stats, Settings, Providers
@router.get("/api/stats")
async def get_stats(user: str=Depends(auth.get_current_user)):
    return await (await get_repository()).get_stats()

@router.get("/api/settings")
async def get_settings(user: str=Depends(auth.get_current_user)):
    s = dict(await (await get_repository()).get_settings() or SettingsRequest().model_dump())
    s["vision_api_key_set"] = bool(s.get("vision_api_key"))
    s.pop("vision_api_key", None)
    return s

@router.put("/api/settings")
async def save_settings(body: SettingsRequest, user: str=Depends(auth.get_current_user)):
    data = body.model_dump()
    if data["vision_api_key"]:
        data["vision_api_key"] = auth.encrypt_api_key(data["vision_api_key"])
    else:
        data.pop("vision_api_key")  # keep the previously stored key
    s = await (await get_repository()).save_settings(data)
    s = dict(s)
    s["vision_api_key_set"] = bool(s.get("vision_api_key"))
    s.pop("vision_api_key", None)
    return s

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
