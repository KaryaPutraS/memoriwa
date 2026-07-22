"""MemoriWA — main FastAPI application with built-in WAHA."""
from __future__ import annotations
import os, time, asyncio
from collections import defaultdict
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .auth import init_auth
from .routes import router
from .waha_client import WAHAClient

# ---- Rate Limiting ----
_rate_window: int = int(os.getenv("RATE_LIMIT_WINDOW_SEC", "60"))
_rate_max: int = int(os.getenv("RATE_LIMIT_MAX", "200"))
_rate_buckets: dict[str, list[float]] = defaultdict(list)
_rate_lock = asyncio.Lock()
_login_window: int = 60
_login_max: int = 5
_login_buckets: dict[str, list[float]] = defaultdict(list)
_login_lock = asyncio.Lock()
_max_body_bytes: int = int(os.getenv("MAX_BODY_SIZE_BYTES", str(5 * 1024 * 1024)))

async def _rate_limit_middleware(request: Request, call_next):
    env = (os.getenv("ENV", "production") or "production").lower()
    if env in ("test", "dev", "development"):
        return await call_next(request)
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    if request.url.path == "/webhook/waha" and request.method == "POST":
        content_length = request.headers.get("content-length")
        if content_length and int(content_length) > _max_body_bytes:
            from fastapi.responses import JSONResponse
            return JSONResponse({"detail": "Request body too large"}, status_code=413)
    if request.url.path == "/api/auth/login" and request.method == "POST":
        async with _login_lock:
            bucket = _login_buckets[key]
            bucket[:] = [t for t in bucket if now - t < _login_window]
            if len(bucket) >= _login_max:
                from fastapi.responses import JSONResponse
                return JSONResponse({"detail": "Too many login attempts"}, status_code=429)
            bucket.append(now)
    async with _rate_lock:
        bucket = _rate_buckets[key]
        bucket[:] = [t for t in bucket if now - t < _rate_window]
        if len(bucket) >= _rate_max:
            from fastapi.responses import JSONResponse
            return JSONResponse({"detail": "Rate limit exceeded"}, status_code=429)
        bucket.append(now)
    return await call_next(request)

# ---- CORS ----
_cors_origins_raw = os.getenv("CORS_ORIGINS", "")
if _cors_origins_raw:
    _cors_origins = [o.strip() for o in _cors_origins_raw.split(",") if o.strip()]
else:
    _cors_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]

# ---- App ----
_enable_docs = os.getenv("ENABLE_DOCS", "").lower() in ("1", "true", "yes")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Init auth
    init_auth()
    
    # Init WAHA client — auto-connect to WAHA container
    waha_url = os.getenv("WAHA_URL", "http://waha:3000")
    waha_key = os.getenv("WAHA_API_KEY", "")
    
    # Import routes module to set the global waha client
    from . import routes as r
    r.waha = WAHAClient(base_url=waha_url, api_key=waha_key)
    
    # Test WAHA connectivity
    try:
        ok = await r.waha.health()
        print(f"WAHA connection: {'OK' if ok else 'FAILED'} ({waha_url})")
    except Exception as e:
        print(f"WAHA connection error: {e}")
    
    yield
    
    # Cleanup
    if r.waha and r.waha._client:
        await r.waha._client.aclose()

app = FastAPI(
    title="MemoriWA — Document Intelligence",
    version="3.0.0",
    lifespan=lifespan,
    docs_url="/docs" if _enable_docs else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health_direct():
    return {"status": "ok", "storage": "memory", "waha": "configured"}

app.middleware("http")(_rate_limit_middleware)
app.include_router(router)
