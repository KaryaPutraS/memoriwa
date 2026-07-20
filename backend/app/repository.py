"""Repository abstraction — in-memory storage with MongoDB adapter stub."""
from __future__ import annotations
import asyncio, os, json
from typing import Any
from abc import ABC, abstractmethod

class Repository(ABC):
    @abstractmethod
    async def add_event(self, eid: str) -> bool: ...
    @abstractmethod
    async def add_document(self, doc: dict) -> None: ...
    @abstractmethod
    async def get_documents(self, q: str | None = None, status: str | None = None, limit: int = 50) -> dict: ...
    @abstractmethod
    async def get_document(self, doc_id: str) -> dict | None: ...
    @abstractmethod
    async def update_document(self, doc_id: str, data: dict) -> dict | None: ...
    @abstractmethod
    async def delete_document(self, doc_id: str) -> bool: ...
    @abstractmethod
    async def get_stats(self) -> dict: ...
    @abstractmethod
    async def get_settings(self) -> dict: ...
    @abstractmethod
    async def save_settings(self, data: dict) -> dict: ...
    @abstractmethod
    async def get_providers(self) -> list[dict]: ...
    @abstractmethod
    async def add_provider(self, data: dict) -> dict: ...
    @abstractmethod
    async def delete_provider(self, name: str) -> bool: ...
    @abstractmethod
    async def add_waha_session(self, data: dict) -> None: ...
    @abstractmethod
    async def remove_waha_session(self, name: str) -> None: ...
    @abstractmethod
    async def get_waha_sessions(self) -> list[dict]: ...

class MemoryRepository(Repository):
    def __init__(self):
        self.docs: dict[str, dict] = {}
        self.events: set[str] = set()
        self.providers: dict[str, dict] = {}
        self.settings: dict[str, Any] = {}
        self.waha_sessions: dict[str, dict] = {}
        self.lock = asyncio.Lock()

    async def add_event(self, eid: str) -> bool:
        async with self.lock:
            if eid in self.events: return False
            self.events.add(eid)
            return True

    async def add_document(self, doc: dict) -> None:
        async with self.lock:
            self.docs[doc["id"]] = doc

    async def get_documents(self, q: str | None = None, status: str | None = None, limit: int = 50) -> dict:
        items = list(self.docs.values())
        if q:
            ql = q.lower()
            items = [d for d in items if ql in json.dumps(d).lower()]
        if status:
            items = [d for d in items if d.get("status") == status]
        items.sort(key=lambda d: d.get("created_at", ""), reverse=True)
        return {"items": items[:min(limit, 100)], "total": len(items)}

    async def get_document(self, doc_id: str) -> dict | None:
        return self.docs.get(doc_id)

    async def update_document(self, doc_id: str, data: dict) -> dict | None:
        if doc_id not in self.docs: return None
        self.docs[doc_id].update(data)
        return self.docs[doc_id]

    async def delete_document(self, doc_id: str) -> bool:
        return self.docs.pop(doc_id, None) is not None

    async def get_stats(self) -> dict:
        total = len(self.docs)
        counts = {}
        for d in self.docs.values():
            s = d.get("status", "unknown")
            counts[s] = counts.get(s, 0) + 1
        return {"total": total, **counts}

    async def get_settings(self) -> dict:
        return self.settings

    async def save_settings(self, data: dict) -> dict:
        self.settings.update(data)
        return self.settings

    async def get_providers(self) -> list[dict]:
        return list(self.providers.values())

    async def add_provider(self, data: dict) -> dict:
        self.providers[data["id"]] = data
        return data

    async def delete_provider(self, name: str) -> bool:
        return self.providers.pop(name, None) is not None

    async def add_waha_session(self, data: dict) -> None:
        self.waha_sessions[data["name"]] = data

    async def remove_waha_session(self, name: str) -> None:
        self.waha_sessions.pop(name, None)

    async def get_waha_sessions(self) -> list[dict]:
        return list(self.waha_sessions.values())

_repo: Repository | None = None
_lock = asyncio.Lock()

async def get_repository() -> Repository:
    global _repo
    if _repo is None:
        async with _lock:
            if _repo is None:
                mongo_uri = os.getenv("MONGO_URI", "")
                if mongo_uri:
                    try:
                        import motor.motor_asyncio
                        client = motor.motor_asyncio.AsyncIOMotorClient(mongo_uri, serverSelectionTimeoutMS=3000)
                        await client.admin.command("ping")
                        _repo = MemoryRepository()  # TODO: MongoRepository adapter
                    except Exception:
                        _repo = MemoryRepository()
                else:
                    _repo = MemoryRepository()
    return _repo
