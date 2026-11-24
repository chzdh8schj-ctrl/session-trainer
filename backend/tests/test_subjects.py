from app import db


async def test_subject_crud(auth_client):
    created = await auth_client.post("/api/subjects", json={"name": "  Биология  "})
    assert created.status_code == 201
    subject = created.json()
    assert subject["name"] == "Биология"
    assert subject["id"]

    listing = await auth_client.get("/api/subjects")
    assert listing.status_code == 200
    assert listing.json() == [
        {
            "id": subject["id"],
            "name": "Биология",
            "created_at": subject["created_at"],
            "tickets_count": 0,
            "parts_count": 0,
        }
    ]

    renamed = await auth_client.patch(f"/api/subjects/{subject['id']}", json={"name": "Химия"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Химия"

    deleted = await auth_client.delete(f"/api/subjects/{subject['id']}")
    assert deleted.status_code == 204
    assert (await auth_client.get("/api/subjects")).json() == []


async def test_subject_not_found(auth_client):
    assert (await auth_client.patch("/api/subjects/none", json={"name": "x"})).status_code == 404
    assert (await auth_client.delete("/api/subjects/none")).status_code == 404
    assert (await auth_client.get("/api/subjects/none/tickets")).status_code == 404


async def test_subject_empty_name_rejected(auth_client):
    assert (await auth_client.post("/api/subjects", json={"name": ""})).status_code == 422
    assert (await auth_client.post("/api/subjects", json={"name": "   "})).status_code == 422


async def test_subject_counts(auth_client):
    subject = (await auth_client.post("/api/subjects", json={"name": "Физика"})).json()
    first = (await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Билет 1", "question": "Что такое сила?"
    })).json()
    await auth_client.post(f"/api/tickets/{first['id']}/parts", json={
        "title": "Определение", "question": "Сила — это?", "options": ["a", "b"],
        "correct_index": 1, "note": "n"
    })
    listing = (await auth_client.get("/api/subjects")).json()
    assert listing[0]["tickets_count"] == 1
    assert listing[0]["parts_count"] == 2


async def test_cascade_delete(auth_client):
    subject = (await auth_client.post("/api/subjects", json={"name": "История"})).json()
    ticket = (await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Билет", "question": "Вопрос"
    })).json()
    part = (await auth_client.post(f"/api/tickets/{ticket['id']}/parts", json={
        "title": "Ч", "question": "В?", "options": ["да", "нет"], "correct_index": 0, "note": ""
    })).json()
    await auth_client.post(f"/api/parts/{part['id']}/answer", json={"chosen_index": 0})

    assert (await auth_client.delete(f"/api/subjects/{subject['id']}")).status_code == 204
    with db.cursor() as conn:
        tickets = conn.execute("SELECT COUNT(*) FROM tickets").fetchone()[0]
        parts = conn.execute("SELECT COUNT(*) FROM parts").fetchone()[0]
    assert tickets == 0
    assert parts == 0
    assert (await auth_client.get(f"/api/tickets/{ticket['id']}")).status_code == 404


async def test_ticket_delete_cascades_parts(auth_client):
    subject = (await auth_client.post("/api/subjects", json={"name": "Право"})).json()
    ticket = (await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Билет", "question": "Вопрос"
    })).json()
    part = (await auth_client.post(f"/api/tickets/{ticket['id']}/parts", json={
        "title": "Ч", "question": "В?", "options": ["да"], "correct_index": 0, "note": ""
    })).json()
    assert (await auth_client.delete(f"/api/tickets/{ticket['id']}")).status_code == 204
    with db.cursor() as conn:
        assert conn.execute("SELECT COUNT(*) FROM parts").fetchone()[0] == 0
    assert (await auth_client.patch(f"/api/parts/{part['id']}", json={"note": "x"})).status_code == 404
