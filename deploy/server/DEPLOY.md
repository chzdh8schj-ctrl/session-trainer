# Перенос на Linux-сервер

Шаблоны в этом каталоге — заготовка. Ничего не применять автоматически: подставить свои значения и выполнить руками.

Плейсхолдеры:

| Где | Что заменить |
|---|---|
| `session-trainer.service` | `CHANGE_ME_USER` (2 раза), пути `/opt/session-trainer` — если код лежит в другом каталоге |
| `nginx.conf` | `CHANGE_ME_DOMAIN` |
| `.env` на сервере | `SITE_PASSWORD`, `SESSION_SECRET`, `DEEPSEEK_API_KEY`, `COOKIE_SECURE=true` |

Дальше пример для пользователя `trainer` и каталога `/opt/session-trainer`.

## 1. Что копировать

На сервер нужны:

- `backend/` — без `.venv`, `data/`, `__pycache__`, `.pytest_cache`
- `frontend/dist/` — собранный фронт (сам `frontend/src` на сервере не обязателен)
- `deploy/server/` — эти шаблоны

С Windows, из корня проекта:

```powershell
scp -r backend root@SERVER:/opt/session-trainer/
scp -r deploy root@SERVER:/opt/session-trainer/
```

`frontend/dist` удобнее собрать локально (`deploy\build-frontend.ps1`) и скопировать:

```powershell
scp -r frontend/dist root@SERVER:/opt/session-trainer/frontend/
```

Вариант со сборкой на сервере: поставить Node.js 22+, скопировать `frontend/` целиком, выполнить `npm ci` и `npm run build` в `/opt/session-trainer/frontend`.

## 2. Пользователь

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin trainer
sudo mkdir -p /opt/session-trainer
sudo chown -R trainer:trainer /opt/session-trainer
```

## 3. Python и uv

```bash
sudo -u trainer -H bash -lc 'curl -LsSf https://astral.sh/uv/install.sh | sh'
sudo -u trainer -H bash -lc 'uv --version'
```

`uv` сам скачает нужную версию Python (в `pyproject.toml` — `>=3.14`); системный Python не требуется.

## 4. Зависимости

```bash
cd /opt/session-trainer/backend
sudo -u trainer -H bash -lc 'cd /opt/session-trainer/backend && uv sync --no-dev'
```

Появится `/opt/session-trainer/backend/.venv` с `uvicorn` внутри.

## 5. Настройки и секреты

```bash
sudo -u trainer cp /opt/session-trainer/backend/.env.example /opt/session-trainer/backend/.env
sudo -u trainer nano /opt/session-trainer/backend/.env
sudo chmod 600 /opt/session-trainer/backend/.env
```

Заполнить:

- `SITE_PASSWORD` — пароль входа (один на всех)
- `SESSION_SECRET` — случайная строка: `python3 -c "import secrets; print(secrets.token_hex(32))"`
- `DEEPSEEK_API_KEY` — ключ DeepSeek; пусто = ИИ выключен, части заполняются вручную
- `COOKIE_SECURE=true` — обязательно, если сайт работает по HTTPS
- `APP_DB_PATH=data/app.db` — база останется в `/opt/session-trainer/backend/data/app.db`

Каталог базы создаётся приложением при старте, отдельно делать ничего не нужно.

## 6. Сервис systemd

```bash
sudo cp /opt/session-trainer/deploy/server/session-trainer.service /etc/systemd/system/
sudo nano /etc/systemd/system/session-trainer.service   # CHANGE_ME_USER -> trainer
sudo systemctl daemon-reload
sudo systemctl enable --now session-trainer
sudo systemctl status session-trainer --no-pager
```

Проверка, что поднялось:

```bash
curl -s http://127.0.0.1:8010/api/health
# {"ok":true}
```

## 7. nginx

```bash
sudo cp /opt/session-trainer/deploy/server/nginx.conf /etc/nginx/sites-available/session-trainer.conf
sudo nano /etc/nginx/sites-available/session-trainer.conf   # CHANGE_ME_DOMAIN
sudo ln -s /etc/nginx/sites-available/session-trainer.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

Проверка снаружи: `http://ВАШ_ДОМЕН/` отдаёт страницу входа, `http://ВАШ_ДОМЕН/api/health` — `{"ok":true}`.

## 8. HTTPS

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d ВАШ_ДОМЕН
```

После выпуска сертификата в `backend/.env` поставить `COOKIE_SECURE=true` и перезапустить:

```bash
sudo systemctl restart session-trainer
```

`certbot` сам продлевает сертификат; проверка — `sudo certbot renew --dry-run`.

## 9. Обновление кода

```bash
# скопировать новые backend/ и frontend/dist на сервер, затем:
cd /opt/session-trainer/backend
sudo -u trainer -H bash -lc 'cd /opt/session-trainer/backend && uv sync --no-dev'
sudo systemctl restart session-trainer
```

Схема базы поднимается при старте, миграции по `PRAGMA user_version` выполняются автоматически. Перед обновлением сделать копию базы (п. 10).

## 10. Резервные копии

```bash
sudo mkdir -p /opt/session-trainer/backups
sudo chown trainer:trainer /opt/session-trainer/backups
```

Ежедневно в 04:00 через cron (копия снимается через SQLite backup API, безопасно при работающем сервисе):

```bash
sudo crontab -u trainer -e
```

Добавить одной строкой:

```cron
0 4 * * * cd /opt/session-trainer/backend && ./.venv/bin/python -c "import sqlite3; s=sqlite3.connect('data/app.db'); d=sqlite3.connect('/opt/session-trainer/backups/app-$(date +\%F-\%H\%M).db'); s.backup(d); d.close(); s.close()"
```

Плюс раз в месяц скачивать JSON: сайт → `/admin` → Экспорт.

## 11. Проверки после переноса

- `systemctl status session-trainer` — active (running)
- `journalctl -u session-trainer -n 50 --no-pager` — без ошибок старта
- `curl -s http://127.0.0.1:8010/api/health` → `{"ok":true}`
- вход по паролю, создание предмета и билета, решение части
- `curl -sI https://ВАШ_ДОМЕН/` — 200, кука `st_session` после входа
- `/admin`: расход ИИ за месяц и лимит 500 ₽

## 12. Если что-то не так

- **502 от nginx** — сервис не запущен или слушает не 8010: `systemctl status`, `ss -ltnp | grep 8010`.
- **Вход не работает, пароль верный** — `SITE_PASSWORD` в `.env` пустой или в нём пробелы по краям; после правки `systemctl restart session-trainer`.
- **Кука не ставится по HTTPS** — `COOKIE_SECURE=true` обязателен, иначе браузер её отбросит.
- **Страница входа белая / 404** — не скопирован `frontend/dist/index.html`; `dist` монтируется при старте, после копирования нужен рестарт сервиса.
- **Ошибка прав на базу** — `chown -R trainer:trainer /opt/session-trainer/backend`.
