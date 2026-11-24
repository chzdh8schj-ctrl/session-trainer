# Тренажёр к сессии — фронтенд

React 19 + Vite + TypeScript, мобильный интерфейс. Ходит в backend по `/api`
(в деве — прокси на `http://127.0.0.1:8010`).

## Запуск

```powershell
cd frontend
npm install
npm run dev
```

Открыть http://localhost:5173 — backend должен быть запущен на `127.0.0.1:8010`
(`uv run uvicorn app.main:app --port 8010` в каталоге `backend/`).

## Сборка

```powershell
npm run build      # tsc --noEmit && vite build -> frontend/dist
npm run preview    # локальный просмотр сборки на 4173
```

`frontend/dist` монтирует backend как статику.

## Страницы

- `/login` — пароль;
- `/` — предметы;
- `/subject/:id` — билеты предмета;
- `/subject/:id/ticket/:ticketId` — редактор билета;
- `/study/:id?mode=order|random` — решение;
- `/admin` — журнал ИИ, лимит, экспорт/импорт.

Контракт API и текстов — `../CONTRACT.md`.
