import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api, errorText } from '../api';

type Props = {
  onSuccess: () => void;
};

export default function Login({ onSuccess }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!password) {
      setError('Введи пароль.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/login', {
        method: 'POST',
        body: { password },
        redirectOn401: false,
      });
      onSuccess();
      navigate('/', { replace: true });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setError('Пароль неверный.');
      } else {
        setError(errorText(caught));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen-center">
      <div className="card login-card">
        <h1 className="page-title">Тренажёр к сессии</h1>
        <p className="muted login-hint">Введи пароль, чтобы продолжить.</p>
        <form className="stack" onSubmit={submit}>
          <label className="field">
            <span className="label">Пароль</span>
            <input
              type="password"
              value={password}
              autoComplete="current-password"
              autoFocus
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Пароль"
            />
          </label>
          {error && <p className="banner banner-error">{error}</p>}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Вхожу…' : 'Войти'}
          </button>
        </form>
      </div>
    </div>
  );
}
