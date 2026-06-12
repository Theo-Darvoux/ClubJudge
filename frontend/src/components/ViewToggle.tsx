import { NavLink } from 'react-router-dom';
import { useI18n } from '../i18n/context';

/** Bascule arbre/liste de la section Problèmes — mêmes données, deux vues. */
export function ViewToggle() {
  const { t } = useI18n();
  return (
    <nav className="view-toggle" aria-label={t.nav.problems}>
      <NavLink to="/problems" end className="view-toggle-btn">
        <span aria-hidden="true">⬡</span> {t.skills.view_tree}
      </NavLink>
      <NavLink to="/problems/list" className="view-toggle-btn">
        <span aria-hidden="true">≡</span> {t.skills.view_list}
      </NavLink>
    </nav>
  );
}
