import { Fragment, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import type { ArticleDetail } from '../api';
import { Markdown } from '../components/Markdown';
import { TpBlock } from '../components/TpBlock';
import { DifficultyDots, StatusMark } from '../components/badges';
import { useI18n } from '../i18n/context';
import 'katex/dist/katex.min.css';

/* Même syntaxe que le loader backend : un fence ```tp contenant un slug. */
const TP_BLOCK_RE = /^```tp\s*\n\s*([a-z0-9-]+)\s*\n```\s*$/gm;

type Segment = { kind: 'md'; text: string } | { kind: 'tp'; slug: string };

function splitBody(body: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  for (const match of body.matchAll(TP_BLOCK_RE)) {
    const before = body.slice(last, match.index).trim();
    if (before) segments.push({ kind: 'md', text: before });
    segments.push({ kind: 'tp', slug: match[1] });
    last = match.index + match[0].length;
  }
  const rest = body.slice(last).trim();
  if (rest) segments.push({ kind: 'md', text: rest });
  return segments;
}

export function ArticlePage() {
  const { slug = '', articleSlug = '' } = useParams();
  // key force un remontage propre quand on navigue entre deux articles.
  return <ArticleView key={`${slug}/${articleSlug}`} slug={slug} articleSlug={articleSlug} />;
}

function ArticleView({ slug, articleSlug }: { slug: string; articleSlug: string }) {
  const { t, lang } = useI18n();
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api
      .article(slug, articleSlug)
      .then(setArticle)
      .catch(() => setNotFound(true));
  }, [slug, articleSlug]);

  async function markRead() {
    if (!article || article.read) return;
    try {
      await api.markArticleRead(slug, articleSlug);
      setArticle({ ...article, read: true });
    } catch {
      // sans gravité : l'utilisateur pourra re-cliquer
    }
  }

  if (notFound) {
    return (
      <p className="empty-state">
        404 — <Link to="/courses">{t.courses.back}</Link>
      </p>
    );
  }
  if (!article) return <p className="mono-label">{t.courses.loading}</p>;

  const body = lang === 'en' && article.body_en ? article.body_en : article.body_fr;
  const title = lang === 'en' && article.title_en ? article.title_en : article.title_fr;
  const showFallbackNote = lang === 'en' && !article.body_en;

  return (
    <div className="article-page">
      <nav className="breadcrumb">
        <Link to="/courses">{t.courses.back}</Link>
        {' / '}
        <Link to={`/courses/${article.course_slug}`}>{article.course_title}</Link>
      </nav>

      {/* `statement` donne la typographie Markdown commune aux énoncés. */}
      <article className="statement article-body">
        <header className="page-head">
          <p className="overline mono-label">{article.course_title}</p>
          <h1>
            {title}
            {article.read && <span className="solved-badge">✓ {t.courses.read_badge}</span>}
          </h1>
        </header>

        {showFallbackNote && <p className="mono-label">{t.courses.fallback_fr}</p>}

        {splitBody(body).map((segment, i) => (
          <Fragment key={i}>
            {segment.kind === 'md' ? (
              <Markdown>{segment.text}</Markdown>
            ) : (
              <TpBlock slug={segment.slug} />
            )}
          </Fragment>
        ))}

        {article.practice.length > 0 && (
          <section className="practice-panel">
            <h2 className="mono-label">{t.courses.practice_title}</h2>
            <ul className="practice-list">
              {article.practice.map((p) => (
                <li key={p.slug}>
                  <Link to={`/problems/${p.slug}`} className="practice-row">
                    <StatusMark solved={p.solved} attempted={false} />
                    <span className="practice-title">{p.title}</span>
                    <DifficultyDots level={p.difficulty} />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="article-footer">
          <button
            className={`btn ${article.read ? 'btn-ghost' : 'btn-primary'}`}
            onClick={markRead}
            disabled={article.read}
          >
            {article.read ? `✓ ${t.courses.read_badge}` : t.courses.mark_read}
          </button>

          <nav className="article-nav">
            {article.prev && (
              <Link
                className="article-nav-link prev"
                to={`/courses/${article.course_slug}/${article.prev.slug}`}
              >
                ← {lang === 'en' && article.prev.title_en
                  ? article.prev.title_en
                  : article.prev.title_fr}
              </Link>
            )}
            {article.next && (
              <Link
                className="article-nav-link next"
                to={`/courses/${article.course_slug}/${article.next.slug}`}
              >
                {lang === 'en' && article.next.title_en
                  ? article.next.title_en
                  : article.next.title_fr}{' '}
                →
              </Link>
            )}
          </nav>
        </footer>
      </article>
    </div>
  );
}
