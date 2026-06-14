import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/context';
import { useI18n } from '../i18n/context';

export function Layout() {
  const { t, lang, setLang } = useI18n();
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  // Les deux vues de la section Problèmes (arbre /problems, liste /problems/list)
  // sont plein écran : on retire le conteneur centré et les marges du <main>
  // pour leur laisser tout l'espace. Les pages problème (/problems/:slug) non.
  const bleed = pathname === '/problems' || pathname === '/problems/list';

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
            <NavLink to="/contests" className="nav-link">
              {t.nav.contests}
            </NavLink>
            <NavLink to="/courses" className="nav-link">
              {t.nav.courses}
            </NavLink>
            {user?.role === 'admin' && (
              <NavLink to="/admin" className="nav-link">
                {t.admin.nav}
              </NavLink>
            )}
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
      <main className={bleed ? 'app-main app-main--bleed' : 'container app-main'}>
        <Outlet />
      </main>
    </>
  );
}
