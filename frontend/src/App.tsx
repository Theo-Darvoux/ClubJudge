import { useEffect, useState } from 'react';
import { fetchHealth } from './api';
import { useI18n } from './i18n/context';

type ApiState = 'checking' | 'ok' | 'down';

export default function App() {
  const { t, lang, setLang } = useI18n();
  const [apiState, setApiState] = useState<ApiState>('checking');

  useEffect(() => {
    document.title = t.meta.title;
  }, [t]);

  useEffect(() => {
    fetchHealth()
      .then(() => setApiState('ok'))
      .catch(() => setApiState('down'));
  }, []);

  const apiLabel = {
    checking: t.home.api_checking,
    ok: t.home.api_ok,
    down: t.home.api_down,
  }[apiState];

  return (
    <main className="container" style={{ paddingBlock: '6rem', maxWidth: '44rem' }}>
      <img src="/img/mark.svg" alt="" width={120} style={{ marginBottom: '2.5rem' }} />
      <p className="mono-label" style={{ marginBottom: '1.2rem' }}>
        {t.home.overline}
      </p>
      <h1 style={{ fontSize: 'clamp(2.4rem, 6vw, 4rem)', marginBottom: '1.2rem' }}>
        {t.home.title_pre}
        <span className="accent">{t.home.title_accent}</span>
      </h1>
      <p style={{ color: 'var(--ink-soft)', marginBottom: '2.5rem' }}>{t.home.sub}</p>

      <div className="panel" style={{ marginBottom: '2.5rem' }}>
        <div className="panel-inner" style={{ display: 'flex', gap: '0.8rem', alignItems: 'baseline' }}>
          <span className="mono-label">{t.home.api_status}</span>
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              color:
                apiState === 'ok'
                  ? 'var(--verdict-ac)'
                  : apiState === 'down'
                    ? 'var(--verdict-wa)'
                    : 'var(--ink-dim)',
            }}
          >
            {apiLabel}
          </span>
        </div>
      </div>

      <button className="btn btn-ghost" onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}>
        {t.lang.switch}
      </button>
    </main>
  );
}
