from __future__ import annotations
import os, time, asyncio
from collections import defaultdict
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .auth import init_auth
from .routes import router


# ---------------------------------------------------------------------------
# Rate limiting — simple in-memory sliding window
# ---------------------------------------------------------------------------
_rate_window: int = int(os.getenv('RATE_LIMIT_WINDOW_SEC', '60'))
_rate_max: int = int(os.getenv('RATE_LIMIT_MAX', '200'))
_rate_buckets: dict[str, list[float]] = defaultdict(list)
_rate_lock = asyncio.Lock()

# Dedicated login rate limiter (5 req/min/IP)
_login_window: int = 60
_login_max: int = 5
_login_buckets: dict[str, list[float]] = defaultdict(list)
_login_lock = asyncio.Lock()


_max_body_bytes: int = int(os.getenv('MAX_BODY_SIZE_BYTES', str(5 * 1024 * 1024)))  # 5 MB default


async def _rate_limit_middleware(request: Request, call_next):
    # Skip rate limiting for test/dev environments
    env = (os.getenv('ENV', 'production') or 'production').lower()
    if env in ('test', 'dev', 'development'):
        return await call_next(request)

    key = request.client.host if request.client else 'unknown'
    now = time.monotonic()

    # Body size protection for webhook ingress
    if request.url.path == '/webhook/waha' and request.method == 'POST':
        content_length = request.headers.get('content-length')
        if content_length and int(content_length) > _max_body_bytes:
            from fastapi.responses import JSONResponse
            return JSONResponse(
                {'detail': 'Request body too large'},
                status_code=413,
            )

    # Login-specific rate limit
    if request.url.path == '/api/auth/login' and request.method == 'POST':
        async with _login_lock:
            bucket = _login_buckets[key]
            bucket[:] = [t for t in bucket if now - t < _login_window]
            if len(bucket) >= _login_max:
                from fastapi.responses import JSONResponse
                return JSONResponse(
                    {'detail': 'Too many login attempts — try again later'},
                    status_code=429,
                )
            bucket.append(now)

    # Global rate limit
    async with _rate_lock:
        bucket = _rate_buckets[key]
        bucket[:] = [t for t in bucket if now - t < _rate_window]
        if len(bucket) >= _rate_max:
            from fastapi.responses import JSONResponse
            return JSONResponse(
                {'detail': 'Rate limit exceeded'},
                status_code=429,
            )
        bucket.append(now)
    return await call_next(request)


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_auth()
    yield


# ---------------------------------------------------------------------------
# CORS — restrictive by default, configurable via CORS_ORIGINS
# ---------------------------------------------------------------------------
_cors_origins_raw = os.getenv('CORS_ORIGINS', '')
if _cors_origins_raw:
    _cors_origins = [o.strip() for o in _cors_origins_raw.split(',') if o.strip()]
else:
    env = (os.getenv('ENV', 'production') or 'production').lower()
    if env in ('dev', 'development', 'test'):
        _cors_origins = ['http://localhost:5173', 'http://127.0.0.1:5173']
    else:
        _cors_origins = []

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
_enable_docs = os.getenv('ENABLE_DOCS', '').lower() in ('1', 'true', 'yes')
app = FastAPI(
    title='MemoriWA API',
    version='2.0.0',
    lifespan=lifespan,
    docs_url='/docs' if _enable_docs else None,
    redoc_url=None,
)

if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
        allow_headers=['Authorization', 'Content-Type', 'X-Webhook-Secret'],
    )

app.middleware('http')(_rate_limit_middleware)
app.include_router(router)
