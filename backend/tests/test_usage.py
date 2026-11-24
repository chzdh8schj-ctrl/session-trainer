from datetime import datetime

from app import db, repo


async def test_usage_defaults(auth_client):
    response = await auth_client.get("/api/usage")
    assert response.status_code == 200
    data = response.json()
    assert data["month"] == datetime.now().strftime("%Y-%m")
    assert data["requests"] == 0
    assert data["prompt_tokens"] == 0
    assert data["completion_tokens"] == 0
    assert data["cost_rub"] == 0
    assert data["limit_rub"] == 500
    assert data["left_rub"] == 500
    assert data["ai_enabled"] is True


async def test_usage_after_ai_call(auth_client, subject, deepseek_key, fake_ai, good_answer):
    fake_ai(content=good_answer, prompt_tokens=1200, completion_tokens=400)
    await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Билет", "question": "Вопрос"
    })
    data = (await auth_client.get("/api/usage")).json()
    assert data["requests"] == 1
    assert data["prompt_tokens"] == 1200
    assert data["completion_tokens"] == 400
    assert data["cost_rub"] == 0.061884
    assert data["left_rub"] == 499.9381


async def test_usage_ignores_other_months(auth_client):
    with db.cursor() as conn:
        conn.execute(
            """INSERT INTO ai_usage(at, model, prompt_tokens, completion_tokens, cost_rub, kind)
               VALUES('2020-01-15T10:00:00', 'deepseek-chat', 10, 10, 99.0, 'ticket')"""
        )
    data = (await auth_client.get("/api/usage")).json()
    assert data["cost_rub"] == 0
    assert data["requests"] == 0


async def test_settings_get_and_update(auth_client):
    current = (await auth_client.get("/api/settings")).json()
    assert current == {"monthly_limit_rub": 500.0, "ai_enabled": True}

    updated = await auth_client.put("/api/settings", json={"monthly_limit_rub": 150.5})
    assert updated.status_code == 200
    assert updated.json() == {"monthly_limit_rub": 150.5, "ai_enabled": True}

    toggled = await auth_client.put("/api/settings", json={"ai_enabled": False})
    assert toggled.json() == {"monthly_limit_rub": 150.5, "ai_enabled": False}

    assert (await auth_client.put("/api/settings", json={"monthly_limit_rub": -1})).status_code == 422
    assert (await auth_client.get("/api/settings")).json() == {
        "monthly_limit_rub": 150.5, "ai_enabled": False
    }


async def test_budget_stops_ai(auth_client, subject, deepseek_key, fake_ai, good_answer):
    fake = fake_ai(content=good_answer)
    await auth_client.put("/api/settings", json={"monthly_limit_rub": 0.01})
    repo.add_usage("deepseek-chat", 1000, 1000, 1.0, "ticket")

    data = (await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Билет", "question": "Вопрос"
    })).json()
    assert data["ai_status"] == "budget"
    assert fake.calls == []
    assert len(data["parts"]) == 1
    assert data["parts"][0]["options"] == []

    usage = (await auth_client.get("/api/usage")).json()
    assert usage["cost_rub"] == 1.0
    assert usage["left_rub"] == 0
    assert usage["requests"] == 1


async def test_budget_covers_settings_from_ui(
    auth_client, subject, deepseek_key, fake_ai, good_answer
):
    fake_ai(content=good_answer)
    repo.add_usage("deepseek-chat", 100, 100, 500.0, "ticket")
    data = (await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Билет", "question": "Вопрос"
    })).json()
    assert data["ai_status"] == "budget"


async def test_budget_does_not_block_when_room_left(
    auth_client, subject, deepseek_key, fake_ai, good_answer
):
    fake_ai(content=good_answer)
    repo.add_usage("deepseek-chat", 100, 100, 100.0, "ticket")
    data = (await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Билет", "question": "Вопрос"
    })).json()
    assert data["ai_status"] == "ok"
