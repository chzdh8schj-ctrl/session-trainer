import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { aiStatusText, aiStatusTone, api, errorText } from '../api';
import type { Part, PartPayload, Ticket, TicketWithAi } from '../types';

type FormState = {
  title: string;
  question: string;
  options: string[];
  correct_index: number;
  note: string;
};

type Notice = {
  text: string;
  tone: 'ok' | 'warn' | 'error';
};

function toForm(part: Part): FormState {
  const options = part.options.slice(0, 4);
  while (options.length < 4) options.push('');
  return {
    title: part.title,
    question: part.question,
    options,
    correct_index: part.correct_index,
    note: part.note,
  };
}

function emptyForm(): FormState {
  return { title: '', question: '', options: ['', '', '', ''], correct_index: 0, note: '' };
}

type Prepared = { payload: PartPayload } | { error: string };

function prepare(form: FormState): Prepared {
  const title = form.title.trim();
  if (!title) return { error: 'Напиши название части.' };

  const kept: string[] = [];
  const remap: number[] = [];
  form.options.forEach((raw, index) => {
    const value = raw.trim();
    if (value) {
      remap[index] = kept.length;
      kept.push(value);
    } else {
      remap[index] = -1;
    }
  });

  if (kept.length < 2) return { error: 'Нужно минимум два варианта ответа.' };
  const correct = remap[form.correct_index];
  if (correct === undefined || correct < 0) return { error: 'Отметь правильный вариант.' };

  return {
    payload: {
      title,
      question: form.question.trim(),
      options: kept,
      correct_index: correct,
      note: form.note.trim(),
    },
  };
}

export default function TicketEditor() {
  const { id = '', ticketId = '' } = useParams();

  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [error, setError] = useState('');
  const [header, setHeader] = useState({ title: '', question: '' });
  const [headerBusy, setHeaderBusy] = useState(false);
  const [headerMsg, setHeaderMsg] = useState('');

  const [forms, setForms] = useState<Record<string, FormState>>({});
  const [partMsg, setPartMsg] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [newForm, setNewForm] = useState<FormState | null>(null);
  const [newMsg, setNewMsg] = useState('');
  const [newBusy, setNewBusy] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const data = await api<Ticket>(`/api/tickets/${ticketId}`);
      setTicket(data);
      setHeader({ title: data.title, question: data.question });
      const map: Record<string, FormState> = {};
      data.parts.forEach((part) => {
        map[part.id] = toForm(part);
      });
      setForms(map);
    } catch (caught) {
      setError(errorText(caught));
    }
  }, [ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveHeader = async () => {
    const title = header.title.trim();
    if (!title) {
      setHeaderMsg('Напиши название билета.');
      return;
    }
    setHeaderBusy(true);
    setHeaderMsg('');
    try {
      const updated = await api<Ticket>(`/api/tickets/${ticketId}`, {
        method: 'PATCH',
        body: { title, question: header.question.trim() },
      });
      setTicket((current) => (current ? { ...current, ...updated } : updated));
      setHeader({ title: updated.title, question: updated.question });
      setHeaderMsg('Билет сохранён.');
    } catch (caught) {
      setHeaderMsg(errorText(caught));
    } finally {
      setHeaderBusy(false);
    }
  };

  const patchForm = (partId: string, patch: Partial<FormState>) => {
    setForms((current) => {
      const base = current[partId] ?? emptyForm();
      return { ...current, [partId]: { ...base, ...patch } };
    });
  };

  const savePart = async (partId: string) => {
    const form = forms[partId];
    if (!form) return;
    const prepared = prepare(form);
    if ('error' in prepared) {
      setPartMsg((current) => ({ ...current, [partId]: prepared.error }));
      return;
    }
    setSavingId(partId);
    setPartMsg((current) => ({ ...current, [partId]: '' }));
    try {
      const updated = await api<Part>(`/api/parts/${partId}`, {
        method: 'PATCH',
        body: prepared.payload,
      });
      setTicket((current) =>
        current
          ? { ...current, parts: current.parts.map((part) => (part.id === partId ? updated : part)) }
          : current,
      );
      setForms((current) => ({ ...current, [partId]: toForm(updated) }));
      setPartMsg((current) => ({ ...current, [partId]: 'Часть сохранена.' }));
    } catch (caught) {
      setPartMsg((current) => ({ ...current, [partId]: errorText(caught) }));
    } finally {
      setSavingId(null);
    }
  };

  const deletePart = async (part: Part) => {
    const agreed = window.confirm(`Удалить часть «${part.title || 'без названия'}»?`);
    if (!agreed) return;
    setDeletingId(part.id);
    try {
      await api(`/api/parts/${part.id}`, { method: 'DELETE' });
      setTicket((current) =>
        current ? { ...current, parts: current.parts.filter((item) => item.id !== part.id) } : current,
      );
      setForms((current) => {
        const next = { ...current };
        delete next[part.id];
        return next;
      });
    } catch (caught) {
      setPartMsg((current) => ({ ...current, [part.id]: errorText(caught) }));
    } finally {
      setDeletingId(null);
    }
  };

  const createPart = async () => {
    if (!newForm) return;
    const prepared = prepare(newForm);
    if ('error' in prepared) {
      setNewMsg(prepared.error);
      return;
    }
    setNewBusy(true);
    setNewMsg('');
    try {
      const created = await api<Part>(`/api/tickets/${ticketId}/parts`, {
        method: 'POST',
        body: prepared.payload,
      });
      setTicket((current) =>
        current ? { ...current, parts: [...current.parts, created] } : current,
      );
      setForms((current) => ({ ...current, [created.id]: toForm(created) }));
      setNewForm(null);
    } catch (caught) {
      setNewMsg(errorText(caught));
    } finally {
      setNewBusy(false);
    }
  };

  const generate = async () => {
    const agreed = window.confirm(
      'Сгенерировать части заново? Текущие части этого билета будут удалены и заменены ответом ИИ.',
    );
    if (!agreed) return;
    setGenerating(true);
    setNotice(null);
    try {
      const data = await api<TicketWithAi>(`/api/tickets/${ticketId}/generate`, {
        method: 'POST',
        body: { force: true },
      });
      setNotice({ text: aiStatusText(data.ai_status, data.ai_error), tone: aiStatusTone(data.ai_status) });
      await load();
    } catch (caught) {
      setNotice({ text: errorText(caught), tone: 'error' });
    } finally {
      setGenerating(false);
    }
  };

  if (error) {
    return (
      <div className="stack">
        <div className="banner banner-error">
          <span>{error}</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void load()}>
            Повторить
          </button>
        </div>
        <Link className="btn btn-block" to={`/subject/${id}`}>
          К предмету
        </Link>
      </div>
    );
  }

  if (!ticket) {
    return <p className="muted">Загружаю билет…</p>;
  }

  return (
    <div className="stack">
      <div className="crumbs">
        <Link to={`/subject/${id}`}>← К билетам</Link>
      </div>

      <div className="page-head">
        <h1 className="page-title">Редактор билета</h1>
      </div>

      <div className="card stack">
        <label className="field">
          <span className="label">Название билета</span>
          <input
            value={header.title}
            onChange={(event) => setHeader((current) => ({ ...current, title: event.target.value }))}
            disabled={headerBusy}
          />
        </label>
        <label className="field">
          <span className="label">Полный текст вопроса</span>
          <textarea
            value={header.question}
            rows={6}
            onChange={(event) => setHeader((current) => ({ ...current, question: event.target.value }))}
            disabled={headerBusy}
          />
        </label>
        {headerMsg && <p className="muted small">{headerMsg}</p>}
        <div className="btn-row">
          <button type="button" className="btn btn-primary" onClick={() => void saveHeader()} disabled={headerBusy}>
            {headerBusy ? 'Сохраняю…' : 'Сохранить билет'}
          </button>
          <button type="button" className="btn" onClick={() => void generate()} disabled={generating}>
            {generating ? 'ИИ думает…' : 'Сгенерировать заново'}
          </button>
        </div>
        {generating && (
          <p className="banner banner-info">
            <span className="spinner" aria-hidden="true" />
            ИИ готовит варианты ответов… Это может занять до минуты.
          </p>
        )}
        {notice && <p className={`banner banner-${notice.tone}`}>{notice.text}</p>}
        <div className="btn-row">
          <Link className="btn btn-block" to={`/study/${id}?mode=order`}>
            Решать этот предмет
          </Link>
        </div>
      </div>

      <div className="page-head">
        <h2 className="section-title">Части ({ticket.parts.length})</h2>
        {!newForm && (
          <button type="button" className="btn btn-sm" onClick={() => { setNewForm(emptyForm()); setNewMsg(''); }}>
            + Добавить часть
          </button>
        )}
      </div>

      {ticket.parts.length === 0 && !newForm && (
        <div className="card empty">
          <p>Частей пока нет. Добавь вручную или нажми «Сгенерировать заново».</p>
        </div>
      )}

      {ticket.parts.map((part, index) => {
        const form = forms[part.id] ?? toForm(part);
        return (
          <div className="card stack" key={part.id}>
            <div className="card-head">
              <strong className="card-title">Часть {index + 1}</strong>
            </div>

            <label className="field">
              <span className="label">Название части</span>
              <input
                value={form.title}
                placeholder="Например, Определение"
                onChange={(event) => patchForm(part.id, { title: event.target.value })}
              />
            </label>

            <label className="field">
              <span className="label">Вопрос</span>
              <textarea
                value={form.question}
                rows={4}
                placeholder="Что нужно вспомнить"
                onChange={(event) => patchForm(part.id, { question: event.target.value })}
              />
            </label>

            <div className="field">
              <span className="label">Варианты ответа (отметь правильный)</span>
              <div className="option-edit-list">
                {form.options.map((option, optionIndex) => (
                  <div className="option-edit" key={`${part.id}-${optionIndex}`}>
                    <input
                      type="radio"
                      className="option-radio"
                      name={`correct-${part.id}`}
                      checked={form.correct_index === optionIndex}
                      onChange={() => patchForm(part.id, { correct_index: optionIndex })}
                      aria-label={`Вариант ${optionIndex + 1} правильный`}
                    />
                    <input
                      value={option}
                      placeholder={`Вариант ${optionIndex + 1}`}
                      onChange={(event) => {
                        const options = [...form.options];
                        options[optionIndex] = event.target.value;
                        patchForm(part.id, { options });
                      }}
                    />
                  </div>
                ))}
              </div>
              <p className="muted small">Пустые варианты не сохраняются, их можно оставить.</p>
            </div>

            <label className="field">
              <span className="label">Конспект (показывается при ошибке)</span>
              <textarea
                value={form.note}
                rows={4}
                placeholder="2–4 предложения по теме этой части"
                onChange={(event) => patchForm(part.id, { note: event.target.value })}
              />
            </label>

            {partMsg[part.id] && <p className="muted small">{partMsg[part.id]}</p>}

            <div className="btn-row">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void savePart(part.id)}
                disabled={savingId === part.id}
              >
                {savingId === part.id ? 'Сохраняю…' : 'Сохранить часть'}
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void deletePart(part)}
                disabled={deletingId === part.id}
              >
                {deletingId === part.id ? 'Удаляю…' : 'Удалить часть'}
              </button>
            </div>
          </div>
        );
      })}

      {newForm && (
        <div className="card stack new-part">
          <div className="card-head">
            <strong className="card-title">Новая часть</strong>
          </div>

          <label className="field">
            <span className="label">Название части</span>
            <input
              value={newForm.title}
              placeholder="Например, История появления"
              onChange={(event) => setNewForm({ ...newForm, title: event.target.value })}
            />
          </label>

          <label className="field">
            <span className="label">Вопрос</span>
            <textarea
              value={newForm.question}
              rows={4}
              placeholder="Что нужно вспомнить"
              onChange={(event) => setNewForm({ ...newForm, question: event.target.value })}
            />
          </label>

          <div className="field">
            <span className="label">Варианты ответа (отметь правильный)</span>
            <div className="option-edit-list">
              {newForm.options.map((option, optionIndex) => (
                <div className="option-edit" key={`new-${optionIndex}`}>
                  <input
                    type="radio"
                    className="option-radio"
                    name="correct-new"
                    checked={newForm.correct_index === optionIndex}
                    onChange={() => setNewForm({ ...newForm, correct_index: optionIndex })}
                    aria-label={`Вариант ${optionIndex + 1} правильный`}
                  />
                  <input
                    value={option}
                    placeholder={`Вариант ${optionIndex + 1}`}
                    onChange={(event) => {
                      const options = [...newForm.options];
                      options[optionIndex] = event.target.value;
                      setNewForm({ ...newForm, options });
                    }}
                  />
                </div>
              ))}
            </div>
          </div>

          <label className="field">
            <span className="label">Конспект</span>
            <textarea
              value={newForm.note}
              rows={4}
              placeholder="2–4 предложения по теме"
              onChange={(event) => setNewForm({ ...newForm, note: event.target.value })}
            />
          </label>

          {newMsg && <p className="banner banner-error">{newMsg}</p>}

          <div className="btn-row">
            <button type="button" className="btn btn-primary" onClick={() => void createPart()} disabled={newBusy}>
              {newBusy ? 'Сохраняю…' : 'Сохранить часть'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setNewForm(null);
                setNewMsg('');
              }}
              disabled={newBusy}
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
