import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, errorText } from '../api';
import type { AnswerResult, Ticket } from '../types';

function shuffle<T>(input: T[]): T[] {
  const items = [...input];
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

export default function Study() {
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  const random = searchParams.get('mode') === 'random';

  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [error, setError] = useState('');
  const [ticketIndex, setTicketIndex] = useState(0);
  const [partIndex, setPartIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [result, setResult] = useState<AnswerResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [answerError, setAnswerError] = useState('');
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let alive = true;
    setTickets(null);
    setError('');
    setFinished(false);
    setTicketIndex(0);
    setPartIndex(0);
    setSelected(null);
    setResult(null);
    setAnswerError('');

    api<Ticket[]>(`/api/subjects/${id}/tickets`)
      .then((list) => {
        if (!alive) return;
        setTickets(random ? shuffle(list) : list);
      })
      .catch((caught: unknown) => {
        if (!alive) return;
        setTickets([]);
        setError(errorText(caught));
      });

    return () => {
      alive = false;
    };
  }, [id, random]);

  const ticket = tickets && tickets[ticketIndex] ? tickets[ticketIndex] : null;
  const parts = ticket ? ticket.parts : [];
  const part = parts[partIndex] ?? null;
  const isLastPart = partIndex + 1 >= parts.length;

  const nextTicket = () => {
    setSelected(null);
    setResult(null);
    setAnswerError('');
    setPartIndex(0);
    if (tickets && ticketIndex + 1 < tickets.length) {
      setTicketIndex(ticketIndex + 1);
    } else {
      setFinished(true);
    }
  };

  const goNext = () => {
    if (partIndex + 1 < parts.length) {
      setSelected(null);
      setResult(null);
      setAnswerError('');
      setPartIndex(partIndex + 1);
      return;
    }
    nextTicket();
  };

  const choose = async (index: number) => {
    if (!part || result || checking) return;
    setSelected(index);
    setChecking(true);
    setAnswerError('');
    try {
      const answer = await api<AnswerResult>(`/api/parts/${part.id}/answer`, {
        method: 'POST',
        body: { chosen_index: index },
      });
      setResult(answer);
    } catch (caught) {
      setSelected(null);
      setAnswerError(errorText(caught));
    } finally {
      setChecking(false);
    }
  };

  if (error) {
    return (
      <div className="stack">
        <div className="banner banner-error">
          <span>{error}</span>
          <Link className="btn btn-sm btn-ghost" to={`/subject/${id}`}>
            К предмету
          </Link>
        </div>
      </div>
    );
  }

  if (tickets === null) {
    return <p className="muted">Загружаю билеты…</p>;
  }

  if (tickets.length === 0) {
    return (
      <div className="stack">
        <div className="card empty">
          <p>В этом предмете пока нет билетов.</p>
          <Link className="btn btn-primary btn-block" to={`/subject/${id}`}>
            К предмету
          </Link>
        </div>
      </div>
    );
  }

  if (finished || !ticket) {
    return (
      <div className="stack">
        <div className="card empty">
          <h1 className="page-title">Билеты закончились!</h1>
          <p className="muted">Круто, что дошла до конца.</p>
          <Link className="btn btn-primary btn-block" to={`/subject/${id}`}>
            К предмету
          </Link>
        </div>
      </div>
    );
  }

  const progress = Math.round(((ticketIndex + (parts.length ? partIndex / parts.length : 0)) / tickets.length) * 100);

  return (
    <div className="stack">
      <div className="study-head">
        <div className="study-progress">
          <span className="muted small">
            Билет {ticketIndex + 1} из {tickets.length}
            {random ? ' · в случайном порядке' : ''}
          </span>
          <div className="progress" role="presentation">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <h1 className="page-title">{ticket.title}</h1>
        {ticket.question && <p className="ticket-question ticket-question-study">{ticket.question}</p>}
      </div>

      {parts.length === 0 && (
        <div className="card stack">
          <p className="banner banner-warn">В этом билете нет частей — нечего решать.</p>
          <p className="muted small">Части можно добавить в редакторе билета.</p>
          <button type="button" className="btn btn-primary btn-block" onClick={nextTicket}>
            Дальше
          </button>
        </div>
      )}

      {part && (
        <div className="card stack">
          <div className="muted small">Часть {partIndex + 1} из {parts.length}</div>
          {part.title && <h2 className="part-title">{part.title}</h2>}
          {part.question && <p className="part-question">{part.question}</p>}

          {part.options.length === 0 ? (
            <>
              <p className="banner banner-warn">В этой части нет вариантов ответа. Допиши их в редакторе билета.</p>
              <button type="button" className="btn btn-primary btn-block" onClick={goNext}>
                {isLastPart ? 'Дальше' : 'Продолжить'}
              </button>
            </>
          ) : (
            <>
              <div className="options">
                {part.options.map((option, index) => {
                  const answered = result !== null;
                  const classes = ['opt'];
                  if (answered) {
                    if (index === result.correct_index) classes.push('opt-correct');
                    else if (index === selected) classes.push('opt-wrong');
                    else classes.push('opt-dim');
                  }
                  return (
                    <button
                      key={`${part.id}-${index}`}
                      type="button"
                      className={classes.join(' ')}
                      disabled={answered || checking}
                      onClick={() => void choose(index)}
                    >
                      <span className="opt-index">{index + 1}</span>
                      <span>{option || `Вариант ${index + 1}`}</span>
                    </button>
                  );
                })}
              </div>

              {checking && <p className="muted small">Проверяю…</p>}
              {answerError && <p className="banner banner-error">{answerError}</p>}

              {result && result.correct && <p className="banner banner-ok">Верно!</p>}

              {result && !result.correct && (
                <div className="note">
                  <div className="note-title">Конспект</div>
                  <p>{result.note?.trim() || part.note?.trim() || 'Конспект к этой части пока не заполнен.'}</p>
                </div>
              )}

              {result && (
                <button type="button" className="btn btn-primary btn-block" onClick={goNext}>
                  {isLastPart ? 'Дальше' : 'Продолжить'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
