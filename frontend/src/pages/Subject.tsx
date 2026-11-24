import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { aiStatusText, aiStatusTone, api, errorText } from '../api';
import type { AiStatus, Subject as SubjectType, Ticket, TicketWithAi } from '../types';

type AiNotice = {
  status: AiStatus;
  text: string;
  ticketId: string;
};

export default function Subject() {
  const { id = '' } = useParams();
  const [subject, setSubject] = useState<SubjectType | null>(null);
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState('');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<AiNotice | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [list, ticketList] = await Promise.all([
        api<SubjectType[]>('/api/subjects'),
        api<Ticket[]>(`/api/subjects/${id}/tickets`),
      ]);
      setSubject(list.find((item) => item.id === id) ?? null);
      setTickets(ticketList);
    } catch (caught) {
      setTickets([]);
      setError(errorText(caught));
    }
  }, [id]);

  useEffect(() => {
    setTickets(null);
    setSubject(null);
    void load();
  }, [load]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    const cleanQuestion = question.trim();
    if (!cleanTitle) {
      setFormError('Напиши название билета.');
      return;
    }
    if (!cleanQuestion) {
      setFormError('Напиши полный текст вопроса.');
      return;
    }
    setBusy(true);
    setFormError('');
    setNotice(null);
    try {
      const created = await api<TicketWithAi>('/api/tickets', {
        method: 'POST',
        body: { subject_id: id, title: cleanTitle, question: cleanQuestion },
      });
      setNotice({
        status: created.ai_status,
        text: aiStatusText(created.ai_status, created.ai_error),
        ticketId: created.id,
      });
      setTitle('');
      setQuestion('');
      setFormOpen(false);
      await load();
    } catch (caught) {
      setFormError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (ticket: Ticket) => {
    const agreed = window.confirm(`Удалить билет «${ticket.title}»? Его части тоже удалятся.`);
    if (!agreed) return;
    try {
      await api(`/api/tickets/${ticket.id}`, { method: 'DELETE' });
      await load();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <div className="stack">
      <div className="crumbs">
        <Link to="/">← Мои предметы</Link>
      </div>

      <div className="page-head">
        <h1 className="page-title">{subject ? subject.name : 'Предмет'}</h1>
        {!formOpen && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setFormOpen(true);
              setFormError('');
            }}
          >
            + Добавить билет
          </button>
        )}
      </div>

      {!subject && tickets !== null && !error && (
        <p className="banner banner-warn">Предмет не найден. Возможно, его удалили.</p>
      )}

      {formOpen && (
        <form className="card stack" onSubmit={create}>
          <h2 className="card-title">Новый билет</h2>
          <label className="field">
            <span className="label">Название</span>
            <input
              value={title}
              autoFocus
              placeholder="Например, Билет 3. Рынок и спрос"
              onChange={(event) => setTitle(event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="field">
            <span className="label">Полный текст вопроса</span>
            <textarea
              value={question}
              rows={6}
              placeholder="Вставь вопрос целиком — ИИ сам разобьёт его на части"
              onChange={(event) => setQuestion(event.target.value)}
              disabled={busy}
            />
          </label>
          {formError && <p className="banner banner-error">{formError}</p>}
          {busy && (
            <p className="banner banner-info">
              <span className="spinner" aria-hidden="true" />
              ИИ готовит варианты ответов… Обычно это 5–60 секунд, страницу не закрывай.
            </p>
          )}
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Сохраняю…' : 'Сохранить билет'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                setFormOpen(false);
                setTitle('');
                setQuestion('');
                setFormError('');
              }}
            >
              Отмена
            </button>
          </div>
        </form>
      )}

      {notice && (
        <div className={`banner banner-${aiStatusTone(notice.status)}`}>
          <span>{notice.text}</span>
          {notice.status !== 'ok' && (
            <Link className="btn btn-sm btn-ghost" to={`/subject/${id}/ticket/${notice.ticketId}`}>
              Заполнить вручную
            </Link>
          )}
        </div>
      )}

      {error && (
        <div className="banner banner-error">
          <span>{error}</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      )}

      {tickets === null && <p className="muted">Загружаю билеты…</p>}

      {tickets !== null && tickets.length === 0 && !error && (
        <div className="card empty">
          <p>Билетов пока нет. Добавь первый — ИИ сразу придумает варианты ответов.</p>
        </div>
      )}

      {tickets !== null &&
        tickets.map((ticket, index) => (
          <div className="card" key={ticket.id}>
            <div className="card-head">
              <strong className="card-title">
                {index + 1}. {ticket.title}
              </strong>
              <span className="muted small">частей: {ticket.parts.length}</span>
            </div>
            {ticket.question && <p className="ticket-question">{ticket.question}</p>}
            <div className="btn-row">
              <Link className="btn btn-primary" to={`/study/${id}?mode=order`}>
                Решать
              </Link>
              <Link className="btn" to={`/subject/${id}/ticket/${ticket.id}`}>
                Изменить
              </Link>
              <button type="button" className="btn btn-danger" onClick={() => void remove(ticket)}>
                Удалить
              </button>
            </div>
          </div>
        ))}
    </div>
  );
}
