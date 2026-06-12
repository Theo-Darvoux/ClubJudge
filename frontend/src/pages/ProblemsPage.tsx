import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { ProblemSummary } from '../api';
import { DifficultyDots, StatusMark } from '../components/badges';
import { useI18n } from '../i18n/context';

export function ProblemsPage() {
  const { t } = useI18n();
  const [problems, setProblems] = useState<ProblemSummary[] | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [difficulty, setDifficulty] = useState(0);
  const [query, setQuery] = useState('');

  useEffect(() => {
    api.categories().then(setCategories).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .problems({ category: category || undefined, difficulty: difficulty || undefined })
      .then((list) => {
        if (!cancelled) setProblems(list);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [category, difficulty]);

  const visible = useMemo(() => {
    if (!problems) return null;
    const q = query.trim().toLowerCase();
    if (!q) return problems;
    return problems.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.tags.some((tag) => tag.includes(q)),
    );
  }, [problems, query]);

  return (
    <div className="problems-page">
      <header className="page-head">
        <h1>{t.problems.title}</h1>
        {visible && (
          <span className="mono-label">
            {visible.length} {visible.length > 1 ? t.problems.count_many : t.problems.count_one}
          </span>
        )}
      </header>

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
        <table className="problem-table">
          <thead>
            <tr>
              <th className="col-status" aria-label={t.problems.th_status} />
              <th>{t.problems.th_title}</th>
              <th className="col-category">{t.problems.th_category}</th>
              <th className="col-difficulty">{t.problems.th_difficulty}</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p) => (
              <tr key={p.slug}>
                <td className="col-status">
                  <StatusMark solved={p.solved} attempted={p.attempted} />
                </td>
                <td>
                  <Link className="problem-link" to={`/problems/${p.slug}`}>
                    {p.title}
                  </Link>
                  <span className="tag-list">
                    {p.tags.map((tag) => (
                      <span key={tag} className="chip">
                        {tag}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="col-category">{p.category}</td>
                <td className="col-difficulty">
                  <DifficultyDots level={p.difficulty} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
