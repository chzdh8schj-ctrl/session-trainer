# Backend: тренажёр к сессии

FastAPI + sqlite3, без ORM. Контракт API — в `../CONTRACT.md`.

## Пароль и вход

Пароль хранится хешем scrypt, а не открытым текстом. Сгенерировать:

```powershell
cd backend
uv run python -m app.passwords "твой пароль"
```

Полученную строку `scrypt$16384$8$1$...` вставить в `.env` как `SITE_PASSWORD_HASH`.
Переменная `SITE_PASSWORD` (открытый текст) — только временный запасной вариант: работает,
если `SITE_PASSWORD_HASH` пуст, хешируется в памяти при старте и в лог не пишется;
при старте будет предупреждение в логе. Если не задано ни то, ни другое — вход невозможен.

Неудачные попытки входа ограничены: 10 за 10 минут с одного IP (при `X-Forwarded-For`
берётся первый адрес), дальше `429` «слишком много попыток, подожди». Успешный вход сбрасывает счётчик.

## Запуск

```powershell
cd backend
uv sync
Copy-Item .env.example .env    # и заполнить SITE_PASSWORD_HASH, SESSION_SECRET, DEEPSEEK_API_KEY
uv run uvicorn app.main:app --host 127.0.0.1 --port 8010
```

Сайт: http://127.0.0.1:8010 — если собран `frontend/dist`, отдаётся он; иначе только API.
База создаётся сама в `data/app.db` при старте.

## Проверки

```powershell
uv run pytest -q
uv run python -c "import app.main"
```

## Переменные окружения

Все перечислены в `.env.example`. Обязательные: `SITE_PASSWORD_HASH` (или временно `SITE_PASSWORD`),
`SESSION_SECRET` (без `DEEPSEEK_API_KEY` ИИ выключен, части билета заполняются вручную).

## Где что

- `app/config.py` — настройки из `.env`
- `app/db.py` — подключение, схема, миграции по `PRAGMA user_version`
- `app/passwords.py` — scrypt-хеш пароля и CLI `python -m app.passwords`
- `app/auth.py` — проверка пароля, лимит попыток входа, HMAC-кука `st_session`
- `app/repo.py` — CRUD над sqlite3
- `app/ai.py` — DeepSeek, кэш ответов, учёт токенов и рублей
- `app/routes_*.py` — ручки, `app/main.py` — сборка приложения и статика
- `tests/` — pytest, httpx ASGITransport, DeepSeek замокан
