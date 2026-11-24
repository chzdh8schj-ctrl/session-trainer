from datetime import datetime


async def _seed(auth_client, subject):
    ticket = (await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Билет 1", "question": "Полный вопрос"
    })).json()
    await auth_client.patch(f"/api/parts/{ticket['parts'][0]['id']}", json={
        "title": "Часть", "question": "Вопрос части?", "options": ["a", "b"],
        "correct_index": 1, "note": "Конспект"
    })
    return ticket


async def test_export_shape(auth_client, subject):
    await _seed(auth_client, subject)
    response = await auth_client.get("/api/export")
    assert response.status_code == 200
    data = response.json()
    assert data["version"] == 1
    assert datetime.fromisoformat(data["exported_at"])
    subject_data = data["subjects"][0]
    assert subject_data["name"] == "Биология"
    ticket = subject_data["tickets"][0]
    assert ticket["title"] == "Билет 1"
    assert ticket["question"] == "Полный вопрос"
    assert ticket["parts"][0] == {
        "title": "Часть",
        "question": "Вопрос части?",
        "options": ["a", "b"],
        "correct_index": 1,
        "note": "Конспект",
    }


async def test_import_appends(auth_client):
    payload = {
        "replace": False,
        "subjects": [
            {
                "name": "География",
                "tickets": [
                    {
                        "title": "Билет",
                        "question": "Вопрос",
                        "parts": [
                            {"title": "Ч", "question": "В?", "options": ["a", "b"],
                             "correct_index": 0, "note": "n"}
                        ],
                    }
                ],
            }
        ],
    }
    response = await auth_client.post("/api/import", json=payload)
    assert response.status_code == 200
    assert response.json() == {"subjects_created": 1, "tickets_created": 1, "parts_created": 1}
    assert len((await auth_client.get("/api/subjects")).json()) == 1

    again = await auth_client.post("/api/import", json=payload)
    assert again.json()["subjects_created"] == 1
    assert len((await auth_client.get("/api/subjects")).json()) == 2


async def test_import_replace(auth_client, subject):
    await _seed(auth_client, subject)
    payload = {
        "replace": True,
        "subjects": [{"name": "Новое", "tickets": []}],
    }
    response = await auth_client.post("/api/import", json=payload)
    assert response.json() == {"subjects_created": 1, "tickets_created": 0, "parts_created": 0}
    listing = (await auth_client.get("/api/subjects")).json()
    assert [item["name"] for item in listing] == ["Новое"]


async def test_export_import_roundtrip(auth_client, subject):
    await _seed(auth_client, subject)
    exported = (await auth_client.get("/api/export")).json()
    dumped = {"replace": True, "subjects": exported["subjects"]}
    imported = (await auth_client.post("/api/import", json=dumped)).json()
    assert imported == {"subjects_created": 1, "tickets_created": 1, "parts_created": 1}
    restored = (await auth_client.get("/api/export")).json()
    assert restored["subjects"] == exported["subjects"]
