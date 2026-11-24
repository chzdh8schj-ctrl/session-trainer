#!/usr/bin/env node
// Проверка, что фронтенд отдаётся и основные экраны живы. Без Playwright.
// Node 26, без внешних зависимостей. Запуск: node e2e/ui-check.mjs
//
// Параметры:
//   --url / UI_URL   адрес фронта (если не указан — проверяются 8010 и 5173)
//   --base-url       то же самое (совместимость с api-smoke.mjs)
//
// Что проверяется для каждого адреса:
//   * корень отвечает 200 и содержит <div id="root">;
//   * найдены скрипты: /assets/*.js (сборка) или /src/main.tsx (vite dev);
//   * если это сборка — ассет реально скачивается;
//   * /login отвечает и отдаёт HTML (в dev и в SPA это index.html).
//
// Коды выхода: 0 — хотя бы один адрес полностью рабочий, 1 — фронт есть, но сломан,
//              2 — фронт недоступен ни на одном адресе.

const args = process.argv.slice(2);
const explicitUrl = readUrlArg();
const targets = explicitUrl
  ? [normalize(explicitUrl)]
  : unique([normalize(process.env.UI_URL || process.env.BASE_URL || 'http://127.0.0.1:8010'), 'http://127.0.0.1:5173']);

const TIMEOUT_MS = 8000;

function readUrlArg() {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      console.log(`Проверка фронтенда «Тренажёр к сессии»

  node e2e/ui-check.mjs [--url http://127.0.0.1:5173]

Если адрес не указан, проверяются http://127.0.0.1:8010 (backend со сборкой)
и http://127.0.0.1:5173 (vite dev). Коды выхода: 0 — ок, 1 — сломан, 2 — недоступен.`);
      process.exit(0);
    }
    if (arg === '--url' || arg === '--base-url') {
      return args[i + 1] ?? '';
    }
    if (arg.startsWith('--url=') || arg.startsWith('--base-url=')) {
      return arg.slice(arg.indexOf('=') + 1);
    }
    if (arg.startsWith('-')) {
      console.error(`Неизвестный аргумент: ${arg}. Справка: node e2e/ui-check.mjs --help`);
      process.exit(2);
    }
  }
  return '';
}

function normalize(url) {
  return url.trim().replace(/\/+$/, '');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function describeError(error) {
  const code = error?.cause?.code || error?.cause?.errors?.[0]?.code;
  if (error?.name === 'TimeoutError') return 'таймаут';
  return code ? `${error.message} (${code})` : error?.message || String(error);
}

async function get(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'manual' });
  const text = await response.text();
  return { status: response.status, headers: response.headers, text };
}

async function checkTarget(baseUrl) {
  console.log(`\nПроверяю ${baseUrl}`);
  const result = { reachable: false, ok: false };

  let root;
  try {
    root = await get(`${baseUrl}/`);
  } catch (error) {
    console.log(`✗ корень недоступен — ${describeError(error)}`);
    return result;
  }
  result.reachable = true;
  console.log(`  / → HTTP ${root.status}, HTML ${root.text.length} символов`);

  if (root.status !== 200) {
    console.log('✗ корень отвечает не 200');
    return result;
  }

  const hasRoot = /id=["']root["']/.test(root.text);
  if (hasRoot) console.log('✓ в HTML есть <div id="root">');
  else console.log('✗ в HTML нет <div id="root"> — это не наше приложение');

  const scripts = [...root.text.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map((match) => match[1]);
  const bundle = scripts.find((src) => src.includes('/assets/') && src.endsWith('.js'));
  const devEntry = scripts.find((src) => src.includes('/src/main.tsx'));
  const title = root.text.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() || '';

  if (title) console.log(`  title: ${title}`);

  let assetsOk = true;
  if (bundle) {
    console.log(`  режим: сборка (${bundle})`);
    const assetUrl = bundle.startsWith('http') ? bundle : `${baseUrl}${bundle.startsWith('/') ? '' : '/'}${bundle}`;
    try {
      const asset = await get(assetUrl);
      const type = asset.headers.get('content-type') || '';
      if (asset.status === 200 && asset.text.length > 1000) {
        console.log(`✓ ассет отдаётся: HTTP ${asset.status}, ${asset.text.length} символов, ${type || 'тип не указан'}`);
      } else {
        assetsOk = false;
        console.log(`✗ ассет не отдаётся: HTTP ${asset.status}, ${asset.text.length} символов`);
      }
    } catch (error) {
      assetsOk = false;
      console.log(`✗ ассет недоступен — ${describeError(error)}`);
    }
  } else if (devEntry) {
    console.log(`  режим: vite dev (${devEntry}), отдельная сборка не нужна`);
  } else {
    assetsOk = false;
    console.log('✗ в HTML нет ни /assets/*.js, ни /src/main.tsx — нечего грузить');
  }

  let loginOk = true;
  try {
    const login = await get(`${baseUrl}/login`);
    const html = /<html[\s>]/i.test(login.text);
    console.log(`  /login → HTTP ${login.status}, HTML ${login.text.length} символов`);
    if (login.status === 200 && html) {
      console.log('✓ /login отдаёт HTML');
    } else {
      loginOk = false;
      console.log('✗ /login не отдаёт HTML (ожидался 200 + <html>)');
    }
  } catch (error) {
    loginOk = false;
    console.log(`✗ /login недоступен — ${describeError(error)}`);
  }

  result.ok = hasRoot && assetsOk && loginOk && root.status === 200;
  console.log(result.ok ? '✓ экран живой' : '✗ экран сломан');
  return result;
}

const results = [];
for (const target of targets) {
  results.push({ target, ...(await checkTarget(target)) });
}

const good = results.filter((item) => item.ok);
const reachable = results.filter((item) => item.reachable);

console.log('\nИтого:');
for (const item of results) {
  console.log(`  ${item.ok ? '✓' : item.reachable ? '✗' : '—'} ${item.target}${item.reachable ? '' : ' (недоступен)'}`);
}

if (good.length > 0) {
  console.log('Результат: OK');
  process.exitCode = 0;
} else if (reachable.length > 0) {
  console.log('Результат: FAIL — фронт отвечает, но не как ожидалось');
  process.exitCode = 1;
} else {
  console.log('Результат: фронт недоступен');
  console.log('  Подними vite: cd frontend; npm install; npm run dev');
  console.log('  Или собери и отдай через backend: cd frontend; npm run build; cd ..; cd backend; uv run uvicorn app.main:app');
  process.exitCode = 2;
}
