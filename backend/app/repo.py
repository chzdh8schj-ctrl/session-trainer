"""CRUD над sqlite3 без ORM."""

import json
import uuid
from datetime import datetime

from .db import cursor


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def new_id() -> str:
    return uuid.uuid4().hex


def _row_part(row) -> dict:
    return {
        "id": row["id"],
        "ticket_id": row["ticket_id"],
        "title": row["title"],
        "question": row["question"],
        "options": json.loads(row["options"]),
        "correct_index": row["correct_index"],
        "note": row["note"],
        "position": row["position"],
    }


def _row_ticket(row, parts: list[dict]) -> dict:
    return {
        "id": row["id"],
        "subject_id": row["subject_id"],
        "title": row["title"],
        "question": row["question"],
        "position": row["position"],
        "created_at": row["created_at"],
        "parts": parts,
    }


# ---------- subjects ----------


def list_subjects() -> list[dict]:
    with cursor() as conn:
        rows = conn.execute(
            """
            SELECT s.id, s.name, s.created_at,
                   (SELECT COUNT(*) FROM tickets t WHERE t.subject_id = s.id) AS tickets_count,
                   (SELECT COUNT(*) FROM parts p
                      JOIN tickets t ON t.id = p.ticket_id
                     WHERE t.subject_id = s.id) AS parts_count
              FROM subjects s
             ORDER BY s.created_at, s.name
            """
        ).fetchall()
    return [dict(row) for row in rows]


def get_subject(subject_id: str) -> dict | None:
    with cursor() as conn:
        row = conn.execute(
            "SELECT id, name, created_at FROM subjects WHERE id = ?", (subject_id,)
        ).fetchone()
    return dict(row) if row else None


def create_subject(name: str) -> dict:
    subject = {"id": new_id(), "name": name, "created_at": now()}
    with cursor() as conn:
        conn.execute(
            "INSERT INTO subjects(id, name, created_at) VALUES(?, ?, ?)",
            (subject["id"], subject["name"], subject["created_at"]),
        )
    return subject


def rename_subject(subject_id: str, name: str) -> dict | None:
    with cursor() as conn:
        conn.execute("UPDATE subjects SET name = ? WHERE id = ?", (name, subject_id))
    return get_subject(subject_id)


def delete_subject(subject_id: str) -> bool:
    with cursor() as conn:
        cur = conn.execute("DELETE FROM subjects WHERE id = ?", (subject_id,))
        return cur.rowcount > 0


# ---------- tickets ----------


def list_parts(ticket_id: str) -> list[dict]:
    with cursor() as conn:
        rows = conn.execute(
            "SELECT * FROM parts WHERE ticket_id = ? ORDER BY position, rowid", (ticket_id,)
        ).fetchall()
    return [_row_part(row) for row in rows]


def list_tickets(subject_id: str) -> list[dict]:
    with cursor() as conn:
        tickets = conn.execute(
            "SELECT * FROM tickets WHERE subject_id = ? ORDER BY position, rowid", (subject_id,)
        ).fetchall()
        parts = conn.execute(
            """
            SELECT p.* FROM parts p
              JOIN tickets t ON t.id = p.ticket_id
             WHERE t.subject_id = ?
             ORDER BY p.position, p.rowid
            """,
            (subject_id,),
        ).fetchall()
    grouped: dict[str, list[dict]] = {}
    for part in parts:
        grouped.setdefault(part["ticket_id"], []).append(_row_part(part))
    return [_row_ticket(row, grouped.get(row["id"], [])) for row in tickets]


def get_ticket(ticket_id: str) -> dict | None:
    with cursor() as conn:
        row = conn.execute("SELECT * FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
    if not row:
        return None
    return _row_ticket(row, list_parts(ticket_id))


def create_ticket(subject_id: str, title: str, question: str) -> dict:
    ticket_id = new_id()
    created = now()
    with cursor() as conn:
        position = conn.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM tickets WHERE subject_id = ?",
            (subject_id,),
        ).fetchone()[0]
        conn.execute(
            """INSERT INTO tickets(id, subject_id, title, question, position, created_at)
               VALUES(?, ?, ?, ?, ?, ?)""",
            (ticket_id, subject_id, title, question, position, created),
        )
    return get_ticket(ticket_id)


def update_ticket(ticket_id: str, title: str | None, question: str | None) -> dict | None:
    fields, values = [], []
    if title is not None:
        fields.append("title = ?")
        values.append(title)
    if question is not None:
        fields.append("question = ?")
        values.append(question)
    if fields:
        with cursor() as conn:
            conn.execute(
                f"UPDATE tickets SET {', '.join(fields)} WHERE id = ?", (*values, ticket_id)
            )
    return get_ticket(ticket_id)


def delete_ticket(ticket_id: str) -> bool:
    with cursor() as conn:
        cur = conn.execute("DELETE FROM tickets WHERE id = ?", (ticket_id,))
        return cur.rowcount > 0


# ---------- parts ----------


def get_part(part_id: str) -> dict | None:
    with cursor() as conn:
        row = conn.execute("SELECT * FROM parts WHERE id = ?", (part_id,)).fetchone()
    return _row_part(row) if row else None


def create_part(
    ticket_id: str,
    title: str,
    question: str,
    options: list[str],
    correct_index: int,
    note: str,
) -> dict | None:
    part_id = new_id()
    with cursor() as conn:
        exists = conn.execute("SELECT 1 FROM tickets WHERE id = ?", (ticket_id,)).fetchone()
        if not exists:
            return None
        position = conn.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 FROM parts WHERE ticket_id = ?", (ticket_id,)
        ).fetchone()[0]
        conn.execute(
            """INSERT INTO parts(id, ticket_id, title, question, options, correct_index, note, position)
               VALUES(?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                part_id,
                ticket_id,
                title,
                question,
                json.dumps(options, ensure_ascii=False),
                correct_index,
                note,
                position,
            ),
        )
    return get_part(part_id)


def update_part(part_id: str, data: dict) -> dict | None:
    fields, values = [], []
    for key in ("title", "question", "correct_index", "note"):
        if data.get(key) is not None:
            fields.append(f"{key} = ?")
            values.append(data[key])
    if data.get("options") is not None:
        fields.append("options = ?")
        values.append(json.dumps(data["options"], ensure_ascii=False))
    if fields:
        with cursor() as conn:
            conn.execute(f"UPDATE parts SET {', '.join(fields)} WHERE id = ?", (*values, part_id))
    return get_part(part_id)


def delete_part(part_id: str) -> bool:
    with cursor() as conn:
        cur = conn.execute("DELETE FROM parts WHERE id = ?", (part_id,))
        return cur.rowcount > 0


def replace_parts(ticket_id: str, parts: list[dict]) -> list[dict]:
    with cursor() as conn:
        conn.execute("DELETE FROM parts WHERE ticket_id = ?", (ticket_id,))
        for position, part in enumerate(parts, start=1):
            conn.execute(
                """INSERT INTO parts(id, ticket_id, title, question, options, correct_index, note, position)
                   VALUES(?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    new_id(),
                    ticket_id,
                    part["title"],
                    part["question"],
                    json.dumps(part["options"], ensure_ascii=False),
                    part["correct_index"],
                    part["note"],
                    position,
                ),
            )
    return list_parts(ticket_id)


def has_ready_parts(ticket_id: str) -> bool:
    with cursor() as conn:
        row = conn.execute(
            "SELECT 1 FROM parts WHERE ticket_id = ? AND options NOT IN ('[]', '') LIMIT 1",
            (ticket_id,),
        ).fetchone()
    return row is not None


# ---------- attempts ----------


def add_attempt(part_id: str, chosen_index: int, correct: bool) -> None:
    with cursor() as conn:
        conn.execute(
            """INSERT INTO attempts(part_id, chosen_index, correct, created_at)
               VALUES(?, ?, ?, ?)""",
            (part_id, chosen_index, 1 if correct else 0, now()),
        )


# ---------- settings, usage, cache ----------


def _flag(value: str) -> bool:
    return value.strip().lower() in {"1", "true", "yes", "on"}


def get_settings_map() -> dict:
    with cursor() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    stored = {row["key"]: row["value"] for row in rows}
    from .config import get_settings

    defaults = get_settings()
    try:
        limit = float(stored.get("monthly_limit_rub", defaults.default_limit_rub))
    except ValueError:
        limit = defaults.default_limit_rub
    return {
        "monthly_limit_rub": limit,
        "ai_enabled": _flag(stored.get("ai_enabled", "true")),
    }


def update_settings(monthly_limit_rub: float | None, ai_enabled: bool | None) -> dict:
    with cursor() as conn:
        if monthly_limit_rub is not None:
            conn.execute(
                "INSERT INTO settings(key, value) VALUES('monthly_limit_rub', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (str(monthly_limit_rub),),
            )
        if ai_enabled is not None:
            conn.execute(
                "INSERT INTO settings(key, value) VALUES('ai_enabled', ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                ("true" if ai_enabled else "false",),
            )
    return get_settings_map()


def month_key() -> str:
    return datetime.now().strftime("%Y-%m")


def month_usage(month: str | None = None) -> dict:
    month = month or month_key()
    with cursor() as conn:
        row = conn.execute(
            """SELECT COUNT(*) AS requests,
                      COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
                      COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
                      COALESCE(SUM(cost_rub), 0) AS cost_rub
                 FROM ai_usage
                WHERE substr(at, 1, 7) = ?""",
            (month,),
        ).fetchone()
    return {
        "month": month,
        "requests": row["requests"],
        "prompt_tokens": row["prompt_tokens"],
        "completion_tokens": row["completion_tokens"],
        "cost_rub": float(row["cost_rub"]),
    }


def add_usage(model: str, prompt_tokens: int, completion_tokens: int, cost_rub: float, kind: str) -> None:
    with cursor() as conn:
        conn.execute(
            """INSERT INTO ai_usage(at, model, prompt_tokens, completion_tokens, cost_rub, kind)
               VALUES(?, ?, ?, ?, ?, ?)""",
            (now(), model, prompt_tokens, completion_tokens, cost_rub, kind),
        )


def cache_get(key: str) -> str | None:
    with cursor() as conn:
        row = conn.execute("SELECT value FROM cache WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def cache_put(key: str, value: str) -> None:
    with cursor() as conn:
        conn.execute(
            "INSERT INTO cache(key, value, created_at) VALUES(?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, created_at = excluded.created_at",
            (key, value, now()),
        )


# ---------- экспорт / импорт ----------


def dump_all() -> list[dict]:
    with cursor() as conn:
        subjects = conn.execute("SELECT id, name FROM subjects ORDER BY created_at, name").fetchall()
    result = []
    for subject in subjects:
        result.append(
            {
                "name": subject["name"],
                "tickets": [
                    {
                        "title": ticket["title"],
                        "question": ticket["question"],
                        "parts": [
                            {
                                "title": part["title"],
                                "question": part["question"],
                                "options": part["options"],
                                "correct_index": part["correct_index"],
                                "note": part["note"],
                            }
                            for part in ticket["parts"]
                        ],
                    }
                    for ticket in list_tickets(subject["id"])
                ],
            }
        )
    return result


def clear_all() -> None:
    with cursor() as conn:
        conn.execute("DELETE FROM subjects")
        conn.execute("DELETE FROM attempts")


def insert_imported(subjects: list[dict]) -> dict:
    counts = {"subjects_created": 0, "tickets_created": 0, "parts_created": 0}
    for subject in subjects:
        created_subject = create_subject(subject["name"])
        counts["subjects_created"] += 1
        for ticket in subject.get("tickets", []):
            created_ticket = create_ticket(
                created_subject["id"], ticket["title"], ticket["question"]
            )
            counts["tickets_created"] += 1
            parts = [
                {
                    "title": part.get("title", ""),
                    "question": part.get("question", ""),
                    "options": list(part.get("options") or []),
                    "correct_index": int(part.get("correct_index", -1)),
                    "note": part.get("note", ""),
                }
                for part in ticket.get("parts", [])
            ]
            if parts:
                replace_parts(created_ticket["id"], parts)
                counts["parts_created"] += len(parts)
    return counts
