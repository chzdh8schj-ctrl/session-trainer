import logging

import pytest

from app import auth
from app.config import get_settings
from app.passwords import hash_password

GOOD = "hash-pass-42"
BAD = "ne-ponravilsya"


@pytest.fixture
def hash_only(monkeypatch):
    stored = hash_password(GOOD)
    monkeypatch.setenv("SITE_PASSWORD_HASH", stored)
    monkeypatch.setenv("SITE_PASSWORD", "")
    get_settings.cache_clear()
    return stored


async def test_login_with_hash(client, hash_only):
    response = await client.post("/api/auth/login", json={"password": GOOD})
    assert response.status_code == 204
    assert (await client.get("/api/auth/me")).status_code == 200


async def test_login_with_hash_rejects_wrong(client, hash_only):
    response = await client.post("/api/auth/login", json={"password": BAD})
    assert response.status_code == 401
    assert response.json() == {"detail": "unauthorized"}


async def test_hash_takes_priority_over_plain(monkeypatch, client):
    monkeypatch.setenv("SITE_PASSWORD_HASH", hash_password(GOOD))
    monkeypatch.setenv("SITE_PASSWORD", "test123")
    get_settings.cache_clear()
    assert (await client.post("/api/auth/login", json={"password": "test123"})).status_code == 401
    assert (await client.post("/api/auth/login", json={"password": GOOD})).status_code == 204


async def test_plain_fallback_works(client):
    stored = auth.password_hash()
    assert stored.startswith("scrypt$16384$8$1$")
    assert stored != "test123"
    response = await client.post("/api/auth/login", json={"password": "test123"})
    assert response.status_code == 204


async def test_no_password_configured(monkeypatch, client):
    monkeypatch.setenv("SITE_PASSWORD", "")
    monkeypatch.setenv("SITE_PASSWORD_HASH", "")
    get_settings.cache_clear()
    assert auth.password_hash() == ""
    assert (await client.post("/api/auth/login", json={"password": ""})).status_code == 401
    assert (await client.post("/api/auth/login", json={"password": "любой"})).status_code == 401


async def test_broken_hash_blocks_login(monkeypatch, client):
    monkeypatch.setenv("SITE_PASSWORD_HASH", "scrypt$битый-формат")
    monkeypatch.setenv("SITE_PASSWORD", "test123")
    get_settings.cache_clear()
    assert (await client.post("/api/auth/login", json={"password": "test123"})).status_code == 401


async def test_password_not_exposed(auth_client, caplog):
    settings = (await auth_client.get("/api/settings")).json()
    assert "test123" not in str(settings)
    usage = (await auth_client.get("/api/usage")).json()
    assert "test123" not in str(usage)
    dump = (await auth_client.get("/api/export")).json()
    assert "test123" not in str(dump)

    auth._warned = False
    with caplog.at_level(logging.WARNING):
        auth.warn_plaintext_password()
        auth.warn_plaintext_password()
    assert "SITE_PASSWORD_HASH" in caplog.text
    assert "test123" not in caplog.text
    assert caplog.text.count("SITE_PASSWORD задан открытым текстом") == 1


async def test_no_warning_when_hash_set(caplog, hash_only):
    auth._warned = False
    with caplog.at_level(logging.WARNING):
        auth.warn_plaintext_password()
    assert caplog.text == ""


def test_plain_password_hashed_at_startup():
    auth._warned = False
    auth._fallback = None
    auth.warn_plaintext_password()
    assert auth._fallback is not None
    assert auth._fallback[1].startswith("scrypt$16384$8$1$")
    assert auth._fallback[1] != "test123"


async def test_rate_limit_blocks_after_ten_failures(client):
    for _ in range(10):
        response = await client.post("/api/auth/login", json={"password": "неверный"})
        assert response.status_code == 401
    blocked = await client.post("/api/auth/login", json={"password": "test123"})
    assert blocked.status_code == 429
    assert blocked.json() == {"detail": "слишком много попыток, подожди"}
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_other_ip_not_blocked(client):
    headers = {"X-Forwarded-For": "10.0.0.7"}
    for _ in range(10):
        await client.post("/api/auth/login", json={"password": "неверный"}, headers=headers)
    assert (
        await client.post("/api/auth/login", json={"password": "test123"}, headers=headers)
    ).status_code == 429
    assert (
        await client.post(
            "/api/auth/login", json={"password": "test123"},
            headers={"X-Forwarded-For": "10.0.0.8"},
        )
    ).status_code == 204


async def test_first_address_from_forwarded_for(client):
    for _ in range(5):
        await client.post(
            "/api/auth/login", json={"password": "неверный"},
            headers={"X-Forwarded-For": "10.1.1.1, 10.2.2.2"},
        )
    for _ in range(5):
        await client.post(
            "/api/auth/login", json={"password": "неверный"},
            headers={"X-Forwarded-For": "10.1.1.1"},
        )
    blocked = await client.post(
        "/api/auth/login", json={"password": "test123"},
        headers={"X-Forwarded-For": "10.1.1.1"},
    )
    assert blocked.status_code == 429


async def test_success_resets_counter(client):
    for _ in range(9):
        assert (await client.post(
            "/api/auth/login", json={"password": "неверный"}
        )).status_code == 401
    assert (await client.post("/api/auth/login", json={"password": "test123"})).status_code == 204
    for _ in range(9):
        assert (await client.post(
            "/api/auth/login", json={"password": "неверный"}
        )).status_code == 401
    assert (await client.post("/api/auth/login", json={"password": "test123"})).status_code == 204


def test_window_expires(monkeypatch):
    auth.reset_failures()
    clock = [1000.0]
    monkeypatch.setattr(auth.time, "monotonic", lambda: clock[0])
    for _ in range(10):
        auth.register_failure("1.2.3.4")
    assert auth.login_blocked("1.2.3.4") is True
    clock[0] += auth.LOGIN_WINDOW_SECONDS + 1
    assert auth.login_blocked("1.2.3.4") is False
    assert auth._failures == {}
