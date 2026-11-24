import type { AiStatus } from './types';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Выключить автопереход на /login при 401 (нужно для /api/auth/me и самого входа). */
  redirectOn401?: boolean;
};

const BY_STATUS: Record<number, string> = {
  400: 'Сервер не принял запрос. Проверь заполненные поля.',
  401: 'Нужно войти заново.',
  403: 'Нет доступа.',
  404: 'Не найдено. Возможно, это уже удалили.',
  409: 'Части уже есть. Подтверди перегенерацию.',
  413: 'Слишком большой файл.',
  422: 'Какое-то поле заполнено неверно.',
  429: 'Слишком много запросов, подожди немного.',
  500: 'Ошибка на сервере. Попробуй ещё раз.',
  502: 'Сервер не ответил. Попробуй ещё раз.',
  503: 'Сервер недоступен.',
};

const SERVICE_DETAIL = /^[a-z0-9_\-. ]+$/i;

function describeError(status: number, detail: unknown): string {
  if (typeof detail === 'string') {
    const text = detail.trim();
    if (text && !SERVICE_DETAIL.test(text)) return text;
  }
  if (status === 0) return 'Сервер не отвечает. Проверь, что backend запущен.';
  return BY_STATUS[status] ?? `Что-то пошло не так (код ${status}).`;
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return 'Не получилось. Попробуй ещё раз.';
}

let redirecting = false;

function goToLogin() {
  if (redirecting) return;
  redirecting = true;
  if (!window.location.pathname.startsWith('/login')) {
    window.location.assign('/login');
  } else {
    redirecting = false;
  }
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, redirectOn401 = true } = options;

  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: 'include',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError('Сервер не отвечает. Проверь, что backend запущен.', 0);
  }

  if (response.status === 401) {
    if (redirectOn401) goToLogin();
    throw new ApiError('Нужно войти заново.', 401);
  }

  if (!response.ok) {
    let detail: unknown;
    try {
      const parsed: unknown = await response.json();
      if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
        detail = (parsed as { detail: unknown }).detail;
      }
    } catch {
      detail = undefined;
    }
    throw new ApiError(describeError(response.status, detail), response.status);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  if (!text) return undefined as T;

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError('Сервер прислал непонятный ответ.', response.status);
  }
}

export function aiStatusText(status: AiStatus, aiError?: string): string {
  switch (status) {
    case 'ok':
      return 'ИИ подготовил варианты ответов.';
    case 'manual':
      return 'ИИ выключен или не настроен ключ. Создана одна пустая часть — заполни её вручную в редакторе.';
    case 'budget':
      return 'Месячный лимит на ИИ израсходован. Части не сгенерированы — можно заполнить вручную или поднять лимит в «Журнале ИИ».';
    case 'error':
      return aiError
        ? `ИИ не смог ответить: ${aiError}. Добавь варианты вручную в редакторе.`
        : 'ИИ не смог ответить. Добавь варианты вручную в редакторе.';
    default:
      return 'Готово.';
  }
}

export function aiStatusTone(status: AiStatus): 'ok' | 'warn' | 'error' {
  if (status === 'ok') return 'ok';
  if (status === 'error') return 'error';
  return 'warn';
}
