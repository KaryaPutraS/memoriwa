from __future__ import annotations
import base64, hashlib, hmac, os, secrets
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from cryptography.fernet import Fernet
from jose import jwt, JWTError

bearer_scheme = HTTPBearer(auto_error=False)
ALGO = 'HS256'
JWT_SECRET: str = ''
WEBHOOK_SECRET: str = ''
ADMIN_USERNAME: str = ''
ADMIN_PASSWORD_HASH: str = ''
_fernet: Fernet | None = None


def _get_secret(name: str, min_len: int = 16) -> str:
    val = os.getenv(name, '')
    env = (os.getenv('ENV', 'production') or 'production').lower()
    if env in ('dev', 'development', 'test'):
        if not val:
            val = f'dev-{name.lower()}-{"x" * 12}'
        return val
    if not val or len(val) < min_len:
        raise RuntimeError(f'{name} must be set in production mode (min {min_len} chars). Set ENV=dev for development.')
    return val


def _get_secret_optional(name: str) -> str:
    return os.getenv(name, '')


def init_auth():
    global JWT_SECRET, WEBHOOK_SECRET, ADMIN_USERNAME, ADMIN_PASSWORD_HASH, _fernet
    JWT_SECRET = _get_secret('JWT_SECRET', 32)
    # Webhook shared secret — required in production so the webhook endpoint
    # cannot be used by strangers to inject fake documents. Optional in dev/test.
    env = (os.getenv('ENV', 'production') or 'production').lower()
    if env in ('dev', 'development', 'test'):
        WEBHOOK_SECRET = os.getenv('WEBHOOK_SECRET', '')
    else:
        WEBHOOK_SECRET = _get_secret('WEBHOOK_SECRET', 16)
    # Derive Fernet key from JWT_SECRET so it's deterministic per deployment
    _fernet_key = base64.urlsafe_b64encode(
        hashlib.sha256(JWT_SECRET.encode('utf-8')).digest()
    )
    _fernet = Fernet(_fernet_key)
    ADMIN_USERNAME = os.getenv('ADMIN_USERNAME', '') or 'admin'
    raw_password = os.getenv('ADMIN_PASSWORD', '')
    if not raw_password:
        env = (os.getenv('ENV', 'production') or 'production').lower()
        if env in ('dev', 'development', 'test'):
            raw_password = 'admin-dev-password'
        else:
            raise RuntimeError('ADMIN_PASSWORD must be set in production mode.')
    ADMIN_PASSWORD_HASH = _hash_password(raw_password)
    if os.getenv('ENV', '').lower() == 'test':
        ADMIN_PASSWORD_HASH = _hash_password('admin-test-password')


def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(32)
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, 600_000)
    return f'pbkdf2:sha256:600000${salt.hex()}${key.hex()}'


# Public alias for callers that mint new hashes (e.g. change-password).
hash_password = _hash_password


def verify_password(password: str, hashed: str) -> bool:
    try:
        parts = hashed.split('$')
        prefix = parts[0].split(':')
        algo = prefix[1]
        iterations = int(prefix[2])
        salt = bytes.fromhex(parts[1])
        key = bytes.fromhex(parts[2])
        new_key = hashlib.pbkdf2_hmac(algo, password.encode('utf-8'), salt, iterations)
        return hmac.compare_digest(key, new_key)
    except Exception:
        return False


def create_token(sub: str = 'admin') -> str:
    return jwt.encode(
        {'sub': sub, 'exp': datetime.now(timezone.utc) + timedelta(hours=12)},
        JWT_SECRET, algorithm=ALGO,
    )


async def get_current_user(creds: HTTPAuthorizationCredentials = Depends(bearer_scheme)):
    if not creds:
        raise HTTPException(401, 'Authentication required')
    try:
        return jwt.decode(creds.credentials, JWT_SECRET, algorithms=[ALGO])['sub']
    except JWTError:
        raise HTTPException(401, 'Invalid or expired token')


def encrypt_api_key(plaintext: str) -> str:
    """Encrypt a provider API key with Fernet (AES-128-CBC + HMAC)."""
    if not _fernet:
        raise RuntimeError('Auth not initialized — call init_auth() first')
    return _fernet.encrypt(plaintext.encode('utf-8')).decode('utf-8')


def decrypt_api_key(token: str) -> str:
    """Decrypt a provider API key. Returns empty string on failure."""
    if not _fernet:
        raise RuntimeError('Auth not initialized — call init_auth() first')
    try:
        return _fernet.decrypt(token.encode('utf-8')).decode('utf-8')
    except Exception:
        return ''
