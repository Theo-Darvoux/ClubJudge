import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../api';
import { useAuth } from '../auth/context';
import { useI18n } from '../i18n/context';

export function AuthPage() {
  const { t, lang, setLang } = useI18n();
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const from = (location.state as { from?: string } | null)?.from ?? '/problems';

  if (user) return <Navigate to={from} replace />;

  const switchMode = (next: 'login' | 'register') => {
    setMode(next);
    setError(null);
  };

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password, displayName);
      }
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'bad_credentials') setError(t.auth.errors.bad_credentials);
        else if (err.code === 'email_taken') setError(t.auth.errors.email_taken);
        else setError(t.auth.errors.invalid);
      } else {
        setError(t.auth.errors.network);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <button
        className="nav-ghost-btn auth-lang"
        onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
      >
        {lang === 'fr' ? 'EN' : 'FR'}
      </button>

      <div className="auth-card panel">
        <div className="panel-inner">
          <img src="/img/mark.svg" alt="" width={64} className="auth-mark" />
          <p className="mono-label">{t.auth.overline}</p>
          <h1 className="auth-title">
            {mode === 'login' ? t.auth.login_title : t.auth.register_title}
          </h1>

          <form onSubmit={onSubmit} className="auth-form">
            {mode === 'register' && (
              <label className="field">
                <span className="field-label">
                  {t.auth.display_name}
                  <small> — {t.auth.display_name_hint}</small>
                </span>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={64}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  autoComplete="nickname"
                />
              </label>
            )}
            <label className="field">
              <span className="field-label">{t.auth.email}</span>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
            <label className="field">
              <span className="field-label">
                {t.auth.password}
                {mode === 'register' && <small> — {t.auth.password_hint}</small>}
              </span>
              <input
                type="password"
                required
                minLength={mode === 'register' ? 8 : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </label>

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <button className="btn btn-primary auth-submit" disabled={busy}>
              {mode === 'login' ? t.auth.login_submit : t.auth.register_submit}
            </button>
          </form>

          <button
            className="auth-switch"
            onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? t.auth.to_register : t.auth.to_login}
          </button>
        </div>
      </div>
    </div>
  );
}
