import { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom';
import { api } from './api';
import Admin from './pages/Admin';
import Login from './pages/Login';
import Study from './pages/Study';
import Subject from './pages/Subject';
import Subjects from './pages/Subjects';
import TicketEditor from './pages/TicketEditor';

type AuthState = 'checking' | 'in' | 'out';

function NotFound() {
  return (
    <div className="card">
      <h1 className="page-title">Страница не найдена</h1>
      <p className="muted">Такого адреса нет.</p>
      <Link className="btn btn-primary btn-block" to="/">
        К предметам
      </Link>
    </div>
  );
}

function Shell() {
  const [auth, setAuth] = useState<AuthState>('checking');
  const [loggingOut, setLoggingOut] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    api<{ ok: boolean }>('/api/auth/me', { redirectOn401: false })
      .then(() => {
        if (alive) setAuth('in');
      })
      .catch(() => {
        if (alive) setAuth('out');
      });
    return () => {
      alive = false;
    };
  }, []);

  const logout = async () => {
    setLoggingOut(true);
    try {
      await api('/api/auth/logout', { method: 'POST', redirectOn401: false });
    } catch {
      // сервер мог не ответить — всё равно уводим на вход
    }
    setLoggingOut(false);
    setAuth('out');
    navigate('/login', { replace: true });
  };

  if (auth === 'checking') {
    return (
      <div className="screen-center">
        <p className="muted">Проверяем вход…</p>
      </div>
    );
  }

  if (auth === 'out') {
    return (
      <Routes>
        <Route path="/login" element={<Login onSuccess={() => setAuth('in')} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <NavLink to="/" className="brand">
            Тренажёр к сессии
          </NavLink>
          <div className="header-actions">
            <NavLink to="/admin" className="btn btn-ghost btn-sm">
              Журнал ИИ
            </NavLink>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={logout}
              disabled={loggingOut}
            >
              Выйти
            </button>
          </div>
        </div>
      </header>
      <main className="main">
        <Routes>
          <Route path="/" element={<Subjects />} />
          <Route path="/subject/:id" element={<Subject />} />
          <Route path="/subject/:id/ticket/:ticketId" element={<TicketEditor />} />
          <Route path="/study/:id" element={<Study />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  );
}
