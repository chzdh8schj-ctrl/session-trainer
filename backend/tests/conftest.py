import os
import tempfile
from pathlib import Path

TMP_DIR = Path(tempfile.mkdtemp(prefix="session-trainer-tests-"))
os.environ["APP_DB_PATH"] = str(TMP_DIR / "test.db")
os.environ["SITE_PASSWORD"] = "test123"
os.environ["SITE_PASSWORD_HASH"] = ""
os.environ["SESSION_SECRET"] = "testsecret"
os.environ["DEEPSEEK_API_KEY"] = ""

import httpx
import pytest
import pytest_asyncio

from app import ai, auth, db, repo
from app.config import get_settings
from app.main import app

PASSWORD = "test123"


@pytest.fixture(autouse=True)
def clean_db():
    get_settings.cache_clear()
    db.init_db()
    with db.cursor() as conn:
        for table in ("attempts", "ai_usage", "cache", "settings", "subjects"):
            conn.execute(f"DELETE FROM {table}")
    db.init_db()
    auth.reset_failures()
    yield
    auth.reset_failures()
    get_settings.cache_clear()


@pytest_asyncio.fixture
async def client():
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as session:
        yield session


@pytest_asyncio.fixture
async def auth_client(client):
    response = await client.post("/api/auth/login", json={"password": PASSWORD})
    assert response.status_code == 204
    return client


@pytest.fixture
def deepseek_key(monkeypatch):
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-test")
    get_settings.cache_clear()
    return "sk-test"


class FakeDeepSeek:
    def __init__(
        self,
        monkeypatch,
        content: str | None = None,
        status_code: int = 200,
        prompt_tokens: int = 1200,
        completion_tokens: int = 400,
        error: Exception | None = None,
    ):
        self.content = content
        self.status_code = status_code
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.error = error
        self.calls: list[dict] = []

        outer = self

        class FakeClient:
            def __init__(self, *args, **kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def post(self, url, json=None, headers=None, **kwargs):
                outer.calls.append({"url": url, "json": json, "headers": headers})
                if outer.error is not None:
                    raise outer.error
                body = {}
                if outer.content is not None:
                    body = {
                        "choices": [{"message": {"content": outer.content}}],
                        "usage": {
                            "prompt_tokens": outer.prompt_tokens,
                            "completion_tokens": outer.completion_tokens,
                        },
                    }
                return httpx.Response(outer.status_code, json=body)

        monkeypatch.setattr(ai.httpx, "Client", FakeClient)


@pytest.fixture
def fake_ai(monkeypatch):
    def factory(**kwargs):
        return FakeDeepSeek(monkeypatch, **kwargs)

    return factory


GOOD_ANSWER = (
    '{"parts":[{"title":"Определение","question":"Что такое фотосинтез?",'
    '"options":["Процесс синтеза органики на свету","Дыхание","Брожение"],'
    '"correct_index":0,"note":"Фотосинтез идёт в хлоропластах."},'
    '{"title":"Применение","question":"Где используют?",'
    '"options":["В агрономии","Нигде","В металлургии","В химии"],'
    '"correct_index":0,"note":"Учитывают при выращивании культур."}]}'
)


@pytest.fixture
def good_answer() -> str:
    return GOOD_ANSWER


@pytest.fixture
def subject():
    return repo.create_subject("Биология")
