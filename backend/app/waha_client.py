"""WAHA API Client — internal integration with WAHA WhatsApp API."""
from __future__ import annotations
import httpx, asyncio, logging
from typing import Any

logger = logging.getLogger("memoriwa.waha")

class WAHAClient:
    """Talks to the built-in WAHA container."""
    
    def __init__(self, base_url: str = "http://waha:3000", api_key: str = ""):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self._client: httpx.AsyncClient | None = None
    
    @property
    def client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=30)
        return self._client
    
    def _headers(self) -> dict:
        h = {"Accept": "application/json", "Content-Type": "application/json"}
        if self.api_key:
            h["X-Api-Key"] = self.api_key
        return h
    
    async def list_sessions(self) -> list[dict]:
        r = await self.client.get(f"{self.base_url}/api/sessions", headers=self._headers())
        r.raise_for_status()
        return r.json()
    
    async def create_session(self, name: str, webhook_url: str = "") -> dict:
        """Create a new WAHA session with webhook configured."""
        config: dict[str, Any] = {}
        if webhook_url:
            config["webhooks"] = [{
                "url": webhook_url,
                "events": ["message"]
            }]
        body = {"name": name, "config": config}
        r = await self.client.post(f"{self.base_url}/api/sessions", headers=self._headers(), json=body)
        r.raise_for_status()
        return r.json()
    
    async def start_session(self, name: str) -> dict:
        r = await self.client.post(f"{self.base_url}/api/sessions/{name}/start", headers=self._headers())
        r.raise_for_status()
        return r.json()
    
    async def stop_session(self, name: str) -> dict:
        r = await self.client.post(f"{self.base_url}/api/sessions/{name}/stop", headers=self._headers())
        r.raise_for_status()
        return r.json()
    
    async def logout_session(self, name: str) -> dict:
        r = await self.client.delete(f"{self.base_url}/api/sessions/{name}", headers=self._headers())
        r.raise_for_status()
        # WAHA DELETE returns 204 No Content on success
        if r.status_code == 204:
            return {"deleted": True, "name": name}
        return r.json()
        r.raise_for_status()
        return r.json()
    
    async def get_qr(self, session: str) -> str | None:
        """Get QR code as base64 PNG string. Returns None if no QR available."""
        try:
            r = await self.client.get(
                f"{self.base_url}/api/{session}/auth/qr",
                headers=self._headers()
            )
            if r.status_code != 200:
                return None
            
            # Try JSON first — WAHA returns {"data": "base64..."} or {"qr": "base64..."}
            import base64
            text = r.text
            if text.startswith("{"):
                try:
                    data = r.json()
                    qr = data.get("data") or data.get("qr")
                    if qr:
                        return qr
                except Exception:
                    pass
            
            # Fallback: raw PNG binary → encode to base64
            if len(r.content) > 100:
                return base64.b64encode(r.content).decode()
            
            return None
        except Exception as e:
            logger.warning(f"QR fetch failed for {session}: {e}")
            return None
    
    async def get_screenshot(self, session: str) -> str | None:
        """Get session screenshot as base64."""
        try:
            r = await self.client.get(
                f"{self.base_url}/api/{session}/screenshot",
                headers=self._headers()
            )
            if r.status_code == 200:
                return r.text  # base64
            return None
        except Exception:
            return None
    
    async def get_me(self, session: str) -> dict | None:
        try:
            r = await self.client.get(f"{self.base_url}/api/{session}/me", headers=self._headers())
            if r.status_code == 200:
                return r.json()
            return None
        except Exception:
            return None
    
    async def send_text(self, session: str, chat_id: str, text: str) -> dict:
        body = {"chatId": chat_id, "text": text}
        r = await self.client.post(f"{self.base_url}/api/{session}/sendText", headers=self._headers(), json=body)
        r.raise_for_status()
        return r.json()
    
    async def health(self) -> bool:
        try:
            r = await self.client.get(f"{self.base_url}/api/sessions", headers=self._headers(), timeout=5)
            return r.status_code == 200
        except Exception:
            return False
