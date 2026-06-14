import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DifficultyDots, StatusMark } from '../components/badges';
import { ProblemsHeader } from '../components/ViewToggle';
import { useI18n } from '../i18n/context';
import { useProblemsData } from '../problems/context';

export function ProblemsPage() {
  const { t } = useI18n();
  // Données partagées avec la vue arbre (chargées une seule fois par le provider) :
  // tout le filtrage de la liste se fait donc côté client, sans aller-retour réseau.
  const { problems, categories } = useProblemsData();
  const [category, setCategory] = useState('');
  const [difficulty, setDifficulty] = useState(0);
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    if (!problems) return null;
    const q = query.trim().toLowerCase();
    return problems.filter(
      (p) =>
        (!category || p.category === category) &&
        (!difficulty || p.difficulty === difficulty) &&
        (!q ||
          p.title.toLowerCase().includes(q) ||
          p.tags.some((tag) => tag.includes(q))),
    );
  }, [problems, query, category, difficulty]);

  // Compteur affiché dans l'en-tête flottant (même emplacement que l'overline
  // de l'arbre) — la bascule Arbre/Liste reste donc parfaitement immobile.
  const overline = visible
    ? `${visible.length} ${visible.length > 1 ? t.problems.count_many : t.problems.count_one}`
    : t.problems.loading;

  return (
    <div className="problems-fullscreen">
      <ProblemsHeader overline={overline} />

      <div className="problems-scroll">
        <div className="filters">
          <input
            type="search"
            className="filter-search"
            placeholder={t.problems.search_placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t.problems.all_categories}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}>
            <option value={0}>{t.problems.all_difficulties}</option>
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>
                {t.difficulty[d]}
              </option>
            ))}
          </select>
        </div>

        {!visible ? (
          <p className="mono-label">{t.problems.loading}</p>
        ) : visible.length === 0 ? (
          <p className="empty-state">{t.problems.empty}</p>
        ) : (
          <div className="problem-list">
            <div className="problem-list-head" aria-hidden="true">
              <span />
              <span className="mono-label">{t.problems.th_title}</span>
              <span className="mono-label">{t.problems.th_category}</span>
              <span className="mono-label">{t.problems.th_difficulty}</span>
            </div>
            {visible.map((p) => (
              <Link
                key={p.slug}
                to={`/problems/${p.slug}`}
                className={`problem-row${p.solved ? ' is-solved' : ''}`}
              >
                <span className="problem-row-status">
                  <StatusMark solved={p.solved} attempted={p.attempted} />
                </span>
                <span className="problem-row-main">
                  <span className="problem-row-title">{p.title}</span>
                  {p.tags.length > 0 && (
                    <span className="tag-list">
                      {p.tags.map((tag) => (
                        <span key={tag} className="chip">
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <span className="problem-row-category">{p.category}</span>
                <span className="problem-row-difficulty">
                  <DifficultyDots level={p.difficulty} />
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
