from app.auth import make_token


async def test_health_without_cookie(client):
    response = await client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}


async def test_subjects_requires_cookie(client):
    response = await client.get("/api/subjects")
    assert response.status_code == 401
    assert response.json() == {"detail": "unauthorized"}


async def test_protected_endpoints_reject_without_cookie(client):
    checks = [
        ("get", "/api/auth/me"),
        ("post", "/api/auth/logout"),
        ("get", "/api/subjects"),
        ("post", "/api/subjects"),
        ("get", "/api/tickets/none"),
        ("get", "/api/usage"),
        ("get", "/api/settings"),
        ("get", "/api/export"),
        ("post", "/api/import"),
    ]
    for method, url in checks:
        response = await client.request(method.upper(), url, json={})
        assert response.status_code == 401, url


async def test_login_wrong_password(client):
    response = await client.post("/api/auth/login", json={"password": "nope"})
    assert response.status_code == 401
    assert response.json() == {"detail": "unauthorized"}
    assert not client.cookies.get("st_session")


async def test_login_and_me(client):
    response = await client.post("/api/auth/login", json={"password": "test123"})
    assert response.status_code == 204
    assert client.cookies.get("st_session")
    me = await client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json() == {"ok": True}


async def test_cookie_flags(client):
    response = await client.post("/api/auth/login", json={"password": "test123"})
    header = response.headers["set-cookie"]
    assert "st_session=" in header
    assert "HttpOnly" in header
    assert "samesite=lax" in header.lower()
    assert "Max-Age=2592000" in header


async def test_logout_clears_cookie(auth_client):
    assert (await auth_client.get("/api/auth/me")).status_code == 200
    response = await auth_client.post("/api/auth/logout")
    assert response.status_code == 204
    assert (await auth_client.get("/api/auth/me")).status_code == 401


async def test_forged_cookie_rejected(client):
    client.cookies.set("st_session", "1700000000.deadbeef")
    assert (await client.get("/api/auth/me")).status_code == 401


async def test_valid_token_accepted(client):
    client.cookies.set("st_session", make_token())
    assert (await client.get("/api/auth/me")).status_code == 200


async def test_garbage_cookies_rejected(client):
    for value in ["abc", "123", "1.2.3", "1700000000."]:
        client.cookies.clear()
        client.cookies.set("st_session", value)
        assert (await client.get("/api/auth/me")).status_code == 401
