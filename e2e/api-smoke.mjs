#!/usr/bin/env node
// Интеграционный смоук API «Тренажёр к сессии».
// Node 26, без внешних зависимостей. Запуск: node e2e/api-smoke.mjs
//
// Параметры (аргументы важнее env):
//   --base-url / BASE_URL        адрес backend, по умолчанию http://127.0.0.1:8010
//   --password / PASSWORD        пароль сайта, иначе SITE_PASSWORD
//   --timeout                    таймаут обычного запроса, мс (по умолчанию 10000)
//   --ai-timeout                 таймаут запросов, где работает ИИ, мс (по умолчанию 120000)
//
// Коды выхода: 0 — все проверки прошли (предупреждения допустимы), 1 — есть падения,
//              2 — backend недоступен / не задан пароль.

const CFG = readConfig();

function readConfig() {
  const opts = { baseUrl: '', password: null, timeout: null, aiTimeout: null };
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg : arg.slice(0, eq);
    const inline = eq === -1 ? null : arg.slice(eq + 1);
    const value = () => {
      if (inline !== null) return inline;
      i += 1;
      return args[i] ?? '';
    };

    if (key === '--help' || key === '-h') {
      printHelp();
      process.exit(0);
    } else if (key === '--base-url' || key === '--url') {
      opts.baseUrl = value();
    } else if (key === '--password') {
      opts.password = value();
    } else if (key === '--timeout') {
      opts.timeout = Number(value());
    } else if (key === '--ai-timeout') {
      opts.aiTimeout = Number(value());
    } else {
      console.error(`Неизвестный аргумент: ${arg}. Справка: node e2e/api-smoke.mjs --help`);
      process.exit(2);
    }
  }

  const baseUrl = (opts.baseUrl || process.env.BASE_URL || 'http://127.0.0.1:8010').replace(/\/+$/, '');
  const password = opts.password ?? process.env.PASSWORD ?? process.env.SITE_PASSWORD ?? '';
  const timeout = Number.isFinite(opts.timeout) && opts.timeout > 0 ? opts.timeout : 10_000;
  const aiTimeout = Number.isFinite(opts.aiTimeout) && opts.aiTimeout > 0 ? opts.aiTimeout : 120_000;

  return { baseUrl, password, timeoutMs: timeout, aiTimeoutMs: aiTimeout };
}

function printHelp() {
  console.log(`Интеграционный смоук API «Тренажёр к сессии»

  node e2e/api-smoke.mjs [--base-url URL] [--password ПАРОЛЬ] [--timeout МС] [--ai-timeout МС]

Переменные окружения: BASE_URL, PASSWORD (или SITE_PASSWORD), API_TIMEOUT, AI_TIMEOUT.

Примеры (PowerShell):
  $env:SITE_PASSWORD = 'мой пароль'; node e2e/api-smoke.mjs
  node e2e/api-smoke.mjs --base-url http://127.0.0.1:8010 --password 'мой пароль'

Коды выхода: 0 — успех, 1 — есть падения, 2 — backend недоступен или нет пароля.`);
}

// ---------- вывод ----------

const counts = { pass: 0, fail: 0, warn: 0 };

function pass(title, detail = '') {
  counts.pass += 1;
  console.log(`✓ ${title}${detail ? ` — ${detail}` : ''}`);
}

function fail(title, detail = '') {
  counts.fail += 1;
  console.log(`✗ ${title}${detail ? ` — ${detail}` : ''}`);
}

function warn(title, detail = '') {
  counts.warn += 1;
  console.log(`! ${title}${detail ? ` — ${detail}` : ''}`);
}

function check(title, condition, detail = '') {
  if (condition) pass(title, detail);
  else fail(title, detail);
  return Boolean(condition);
}

function note(text) {
  console.log(`  ${text}`);
}

function describeError(error) {
  if (!error) return 'неизвестная ошибка';
  if (error.name === 'TimeoutError') return 'таймаут запроса';
  const cause = error.cause;
  const code = cause?.code || cause?.errors?.[0]?.code;
  if (code) return `${error.message} (${code})`;
  return error.message || String(error);
}

// ---------- HTTP с ручной кукой ----------

const cookies = new Map();

function storeCookie(raw) {
  const [pair, ...attrs] = String(raw).split(';');
  const eq = pair.indexOf('=');
  if (eq === -1) return;
  const name = pair.slice(0, eq).trim();
  const value = pair.slice(eq + 1).trim();
  const expired = attrs.some((attr) => /^\s*max-age=0\s*$/i.test(attr) || /^\s*expires=thu, 01 jan 1970/i.test(attr));
  if (!name || !value || expired) cookies.delete(name);
  else cookies.set(name, value);
}

function cookieHeader() {
  return [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function request(path, { method = 'GET', body, auth = true, timeout = CFG.timeoutMs } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth && cookies.size > 0) headers.cookie = cookieHeader();

  const response = await fetch(CFG.baseUrl + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
    redirect: 'manual',
  });

  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  for (const raw of setCookies) storeCookie(raw);

  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: response.status, headers: response.headers, setCookies, text, json };
}

function hasCookie(name) {
  return cookies.has(name);
}

// ---------- сценарий ----------

const createdSubjects = new Map(); // id -> причина создания
const createdTicketIds = [];

function markerName() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).slice(2, 7);
  return `e2e-${stamp}-${rand}`;
}

async function deleteSubjectQuietly(id) {
  if (!createdSubjects.has(id)) return;
  try {
    const response = await request(`/api/subjects/${id}`, { method: 'DELETE' });
    if (response.status === 204 || response.status === 404) {
      createdSubjects.delete(id);
    } else {
      console.log(`  ! не удалось удалить предмет ${id}: HTTP ${response.status}`);
    }
  } catch (error) {
    console.log(`  ! не удалось удалить предмет ${id}: ${describeError(error)}`);
  }
}

async function main() {
  console.log(`Смоук API: ${CFG.baseUrl}`);

  // 0. Backend вообще отвечает? Отдельно, чтобы не падать стектрейсом.
  let health;
  try {
    health = await request('/api/health', { auth: false, timeout: Math.min(CFG.timeoutMs, 5000) });
  } catch (error) {
    console.error(`\n✗ backend недоступен на ${CFG.baseUrl}`);
    console.error(`  ${describeError(error)}`);
    console.error('  Запусти его: cd backend; uv run uvicorn app.main:app --host 127.0.0.1 --port 8010');
    console.error('  Или укажи другой адрес: node e2e/api-smoke.mjs --base-url http://127.0.0.1:8010');
    process.exit(2);
  }

  if (!CFG.password) {
    console.error('\n✗ не задан пароль сайта');
    console.error('  Передай его: $env:SITE_PASSWORD = "пароль"; node e2e/api-smoke.mjs');
    console.error('  Или аргументом: node e2e/api-smoke.mjs --password "пароль"');
    process.exit(2);
  }

  console.log('1. Здоровье и авторизация');
  check('/api/health → 200 без куки', health.status === 200 && health.json?.ok === true, `HTTP ${health.status}, тело: ${health.text.slice(0, 80)}`);

  const noCookie = await request('/api/subjects', { auth: false });
  check('/api/subjects без куки → 401', noCookie.status === 401, `HTTP ${noCookie.status}`);

  const wrong = await request('/api/auth/login', { method: 'POST', body: { password: `${CFG.password}-not-a-password` }, auth: false });
  check('вход с неверным паролем → 401', wrong.status === 401, `HTTP ${wrong.status}`);
  check('после неверного пароля куки нет', !hasCookie('st_session'));

  const login = await request('/api/auth/login', { method: 'POST', body: { password: CFG.password }, auth: false });
  const loginSetCookies = login.setCookies.join(' | ');
  check('вход с верным паролем → 204', login.status === 204, `HTTP ${login.status}`);
  check('после входа есть кука st_session', hasCookie('st_session'), loginSetCookies.slice(0, 120) || 'Set-Cookie пуст');
  check('кука HttpOnly', /httponly/i.test(loginSetCookies), loginSetCookies.slice(0, 120));

  const me = await request('/api/auth/me');
  check('/api/auth/me → 200 с кукой', me.status === 200 && me.json?.ok === true, `HTTP ${me.status}`);

  const subjectsBefore = await request('/api/subjects');
  if (!check('GET /api/subjects → 200 с кукой', subjectsBefore.status === 200 && Array.isArray(subjectsBefore.json), `HTTP ${subjectsBefore.status}`)) {
    throw new Error('список предметов недоступен, дальше идти нет смысла');
  }
  const baselineIds = new Set(subjectsBefore.json.map((subject) => subject.id));

  console.log('\n2. Предметы');
  const subjectName = markerName();
  const created = await request('/api/subjects', { method: 'POST', body: { name: subjectName } });
  const subjectOk = check('создание предмета → 201', created.status === 201 && created.json?.id, `HTTP ${created.status}, id: ${created.json?.id ?? '—'}`);
  if (!subjectOk) throw new Error('без созданного предмета сценарий не продолжить');
  const subjectId = created.json.id;
  createdSubjects.set(subjectId, 'основной');

  const afterCreate = await request('/api/subjects');
  const createdInList = Array.isArray(afterCreate.json) && afterCreate.json.find((subject) => subject.id === subjectId);
  check('созданный предмет есть в списке', Boolean(createdInList), createdInList ? `билетов: ${createdInList.tickets_count}` : 'не найден');

  console.log('\n3. Билет и части (ИИ может быть недоступен — это не падение)');
  const ticketResponse = await request('/api/tickets', {
    method: 'POST',
    timeout: CFG.aiTimeoutMs,
    body: {
      subject_id: subjectId,
      title: 'E2E: базовый вопрос',
      question: 'Что такое HTTP и зачем он нужен?',
    },
  });
  check('создание билета → 200/201', ticketResponse.status === 200 || ticketResponse.status === 201, `HTTP ${ticketResponse.status}`);
  const ticket = ticketResponse.json;
  if (!ticket?.id) throw new Error(`билет не создан: ${ticketResponse.text.slice(0, 200)}`);
  createdTicketIds.push(ticket.id);

  const parts = Array.isArray(ticket.parts) ? ticket.parts : [];
  const aiStatus = ticket.ai_status ?? '(нет поля)';
  note(`ai_status: ${aiStatus}${ticket.ai_error ? `, ai_error: ${String(ticket.ai_error).slice(0, 160)}` : ''}`);
  check('у билета есть хотя бы одна часть', parts.length >= 1, `частей: ${parts.length}`);

  if (aiStatus === 'ok') {
    parts.forEach((part, index) => {
      const options = Array.isArray(part.options) ? part.options : [];
      const label = `часть ${index + 1}`;
      check(`${label}: вариантов 3–4`, options.length >= 3 && options.length <= 4, `вариантов: ${options.length}`);
      check(
        `${label}: correct_index указывает на существующий вариант`,
        Number.isInteger(part.correct_index) && part.correct_index >= 0 && part.correct_index < options.length,
        `correct_index: ${part.correct_index}`,
      );
      check(`${label}: note непустой`, typeof part.note === 'string' && part.note.trim().length > 0, `длина note: ${part.note?.length ?? 0}`);
    });
  } else {
    warn(`ИИ не сгенерировал варианты (ai_status=${aiStatus}) — проверки вариантов пропущены`, ticket.ai_error ? String(ticket.ai_error).slice(0, 160) : '');
    warn('черновик проверен только на наличие части; доработать в редакторе можно вручную');
  }

  console.log('\n4. Ответы на часть');
  const manualPart = await request(`/api/tickets/${ticket.id}/parts`, {
    method: 'POST',
    body: {
      title: 'E2E: ручная часть',
      question: 'Выбери правильный вариант ответа',
      options: ['Альфа', 'Бета', 'Гамма'],
      correct_index: 1,
      note: 'E2E: правильный ответ — Бета. Эта часть создана тестом вручную.',
    },
  });
  const manualOk = check('ручная часть создана', manualPart.status === 200 && manualPart.json?.id, `HTTP ${manualPart.status}`);

  if (manualOk) {
    const partId = manualPart.json.id;
    const good = await request(`/api/parts/${partId}/answer`, { method: 'POST', body: { chosen_index: 1 } });
    check('верный вариант → correct: true', good.status === 200 && good.json?.correct === true, `HTTP ${good.status}, тело: ${good.text.slice(0, 120)}`);
    check('верный ответ возвращает correct_index', good.json?.correct_index === 1, `correct_index: ${good.json?.correct_index}`);

    const bad = await request(`/api/parts/${partId}/answer`, { method: 'POST', body: { chosen_index: 0 } });
    check('неверный вариант → correct: false', bad.status === 200 && bad.json?.correct === false, `HTTP ${bad.status}, тело: ${bad.text.slice(0, 120)}`);
    check('неверный ответ отдаёт note', typeof bad.json?.note === 'string' && bad.json.note.trim().length > 0, `note: ${bad.json?.note?.slice(0, 80) ?? '—'}`);
  } else {
    warn('ответы на часть не проверены: ручная часть не создалась');
  }

  console.log('\n5. Расход ИИ');
  const usageResponse = await request('/api/usage');
  const usage = usageResponse.json;
  if (check('/api/usage → 200', usageResponse.status === 200 && usage, `HTTP ${usageResponse.status}`)) {
    const fields = ['requests', 'prompt_tokens', 'completion_tokens', 'cost_rub', 'limit_rub', 'left_rub'];
    check('/api/usage: числовые поля', fields.every((field) => typeof usage[field] === 'number'), fields.map((field) => `${field}=${usage[field]}`).join(', '));
    check('/api/usage: ai_enabled — boolean', typeof usage.ai_enabled === 'boolean', `ai_enabled=${usage.ai_enabled}`);
    check('/api/usage: месяц в формате YYYY-MM', /^\d{4}-\d{2}$/.test(String(usage.month)), `month=${usage.month}`);
    note(`месяц ${usage.month}: запросов ${usage.requests}, токены ${usage.prompt_tokens}/${usage.completion_tokens}, ${usage.cost_rub} ₽ из ${usage.limit_rub} ₽, осталось ${usage.left_rub} ₽`);
    if (!usage.ai_enabled) warn('ИИ выключен в настройках — генерация новых билетов будет в ручном режиме');
    if (usage.left_rub === 0 && usage.limit_rub > 0) warn('месячный лимит ИИ исчерпан — новые билеты будут с ai_status="budget"');
  }

  console.log('\n6. Экспорт → импорт');
  const exported = await request('/api/export');
  const exportOk = check('/api/export → 200, version 1', exported.status === 200 && exported.json?.version === 1, `HTTP ${exported.status}`);
  let importedId = null;
  if (exportOk) {
    const slice = (exported.json.subjects || []).filter((subject) => subject.name === subjectName);
    const sliceOk = check('в экспорте есть только что созданный предмет', slice.length === 1, `найдено: ${slice.length}`);
    if (sliceOk) {
      const exportedSubject = slice[0];
      const ticketCount = (exportedSubject.tickets || []).length;
      const partCount = (exportedSubject.tickets || []).reduce((sum, item) => sum + (item.parts || []).length, 0);
      check('в экспорте есть билет с частями', ticketCount >= 1 && partCount >= 1, `билетов: ${ticketCount}, частей: ${partCount}`);

      const beforeImport = await request('/api/subjects');
      const beforeCount = Array.isArray(beforeImport.json) ? beforeImport.json.length : -1;

      // replace:false и только наш предмет — реальные данные не дублируются.
      const imported = await request('/api/import', { method: 'POST', body: { replace: false, subjects: [exportedSubject] } });
      const importOk = check('импорт (replace:false) → 200', imported.status === 200, `HTTP ${imported.status}, тело: ${imported.text.slice(0, 160)}`);
      if (importOk) {
        check('импорт: создан 1 предмет', imported.json?.subjects_created === 1, `subjects_created=${imported.json?.subjects_created}`);
        check('импорт: билеты перенесены', imported.json?.tickets_created >= 1, `tickets_created=${imported.json?.tickets_created}`);
        check('импорт: части перенесены', imported.json?.parts_created >= partCount, `parts_created=${imported.json?.parts_created}, ожидалось не меньше ${partCount}`);

        const afterImport = await request('/api/subjects');
        const afterList = Array.isArray(afterImport.json) ? afterImport.json : [];
        check('список предметов вырос на 1', afterList.length === beforeCount + 1, `${beforeCount} → ${afterList.length}`);
        const importedSubject = afterList.find((subject) => subject.name === subjectName && subject.id !== subjectId);
        if (check('импортированный предмет виден в списке', Boolean(importedSubject))) {
          importedId = importedSubject.id;
          createdSubjects.set(importedId, 'импортированный');
          check(
            'у импортированного предмета есть билеты и части',
            importedSubject.tickets_count >= 1 && importedSubject.parts_count >= 1,
            `билетов: ${importedSubject.tickets_count}, частей: ${importedSubject.parts_count}`,
          );
        }
      }
    }
  }

  console.log('\n7. Удаление и чистота');
  const removed = await request(`/api/subjects/${subjectId}`, { method: 'DELETE' });
  check('удаление предмета → 204', removed.status === 204, `HTTP ${removed.status}`);
  if (removed.status === 204) createdSubjects.delete(subjectId);

  const afterDelete = await request('/api/subjects');
  const afterDeleteList = Array.isArray(afterDelete.json) ? afterDelete.json : [];
  check('удалённого предмета нет в списке', !afterDeleteList.some((subject) => subject.id === subjectId));
  if (importedId) {
    const removedImported = await request(`/api/subjects/${importedId}`, { method: 'DELETE' });
    check('импортированная копия удалена → 204', removedImported.status === 204, `HTTP ${removedImported.status}`);
    if (removedImported.status === 204) createdSubjects.delete(importedId);
  }

  const finalList = await request('/api/subjects');
  const finalIds = new Set((finalList.json || []).map((subject) => subject.id));
  const leaked = [...finalIds].filter((id) => !baselineIds.has(id));
  check('реальные данные не изменены: список предметов вернулся к исходному', leaked.length === 0 && finalIds.size === baselineIds.size, leaked.length ? `лишние записи: ${leaked.join(', ')}` : `предметов: ${finalIds.size}`);
  if (leaked.length > 0) {
    for (const id of leaked) await deleteSubjectQuietly(id);
  }
}

// ---------- запуск ----------

try {
  await main();
} catch (error) {
  console.log();
  fail('сценарий прерван', describeError(error));
} finally {
  // Что не удалили по ходу — удаляем здесь.
  for (const id of [...createdSubjects.keys()]) {
    await deleteSubjectQuietly(id);
  }

  const total = counts.pass + counts.fail;
  console.log(`\nИтого: ${counts.pass}/${total} проверок пройдено, падений: ${counts.fail}, предупреждений: ${counts.warn}`);
  if (counts.fail > 0) {
    console.log('Результат: FAIL');
    process.exitCode = 1;
  } else {
    console.log('Результат: OK');
    process.exitCode = 0;
  }
}
