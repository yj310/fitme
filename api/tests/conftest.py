import base64
import json
import os

import pytest

os.environ.setdefault("APP_ENV", "development")
os.environ.setdefault("NVIDIA_API_KEY", "fake-nvidia-key-for-tests")
os.environ.setdefault("GEMINI_API_KEY", "fake-gemini-key-for-tests")
os.environ.setdefault("AI_KEY_ENCRYPTION_KEY", base64.b64encode(b"k" * 32).decode())
os.environ.setdefault("SUPABASE_URL", "")

from fastapi.testclient import TestClient  # noqa: E402

from app.auth import AuthUser, current_user  # noqa: E402
from app.db.memory import MemoryDB, MemoryStore  # noqa: E402
from app.deps import Ctx  # noqa: E402
from app.llm.router import LLMService  # noqa: E402
from app.main import create_app  # noqa: E402
from tests.fakes import WARDROBE, FakeAdapter, FakeStorage, FakeWeather  # noqa: E402

USER_A = "11111111-1111-1111-1111-111111111111"
USER_B = "22222222-2222-2222-2222-222222222222"


class Harness:
    def __init__(self):
        self.mdb = MemoryDB()
        self.weather = FakeWeather()
        self.adapters: dict[str, FakeAdapter] = {}
        self.calls: list = []
        self.current = USER_A
        self.storages: dict[str, FakeStorage] = {}
        app = create_app()
        app.dependency_overrides[current_user] = lambda: AuthUser(self.current, "token", "테스터", None)
        app.state.ctx_factory = self.make_ctx
        self.app = app
        self.client_cm = TestClient(app)
        self.client = self.client_cm.__enter__()
        app.state.services.weather = self.weather

    def adapter_for(self, route):
        a = self.adapters.get(route.provider)
        if a is None:
            a = FakeAdapter(route.provider, calls=self.calls)
        return a

    def make_ctx(self, user, app_services):
        store = MemoryStore(user.id, self.mdb)
        storage = self.storages.setdefault(user.id, FakeStorage(user.id))
        llm = LLMService(app_services.settings, app_services.cfg, app_services.pricing, app_services.http, store,
                         adapter_factory=self.adapter_for, sleep=_nosleep)
        return Ctx(user, store, storage, llm, app_services)

    def as_user(self, uid):
        self.current = uid
        return self

    async def seed(self, uid=USER_A, wardrobe=WARDROBE, grid=(59, 127)):
        store = MemoryStore(uid, self.mdb)
        await store.ensure_user("테스터", None)
        await store.update_user({"grid_nx": grid[0], "grid_ny": grid[1], "preferred_fit": "semi_over"})
        for w in wardrobe:
            await store.insert_item(dict(w))
        return store

    def chat(self, message, conversation_id=None, answer=None):
        body = {"conversation_id": conversation_id, "message": message}
        if answer:
            body["answer"] = answer
        r = self.client.post("/api/v1/chat", json=body)
        assert r.status_code == 200, r.text
        return parse_sse(r.text)


async def _nosleep(_):
    return None


def parse_sse(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.strip().split("\n\n"):
        lines = block.split("\n")
        ev = next(line[7:] for line in lines if line.startswith("event: "))
        data = json.loads(next(line[6:] for line in lines if line.startswith("data: ")))
        events.append((ev, data))
    return events


@pytest.fixture
def h():
    harness = Harness()
    yield harness
    harness.client_cm.__exit__(None, None, None)
