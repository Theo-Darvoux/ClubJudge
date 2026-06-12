import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/context';
import { useI18n } from '../i18n/context';

export function Layout() {
  const { t, lang, setLang } = useI18n();
  const { user, logout } = useAuth();

  return (
    <>
      <header className="app-nav">
        <div className="container app-nav-inner">
          <NavLink to="/problems" className="brand">
            <img src="/img/mark.svg" alt="" width={26} height={15} />
            <span>
              Club<span className="accent">Judge</span>
            </span>
          </NavLink>

          <nav className="nav-links" aria-label="Sections">
            <NavLink to="/problems" className="nav-link">
              {t.nav.problems}
            </NavLink>
            <span className="nav-link is-disabled">
              {t.nav.contests}
              <span className="soon-chip">{t.nav.soon}</span>
            </span>
            <span className="nav-link is-disabled">
              {t.nav.courses}
              <span className="soon-chip">{t.nav.soon}</span>
            </span>
          </nav>

          <div className="nav-side">
            <button
              className="nav-ghost-btn"
              onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')}
              title={t.lang.switch}
            >
              {lang === 'fr' ? 'EN' : 'FR'}
            </button>
            {user && (
              <>
                <span className="nav-user" title={user.email}>
                  {user.display_name}
                </span>
                <button className="nav-ghost-btn" onClick={logout}>
                  {t.nav.logout}
                </button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="container app-main">
        <Outlet />
      </main>
    </>
  );
}
