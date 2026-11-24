from app import db


async def _ticket_with_part(auth_client, subject, correct_index=1):
    ticket = (await auth_client.post("/api/tickets", json={
        "subject_id": subject["id"], "title": "Билет", "question": "Вопрос"
    })).json()
    part = (await auth_client.post(f"/api/tickets/{ticket['id']}/parts", json={
        "title": "Часть", "question": "Вопрос части?", "options": ["да", "нет", "может"],
        "correct_index": correct_index, "note": "Короткий конспект"
    })).json()
    return ticket, part


async def test_answer_correct(auth_client, subject):
    _, part = await _ticket_with_part(auth_client, subject)
    response = await auth_client.post(f"/api/parts/{part['id']}/answer", json={"chosen_index": 1})
    assert response.status_code == 200
    assert response.json() == {"correct": True, "correct_index": 1, "note": "Короткий конспект"}
    with db.cursor() as conn:
        rows = conn.execute(
            "SELECT part_id, chosen_index, correct, created_at FROM attempts"
        ).fetchall()
    assert len(rows) == 1
    assert rows[0]["part_id"] == part["id"]
    assert rows[0]["chosen_index"] == 1
    assert rows[0]["correct"] == 1
    assert rows[0]["created_at"]


async def test_answer_wrong(auth_client, subject):
    _, part = await _ticket_with_part(auth_client, subject)
    response = await auth_client.post(f"/api/parts/{part['id']}/answer", json={"chosen_index": 2})
    assert response.status_code == 200
    assert response.json()["correct"] is False
    assert response.json()["correct_index"] == 1
    assert response.json()["note"] == "Короткий конспект"
    with db.cursor() as conn:
        correct = conn.execute("SELECT correct FROM attempts").fetchone()[0]
    assert correct == 0


async def test_answer_writes_every_attempt(auth_client, subject):
    _, part = await _ticket_with_part(auth_client, subject)
    for index in (0, 1, 2, 1):
        await auth_client.post(f"/api/parts/{part['id']}/answer", json={"chosen_index": index})
    with db.cursor() as conn:
        count = conn.execute("SELECT COUNT(*) FROM attempts").fetchone()[0]
    assert count == 4


async def test_answer_unknown_part(auth_client):
    response = await auth_client.post("/api/parts/none/answer", json={"chosen_index": 0})
    assert response.status_code == 404


async def test_answer_requires_auth(client):
    response = await client.post("/api/parts/none/answer", json={"chosen_index": 0})
    assert response.status_code == 401
