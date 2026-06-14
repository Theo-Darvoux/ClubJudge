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

/**
 * En-tête flottant partagé par les deux vues de la section Problèmes. Ancré au
 * même point (haut-gauche, position fixe) dans l'arbre et la liste : la bascule
 * Arbre/Liste ne bouge plus d'un pixel d'une vue à l'autre.
 */
export function ProblemsHeader({ overline }: { overline: string }) {
  const { t } = useI18n();
  return (
    <header className="problems-head floating">
      <div className="problems-head-titles">
        <p className="mono-label">{overline}</p>
        <h1>{t.skills.title}</h1>
      </div>
      <ViewToggle />
    </header>
  );
}
