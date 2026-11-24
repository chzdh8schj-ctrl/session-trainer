import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, errorText } from '../api';
import type { Subject } from '../types';

export default function Subjects() {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      setSubjects(await api<Subject[]>('/api/subjects'));
    } catch (caught) {
      setSubjects([]);
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setFormError('Напиши название предмета.');
      return;
    }
    setBusy(true);
    setFormError('');
    try {
      await api<Subject>('/api/subjects', { method: 'POST', body: { name: trimmed } });
      setName('');
      setFormOpen(false);
      await load();
    } catch (caught) {
      setFormError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (subject: Subject) => {
    const agreed = window.confirm(
      `Удалить предмет «${subject.name}»? Все его билеты и части тоже удалятся.`,
    );
    if (!agreed) return;
    try {
      await api(`/api/subjects/${subject.id}`, { method: 'DELETE' });
      await load();
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <h1 className="page-title">Мои предметы</h1>
        {!formOpen && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setFormOpen(true);
              setFormError('');
            }}
          >
            + Добавить предмет
          </button>
        )}
      </div>

      {formOpen && (
        <form className="card stack" onSubmit={create}>
          <h2 className="card-title">Новый предмет</h2>
          <label className="field">
            <span className="label">Название</span>
            <input
              value={name}
              autoFocus
              placeholder="Например, Экономика"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          {formError && <p className="banner banner-error">{formError}</p>}
          <div className="btn-row">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Создаю…' : 'Создать'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                setFormOpen(false);
                setName('');
                setFormError('');
              }}
            >
              Отмена
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="banner banner-error">
          <span>{error}</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => void load()}>
            Повторить
          </button>
        </div>
      )}

      {subjects === null && <p className="muted">Загружаю предметы…</p>}

      {subjects !== null && subjects.length === 0 && !error && (
        <div className="card empty">
          <p>Пока пусто. Добавь первый предмет.</p>
        </div>
      )}

      {subjects !== null &&
        subjects.map((subject) => (
          <div className="card" key={subject.id}>
            <div className="card-head">
              <strong className="card-title">{subject.name}</strong>
              <span className="muted small">
                билетов: {subject.tickets_count} · частей: {subject.parts_count}
              </span>
            </div>
            <div className="btn-row">
              <Link className="btn btn-primary" to={`/subject/${subject.id}`}>
                Открыть
              </Link>
              <Link className="btn" to={`/study/${subject.id}?mode=order`}>
                По порядку
              </Link>
              <Link className="btn" to={`/study/${subject.id}?mode=random`}>
                Случайно
              </Link>
              <button type="button" className="btn btn-danger" onClick={() => void remove(subject)}>
                Удалить
              </button>
            </div>
          </div>
        ))}
    </div>
  );
}
