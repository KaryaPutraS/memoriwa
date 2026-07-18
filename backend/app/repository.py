from __future__ import annotations
import asyncio
from typing import Any
from abc import ABC, abstractmethod


class Repository(ABC):
    @abstractmethod
    async def add_event(self, eid: str) -> bool: ...
    @abstractmethod
    async def add_document(self, doc: dict) -> None: ...
    @abstractmethod
    async def get_documents(self, q: str | None = None, status: str | None = None,
                            limit: int = 50) -> dict: ...
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
    async def get_sessions(self) -> list[dict]: ...


class MemoryRepository(Repository):
    def __init__(self):
        self.docs: dict[str, dict] = {}
        self.events: set[str] = set()
        self.providers: dict[str, dict] = {}
        self.settings: dict[str, Any] = {}
        self.sessions: dict[str, dict] = {}
        self.lock = asyncio.Lock()

    async def add_event(self, eid: str) -> bool:
        async with self.lock:
            if eid in self.events:
                return False
            self.events.add(eid)
            return True

    async def add_document(self, doc: dict) -> None:
        self.docs[doc['id']] = doc

    async def get_documents(self, q: str | None = None, status: str | None = None,
                            limit: int = 50) -> dict:
        items = list(self.docs.values())
        items.sort(key=lambda d: d.get('created_at', ''), reverse=True)
        if q:
            ql = q.lower()
            items = [d for d in items if ql in d.get('filename', '').lower()
                     or ql in d.get('sender', '').lower()]
        if status:
            items = [d for d in items if d.get('status') == status]
        total = len(items)
        return {'items': items[:min(limit, 100)], 'total': total}

    async def get_document(self, doc_id: str) -> dict | None:
        return self.docs.get(doc_id)

    async def update_document(self, doc_id: str, data: dict) -> dict | None:
        if doc_id not in self.docs:
            return None
        allowed = {'filename', 'status', 'metadata'}
        self.docs[doc_id].update({k: v for k, v in data.items() if k in allowed})
        return self.docs[doc_id]

    async def delete_document(self, doc_id: str) -> bool:
        return self.docs.pop(doc_id, None) is not None

    async def get_stats(self) -> dict:
        counts = {}
        for s in ('unanalyzed', 'processing', 'analyzed', 'failed'):
            counts[s] = sum(1 for d in self.docs.values() if d.get('status') == s)
        return {'total': len(self.docs), **counts}

    async def get_settings(self) -> dict:
        return dict(self.settings)

    async def save_settings(self, data: dict) -> dict:
        self.settings = dict(data)
        return self.settings

    async def get_providers(self) -> list[dict]:
        return list(self.providers.values())

    async def add_provider(self, data: dict) -> dict:
        data['id'] = data.get('name', '')
        self.providers[data['name']] = data
        return data

    async def delete_provider(self, name: str) -> bool:
        return self.providers.pop(name, None) is not None

    async def get_sessions(self) -> list[dict]:
        return list(self.sessions.values())


_repo: Repository | None = None


async def get_repository() -> Repository:
    global _repo
    if _repo is not None:
        return _repo
    import os
    mongo_uri = os.getenv('MONGO_URI', '')
    if mongo_uri:
        try:
            from motor.motor_asyncio import AsyncIOMotorClient
            client = AsyncIOMotorClient(mongo_uri, serverSelectionTimeoutMS=3000)
            await client.admin.command('ping')
        except Exception:
            pass
    _repo = MemoryRepository()
    return _repo


def set_repository(repo: Repository) -> None:
    global _repo
    _repo = repo
