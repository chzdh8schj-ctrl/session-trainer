async def test_create_ticket_with_ai(auth_client, subject, deepseek_key, fake_ai, good_answer):
    fake = fake_ai(content=good_answer)
    response = await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Билет 1", "question": "Фотосинтез"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["ai_status"] == "ok"
    assert "ai_error" not in data
    assert data["position"] == 1
    assert [part["title"] for part in data["parts"]] == ["Определение", "Применение"]
    assert [part["position"] for part in data["parts"]] == [1, 2]
    first = data["parts"][0]
    assert sorted(first["options"]) == sorted(
        ["Процесс синтеза органики на свету", "Дыхание", "Брожение"]
    )
    assert first["options"][first["correct_index"]] == "Процесс синтеза органики на свету"
    assert len(fake.calls) == 1
    payload = fake.calls[0]["json"]
    assert payload["model"] == "deepseek-chat"
    assert payload["response_format"] == {"type": "json_object"}
    assert payload["temperature"] == 0.2
    assert payload["max_tokens"] == 2500
    assert fake.calls[0]["url"] == "https://api.deepseek.com/chat/completions"
    assert fake.calls[0]["headers"]["Authorization"] == "Bearer sk-test"


async def test_create_ticket_without_key_is_manual(auth_client, subject):
    response = await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Билет", "question": "Вопрос целиком"
    })
    data = response.json()
    assert data["ai_status"] == "manual"
    assert len(data["parts"]) == 1
    part = data["parts"][0]
    assert part["options"] == []
    assert part["correct_index"] == -1
    assert part["question"] == "Вопрос целиком"


async def test_create_ticket_with_ai_disabled(
    auth_client, subject, deepseek_key, fake_ai, good_answer
):
    fake = fake_ai(content=good_answer)
    await auth_client.put("/api/settings", json={"ai_enabled": False})
    data = (await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Билет", "question": "Вопрос"
    })).json()
    assert data["ai_status"] == "manual"
    assert fake.calls == []


async def test_create_ticket_for_unknown_subject(auth_client):
    response = await auth_client.post("/api/tickets", json={
        "subject_id": "none", "title": "Билет", "question": "Вопрос"
    })
    assert response.status_code == 404


async def test_ticket_ai_error_keeps_draft(auth_client, subject, deepseek_key, fake_ai):
    fake_ai(content="это не json", prompt_tokens=10, completion_tokens=5)
    data = (await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Билет", "question": "Вопрос"
    })).json()
    assert data["ai_status"] == "error"
    assert data["ai_error"]
    assert len(data["parts"]) == 1
    assert data["parts"][0]["options"] == []


async def test_ticket_list_and_positions(auth_client, subject):
    for index in range(3):
        await auth_client.post("/api/tickets", json={
            "subject_id": subject["id"], "title": f"Билет {index}", "question": "В"
        })
    tickets = (await auth_client.get(f"/api/subjects/{subject['id']}/tickets")).json()
    assert [ticket["title"] for ticket in tickets] == ["Билет 0", "Билет 1", "Билет 2"]
    assert [ticket["position"] for ticket in tickets] == [1, 2, 3]
    assert all(ticket["subject_id"] == subject["id"] for ticket in tickets)


async def test_ticket_patch_and_delete(auth_client, subject):
    ticket = (await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Старое", "question": "Старый вопрос"
    })).json()
    patched = await auth_client.patch(f"/api/tickets/{ticket['id']}", json={"title": "Новое"})
    assert patched.status_code == 200
    assert patched.json()["title"] == "Новое"
    assert patched.json()["question"] == "Старый вопрос"
    assert (await auth_client.delete(f"/api/tickets/{ticket['id']}")).status_code == 204
    assert (await auth_client.get(f"/api/tickets/{ticket['id']}")).status_code == 404


async def test_generate_conflict_without_force(
    auth_client, subject, deepseek_key, fake_ai, good_answer
):
    fake = fake_ai(content=good_answer)
    ticket = (await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Билет", "question": "Вопрос"
    })).json()
    assert ticket["ai_status"] == "ok"
    conflict = await auth_client.post(f"/api/tickets/{ticket['id']}/generate", json={})
    assert conflict.status_code == 409
    assert len(fake.calls) == 1


async def test_generate_force_replaces_parts(
    auth_client, subject, deepseek_key, fake_ai
):
    ticket = (await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Билет", "question": "Вопрос"
    })).json()
    draft = ticket["parts"][0]
    await auth_client.patch(f"/api/parts/{draft['id']}", json={
        "title": "Ручная", "options": ["a", "b"], "correct_index": 0, "note": "n"
    })
    new_answer = (
        '{"parts":[{"title":"Одна часть","question":"Вопрос?","options":["да","нет"],'
        '"correct_index":1,"note":"конспект"}]}'
    )
    fake_ai(content=new_answer)
    result = await auth_client.post(
        f"/api/tickets/{ticket['id']}/generate", json={"force": True}
    )
    assert result.status_code == 200
    data = result.json()
    assert data["ai_status"] == "ok"
    assert len(data["parts"]) == 1
    assert data["parts"][0]["title"] == "Одна часть"
    assert data["parts"][0]["position"] == 1


async def test_generate_error_keeps_old_parts(auth_client, subject, deepseek_key, fake_ai):
    ticket = (await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Билет", "question": "Вопрос"
    })).json()
    draft = ticket["parts"][0]
    await auth_client.patch(f"/api/parts/{draft['id']}", json={
        "title": "Ручная", "options": ["a", "b"], "correct_index": 1, "note": "n"
    })
    fake_ai(content="мусор", status_code=500)
    result = await auth_client.post(
        f"/api/tickets/{ticket['id']}/generate", json={"force": True}
    )
    assert result.status_code == 200
    data = result.json()
    assert data["ai_status"] == "error"
    assert data["ai_error"]
    assert len(data["parts"]) == 1
    assert data["parts"][0]["title"] == "Ручная"
    assert data["parts"][0]["options"] == ["a", "b"]


async def test_generate_on_empty_ticket_creates_draft(auth_client, subject):
    ticket = (await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Билет", "question": "Вопрос"
    })).json()
    for part in ticket["parts"]:
        await auth_client.delete(f"/api/parts/{part['id']}")
    result = await auth_client.post(f"/api/tickets/{ticket['id']}/generate", json={})
    data = result.json()
    assert result.status_code == 200
    assert data["ai_status"] == "manual"
    assert len(data["parts"]) == 1


async def test_part_crud_and_order(auth_client, subject):
    ticket = (await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Билет", "question": "Вопрос"
    })).json()
    created = []
    for index in range(3):
        part = (await auth_client.post(f"/api/tickets/{ticket['id']}/parts", json={
            "title": f"Часть {index}", "question": "В?", "options": ["a", "b", "c"],
            "correct_index": 2, "note": "конспект"
        })).json()
        created.append(part)
    parts = (await auth_client.get(f"/api/tickets/{ticket['id']}")).json()["parts"]
    assert [part["position"] for part in parts] == [1, 2, 3, 4]
    assert parts[0]["options"] == []

    patched = await auth_client.patch(f"/api/parts/{created[0]['id']}", json={
        "title": "Новая", "options": ["x", "y"], "correct_index": 1, "note": "п"
    })
    assert patched.status_code == 200
    assert patched.json()["title"] == "Новая"
    assert patched.json()["options"] == ["x", "y"]
    assert patched.json()["correct_index"] == 1
    assert patched.json()["question"] == "В?"

    assert (await auth_client.delete(f"/api/parts/{created[0]['id']}")).status_code == 204
    assert (await auth_client.patch("/api/parts/none", json={"note": "x"})).status_code == 404
    assert (await auth_client.delete("/api/parts/none")).status_code == 404
