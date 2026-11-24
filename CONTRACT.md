# Контракт: тренажёр к сессии

Решения заказчика (23.11.2026):
- запуск локально, потом перенос на сервер;
- ИИ генерирует варианты ответов и конспекты **автоматически при добавлении вопроса**;
- длинный вопрос ИИ сам делит на части (термин / история / применение), Машка потом правит;
- вход по одному паролю.

## Стек

- backend: Python 3.14, uv, FastAPI, uvicorn, httpx, pydantic-settings, sqlite3 (stdlib, без ORM), pytest.
- frontend: React 19 + Vite + TypeScript, react-router-dom, без UI-библиотек, мобильный CSS.
- БД: SQLite, файл `backend/data/app.db`.

## Структура

```
backend/
  pyproject.toml
  .env.example          # DEEPSEEK_API_KEY=, SITE_PASSWORD=, SESSION_SECRET=
  app/
    main.py             # сборка приложения, монтирование frontend/dist
    config.py           # Settings (pydantic-settings)
    db.py               # connect(), init_schema(), миграции по user_version
    auth.py             # проверка пароля, подписанная кука
    schemas.py          # pydantic-модели запросов/ответов
    repo.py             # CRUD над sqlite3
    ai.py               # DeepSeek: разбивка на части + варианты + конспекты, учёт расхода
    routes_auth.py
    routes_subjects.py
    routes_tickets.py
    routes_study.py
    routes_admin.py
  tests/
frontend/
  package.json
  vite.config.ts        # proxy /api -> http://127.0.0.1:8010
  index.html
  src/
    main.tsx
    App.tsx             # роутер + guard по /api/auth/me
    api.ts              # fetch-обёртка, 401 -> /login
    types.ts
    pages/Login.tsx
    pages/Subjects.tsx
    pages/Subject.tsx
    pages/TicketEditor.tsx
    pages/Study.tsx
    pages/Admin.tsx
    styles.css
```

## Модель данных

```sql
subjects(id TEXT PK, name TEXT NOT NULL, created_at TEXT NOT NULL)
tickets(id TEXT PK, subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        title TEXT NOT NULL, question TEXT NOT NULL, position INTEGER NOT NULL,
        created_at TEXT NOT NULL)
parts(id TEXT PK, ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      title TEXT NOT NULL, question TEXT NOT NULL, options TEXT NOT NULL,  -- JSON-массив строк
      correct_index INTEGER NOT NULL, note TEXT NOT NULL, position INTEGER NOT NULL)
attempts(id INTEGER PK AUTOINCREMENT, part_id TEXT NOT NULL, chosen_index INTEGER NOT NULL,
         correct INTEGER NOT NULL, created_at TEXT NOT NULL)
ai_usage(id INTEGER PK AUTOINCREMENT, at TEXT NOT NULL, model TEXT NOT NULL,
         prompt_tokens INTEGER NOT NULL, completion_tokens INTEGER NOT NULL,
         cost_rub REAL NOT NULL, kind TEXT NOT NULL)
settings(key TEXT PK, value TEXT NOT NULL)   -- monthly_limit_rub, ai_enabled
```

`PRAGMA foreign_keys=ON`, WAL. Схема поднимается на старте, версия — `PRAGMA user_version`.

## API

Все ответы JSON. Авторизация — кука `st_session` (HttpOnly, SameSite=Lax), кроме `/api/auth/login` и `/api/health`.
При отсутствии/невалидности куки — `401 {"detail":"unauthorized"}`.

### auth
- `POST /api/auth/login` `{password}` → `204`, ставит куку. Неверный пароль → `401`.
- `POST /api/auth/logout` → `204`, стирает куку.
- `GET /api/auth/me` → `{"ok": true}`.
- `GET /api/health` → `{"ok": true}` (без авторизации).

### subjects
- `GET /api/subjects` → `[{id, name, created_at, tickets_count, parts_count}]`
- `POST /api/subjects` `{name}` → объект предмета (201)
- `PATCH /api/subjects/{id}` `{name}` → объект
- `DELETE /api/subjects/{id}` → `204`

### tickets
- `GET /api/subjects/{id}/tickets` → `[Ticket]` где `Ticket = {id, subject_id, title, question, position, created_at, parts: [Part]}`
- `POST /api/tickets` `{subject_id, title, question}` → `Ticket & {ai_status, ai_error?}`
  - `ai_status`: `"ok"` — ИИ ответил и части созданы; `"manual"` — ИИ выключен/нет ключа, создана одна пустая часть для ручного заполнения; `"budget"` — месячный лимит исчерпан; `"error"` — ошибка запроса к DeepSeek (текст в `ai_error`).
  - Никогда не 5xx из-за ИИ: без вариантов сохраняем черновик (`options: []`, `correct_index: -1`), Машка допишет.
- `GET /api/tickets/{id}` → `Ticket`
- `PATCH /api/tickets/{id}` `{title?, question?}` → `Ticket`
- `DELETE /api/tickets/{id}` → `204`
- `POST /api/tickets/{id}/generate` `{force?: bool=false}` → `Ticket & {ai_status, ai_error?}`
  - если у билета уже есть части с вариантами и `force != true` → `409`
  - перезапись: старые части билета удаляются (кроме случая ошибки ИИ — тогда всё остаётся как было)

### parts
- `POST /api/tickets/{id}/parts` `{title, question, options: [str], correct_index, note}` → `Part` (ручное добавление части)
- `PATCH /api/parts/{id}` `{title?, question?, options?, correct_index?, note?}` → `Part`
- `DELETE /api/parts/{id}` → `204`

`Part = {id, ticket_id, title, question, options: [string], correct_index, note, position}`

### study
- `POST /api/parts/{id}/answer` `{chosen_index}` → `{correct: bool, correct_index, note}`, пишет в `attempts`.

### admin
- `GET /api/usage` → `{month, requests, prompt_tokens, completion_tokens, cost_rub, limit_rub, left_rub, ai_enabled}`
- `GET /api/settings` → `{monthly_limit_rub, ai_enabled}`
- `PUT /api/settings` `{monthly_limit_rub?, ai_enabled?}` → `{monthly_limit_rub, ai_enabled}`
- `GET /api/export` → `{version: 1, exported_at, subjects: [{name, tickets: [{title, question, parts: [{title, question, options, correct_index, note}]}]}]}`
- `POST /api/import` `{replace: bool, subjects: [...]}` → `{subjects_created, tickets_created, parts_created}`

## ИИ (DeepSeek)

- endpoint `https://api.deepseek.com/chat/completions`, модель `deepseek-chat`,
  `response_format: {"type":"json_object"}`, `temperature 0.2`, `max_tokens 2500`, таймаут 60 с.
- Промпт (на русском, кратко): на входе название билета и полный текст вопроса; на выходе JSON
  `{"parts":[{"title":"...","question":"...","options":["...","..."],"correct_index":0,"note":"..."}]}`.
  Правила: короткий вопрос → одна часть; длинный/составной → 2–5 частей по смыслу;
  в каждой части 3–4 коротких варианта, ровно один правильный, `correct_index` 0-based;
  `note` — мини-конспект на 2–4 предложения по теме этой части; без воды, без нумерации в title.
- Разбор ответа: терпимый к обёрткам (markdown-заборы, `parts` в корне или вложенно). Невалидный JSON
  или пустой `parts` → `ai_status="error"`, черновик-часть.
- Кэш: ключ `sha256(model + title + question)`, таблица `cache`; попадание — без вызова API и без оплаты.
- Учёт: `prompt_tokens`/`completion_tokens` из `usage`, цены из настроек
  (`PRICE_IN_USD=0.27`, `PRICE_OUT_USD=1.10` за 1M токенов, `USD_RUB=81`), пишем в `ai_usage`.
- Лимит: сумма `cost_rub` за текущий месяц ≥ `monthly_limit_rub` (по умолчанию 500) → ИИ не вызываем,
  `ai_status="budget"`. Значение `ai_enabled=false` — то же самое, что выключенный ИИ.

## Frontend

Экраны и поведение:
1. **/login** — поле пароля, кнопка «Войти», ошибка по-русски.
2. **/** — «Мои предметы»: карточки (название, `билетов: N`), кнопки «Открыть», «По порядку», «Случайно», «Удалить»; кнопка «+ Добавить предмет» (спрашивает название). Пусто → «Пока пусто. Добавь первый предмет.»
3. **/subject/:id** — список билетов: название, `частей: N`, кнопки «Решать», «Изменить», «Удалить»; «+ Добавить билет» → форма (название, полный текст вопроса) → после сохранения индикатор «ИИ готовит варианты ответов…», затем переход в редактор/список. Если `ai_status != "ok"` — понятное сообщение (лимит / ошибка / нет ключа) и предложение заполнить вручную.
4. **/study/:id?mode=order|random** — решение. Шапка `Билет i из n`, название билета, текущая часть: `Часть j из k`, заголовок, текст вопроса, варианты кнопками.
   - клик → все варианты блокируются, правильный зелёный, выбранный неверный красный, снизу плашка-конспект (только при ошибке), кнопка «Продолжить».
   - после последней части — «Дальше» → следующий билет; билеты кончились → «Билеты закончились!» и кнопка назад к предмету.
   - `mode=random` — порядок билетов перемешивается на клиенте.
   - ответ отправляется на `/api/parts/{id}/answer`.
5. **/subject/:id/ticket/:ticketId** — редактор билета: название, текст вопроса; список частей, у каждой поля (название, вопрос, до 4 вариантов, номер правильного, конспект), «Сохранить часть», «Удалить часть», «+ Добавить часть», «Сгенерировать заново» (`force`).
6. **/admin** — расход ИИ за месяц (запросы, токены, ₽), лимит в ₽ (правится), тумблер ИИ, экспорт/импорт JSON.

Оформление: мобильный в первую очередь, ширина до 900px по центру, светлая тема, крупные кнопки (min-height 44px), системный шрифт, акценты: синий `#315da8`, зелёный `#1e7a3c`, красный `#a83232`. Плашка конспекта — светло-жёлтая. Никаких alert/confirm, кроме удаления (можно confirm). Тексты все по-русски.

## Проверки

- backend: `uv run pytest` — покрыть auth (401 без куки), CRUD предметов/билетов/частей, импорт/экспорт, лимит бюджета (ИИ не вызывается), разбор ответа ИИ на фикстурах (валидный/мусорный/в заборе), ответ на часть.
- frontend: `npx tsc --noEmit` и `npm run build` без ошибок.
- ИИ в тестах не вызывается (httpx замокан).
