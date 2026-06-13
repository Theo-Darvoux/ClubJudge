import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { ProblemDetail } from '../api';
import { useI18n } from '../i18n/context';
import { DifficultyDots } from './badges';
import { Markdown } from './Markdown';
import { Workbench } from './Workbench';

/* Bloc TP d'un article de cours (fence ```tp dans le Markdown) : le problème
   lié, énoncé + éditeur + juge, sans quitter l'article. Le code écrit ici est
   partagé avec la page du problème (même localStorage). */
export function TpBlock({ slug }: { slug: string }) {
  const { t, lang } = useI18n();
  const [problem, setProblem] = useState<ProblemDetail | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    api
      .problem(slug)
      .then(setProblem)
      .catch(() => setUnavailable(true));
  }, [slug]);

  if (unavailable) {
    // Problème caché (rattaché à un contest non terminé) ou retiré.
    return (
      <aside className="tp-block tp-unavailable">
        <span className="mono-label">{t.courses.tp_label}</span>
        <p className="empty-state">{t.courses.tp_unavailable}</p>
      </aside>
    );
  }
  if (!problem) {
    return (
      <aside className="tp-block">
        <span className="mono-label">{t.courses.tp_label}</span>
        <p className="mono-label">{t.problems.loading}</p>
      </aside>
    );
  }

  const statement =
    lang === 'en' && problem.statement_en ? problem.statement_en : problem.statement_fr;

  return (
    <aside className={`tp-block${problem.solved ? ' is-solved' : ''}`}>
      <header className="tp-head">
        <span className="mono-label tp-chip">{t.courses.tp_label}</span>
        <h3 className="tp-title">{problem.title}</h3>
        <DifficultyDots level={problem.difficulty} />
        {problem.solved && (
          <span className="solved-badge" title={t.problems.solved}>
            ✓ {t.problems.solved}
          </span>
        )}
        <Link className="tp-open-link" to={`/problems/${problem.slug}`}>
          {t.courses.tp_open_problem}
        </Link>
      </header>

      <details className="tp-statement" open={!problem.solved}>
        <summary className="mono-label">{t.problem.tabs.statement}</summary>
        <div className="tp-statement-body">
          <Markdown>{statement}</Markdown>
        </div>
      </details>

      <Workbench
        slug={problem.slug}
        height="300px"
        showHistory={false}
        onSolved={() => setProblem((p) => (p ? { ...p, solved: true } : p))}
      />
    </aside>
  );
}
