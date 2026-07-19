"""WAHA Client — single-session (one WhatsApp number per dashboard)."""
from __future__ import annotations
import httpx, logging, base64

logger = logging.getLogger("memoriwa.waha")
DEFAULT_SESSION = "default"

class WAHAClient:
    def __init__(self, base_url: str = "http://waha:3000", api_key: str = ""):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self._client: httpx.AsyncClient | None = None
    
    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None: self._client = httpx.AsyncClient(timeout=30)
        return self._client
    
    def _headers(self) -> dict:
        h = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.api_key: h["X-Api-Key"] = self.api_key
        return h
    
    async def get_session(self) -> dict | None:
        try:
            r = await self.client.get(f"{self.base_url}/api/sessions/{DEFAULT_SESSION}", headers=self._headers())
            if r.status_code == 200: return r.json()
            return None
        except Exception: return None
    
    async def ensure_session(self, webhook_url: str = "") -> dict:
        existing = await self.get_session()
        if existing: return existing
        config = {}
        if webhook_url: config["webhooks"] = [{"url": webhook_url, "events": ["message"]}]
        r = await self.client.post(f"{self.base_url}/api/sessions", headers=self._headers(), json={"name": DEFAULT_SESSION, "config": config})
        r.raise_for_status()
        return r.json()
    
    async def start(self) -> dict:
        r = await self.client.post(f"{self.base_url}/api/sessions/{DEFAULT_SESSION}/start", headers=self._headers())
        r.raise_for_status()
        return r.json()
    
    async def stop(self) -> dict:
        r = await self.client.post(f"{self.base_url}/api/sessions/{DEFAULT_SESSION}/stop", headers=self._headers())
        r.raise_for_status()
        return r.json()
    
    async def logout(self) -> dict:
        r = await self.client.delete(f"{self.base_url}/api/sessions/{DEFAULT_SESSION}", headers=self._headers())
        r.raise_for_status()
        return {"deleted": True}
    
    async def get_qr(self) -> str | None:
        try:
            r = await self.client.get(f"{self.base_url}/api/{DEFAULT_SESSION}/auth/qr", headers=self._headers())
            if r.status_code != 200: return None
            text = r.text
            if text.startswith("{"):
                try:
                    data = r.json()
                    qr = data.get("data") or data.get("qr")
                    if qr: return qr
                except Exception: pass
            if len(r.content) > 100: return base64.b64encode(r.content).decode()
            return None
        except Exception as e:
            logger.warning(f"QR fetch failed: {e}")
            return None
    
    async def get_me(self) -> dict | None:
        try:
            r = await self.client.get(f"{self.base_url}/api/{DEFAULT_SESSION}/me", headers=self._headers())
            if r.status_code == 200: return r.json()
            return None
        except Exception: return None
    
    async def health(self) -> bool:
        try:
            r = await self.client.get(f"{self.base_url}/api/sessions", headers=self._headers(), timeout=5)
            return r.status_code == 200
        except Exception: return False
