import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorText } from '../api';
import type { Backup, BackupSubject, ImportResult, Settings, Usage } from '../types';

type Msg = { tone: 'ok' | 'warn' | 'error'; text: string };

function money(value: number): string {
  return value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function count(value: number): string {
  return value.toLocaleString('ru-RU');
}

function extractSubjects(input: unknown): BackupSubject[] | null {
  if (Array.isArray(input)) return input as BackupSubject[];
  if (input && typeof input === 'object') {
    const subjects = (input as { subjects?: unknown }).subjects;
    if (Array.isArray(subjects)) return subjects as BackupSubject[];
  }
  return null;
}

export default function Admin() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState('');

  const [limit, setLimit] = useState('');
  const [limitMsg, setLimitMsg] = useState('');
  const [savingLimit, setSavingLimit] = useState(false);
  const [savingToggle, setSavingToggle] = useState(false);

  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState<Msg | null>(null);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<Msg | null>(null);
  const [replace, setReplace] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [usageData, settings] = await Promise.all([
        api<Usage>('/api/usage'),
        api<Settings>('/api/settings'),
      ]);
      setUsage(usageData);
      setLimit(String(settings.monthly_limit_rub));
    } catch (caught) {
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveLimit = async () => {
    const value = Number(limit.replace(',', '.').trim());
    if (!Number.isFinite(value) || value < 0) {
      setLimitMsg('Нужно неотрицательное число, например 500.');
      return;
    }
    setSavingLimit(true);
    setLimitMsg('');
    try {
      await api<Settings>('/api/settings', { method: 'PUT', body: { monthly_limit_rub: value } });
      setLimitMsg('Лимит сохранён.');
      await load();
    } catch (caught) {
      setLimitMsg(errorText(caught));
    } finally {
      setSavingLimit(false);
    }
  };

  const toggleAi = async () => {
    if (!usage) return;
    setSavingToggle(true);
    setError('');
    try {
      await api<Settings>('/api/settings', {
        method: 'PUT',
        body: { ai_enabled: !usage.ai_enabled },
      });
      await load();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSavingToggle(false);
    }
  };

  const exportJson = async () => {
    setExporting(true);
    setExportMsg(null);
    try {
      const data = await api<Backup>('/api/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `trenazher-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      setExportMsg({ tone: 'ok', text: 'Копия скачана.' });
    } catch (caught) {
      setExportMsg({ tone: 'error', text: errorText(caught) });
    } finally {
      setExporting(false);
    }
  };

  const importFile = async (file: File) => {
    setImporting(true);
    setImportMsg(null);
    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        setImportMsg({ tone: 'error', text: 'Это не JSON-файл копии.' });
        return;
      }
      const subjects = extractSubjects(parsed);
      if (!subjects) {
        setImportMsg({ tone: 'error', text: 'В файле нет списка предметов. Похоже, это не та копия.' });
        return;
      }
      if (!replace) {
        setImportMsg({
          tone: 'warn',
          text: 'Галочка «Заменить всё» снята — предметы добавятся к текущим.',
        });
      }
      if (replace) {
        const agreed = window.confirm('Заменить все данные? Текущие предметы, билеты и части будут удалены.');
        if (!agreed) {
          setImportMsg({ tone: 'warn', text: 'Импорт отменён.' });
          return;
        }
      }
      const result = await api<ImportResult>('/api/import', {
        method: 'POST',
        body: { replace, subjects },
      });
      setImportMsg({
        tone: 'ok',
        text: `Импортировано: предметов ${result.subjects_created}, билетов ${result.tickets_created}, частей ${result.parts_created}.`,
      });
    } catch (caught) {
      setImportMsg({ tone: 'error', text: errorText(caught) });
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const spent = usage?.cost_rub ?? 0;
  const limitRub = usage?.limit_rub ?? 0;
  const percent = limitRub > 0 ? Math.min(100, Math.round((spent / limitRub) * 100)) : 100;

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">Журнал ИИ</h1>
        <button type="button" className="btn btn-sm" onClick={() => void load()}>
          Обновить
        </button>
      </div>

      {error && <p className="banner banner-error">{error}</p>}

      {!usage && !error && <p className="muted">Загружаю расход…</p>}

      {usage && (
        <>
          <div className="card stack">
            <div className="card-head">
              <strong className="card-title">Расход за {usage.month}</strong>
              <span className={usage.ai_enabled ? 'pill pill-green' : 'pill pill-red'}>
                ИИ {usage.ai_enabled ? 'включён' : 'выключен'}
              </span>
            </div>

            <div className="stat-grid">
              <div className="stat">
                <span className="stat-label">Запросов</span>
                <span className="stat-value">{count(usage.requests)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Токенов на входе</span>
                <span className="stat-value">{count(usage.prompt_tokens)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Токенов на выходе</span>
                <span className="stat-value">{count(usage.completion_tokens)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Потрачено</span>
                <span className="stat-value">{money(spent)} ₽</span>
              </div>
            </div>

            <div>
              <div className="progress">
                <div className={percent >= 100 ? 'progress-fill progress-fill-red' : 'progress-fill'} style={{ width: `${percent}%` }} />
              </div>
              <p className="muted small">
                Лимит {money(limitRub)} ₽ · остаток {money(usage.left_rub)} ₽
              </p>
            </div>
          </div>

          <div className="card stack">
            <h2 className="section-title">Лимит в рублях на месяц</h2>
            <label className="field">
              <span className="label">Сколько рублей можно тратить на ИИ</span>
              <input
                inputMode="decimal"
                value={limit}
                onChange={(event) => {
                  setLimit(event.target.value);
                  setLimitMsg('');
                }}
                disabled={savingLimit}
              />
            </label>
            {limitMsg && <p className="muted small">{limitMsg}</p>}
            <button type="button" className="btn btn-primary" onClick={() => void saveLimit()} disabled={savingLimit}>
              {savingLimit ? 'Сохраняю…' : 'Сохранить лимит'}
            </button>
          </div>

          <div className="card stack">
            <h2 className="section-title">Генерация ИИ</h2>
            <p className="muted small">
              Если выключить, новые части не генерируются — при добавлении билета создаётся пустая часть
              для ручного заполнения.
            </p>
            <button
              type="button"
              className={usage.ai_enabled ? 'btn btn-green' : 'btn'}
              onClick={() => void toggleAi()}
              disabled={savingToggle}
            >
              {savingToggle ? 'Сохраняю…' : usage.ai_enabled ? 'Выключить ИИ' : 'Включить ИИ'}
            </button>
          </div>
        </>
      )}

      <div className="card stack">
        <h2 className="section-title">Копия данных</h2>
        <p className="muted small">Экспорт — один JSON-файл со всеми предметами, билетами и частями.</p>
        <button type="button" className="btn btn-primary" onClick={() => void exportJson()} disabled={exporting}>
          {exporting ? 'Готовлю файл…' : 'Скачать копию'}
        </button>
        {exportMsg && <p className={`banner banner-${exportMsg.tone}`}>{exportMsg.text}</p>}

        <hr className="divider" />

        <label className="check">
          <input type="checkbox" checked={replace} onChange={(event) => setReplace(event.target.checked)} />
          <span>Заменить всё (удалить текущие предметы)</span>
        </label>

        <label className="btn btn-block" aria-disabled={importing}>
          {importing ? 'Загружаю…' : 'Выбрать файл копии'}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            disabled={importing}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importFile(file);
            }}
          />
        </label>

        {importMsg && <p className={`banner banner-${importMsg.tone}`}>{importMsg.text}</p>}
      </div>
    </div>
  );
}
