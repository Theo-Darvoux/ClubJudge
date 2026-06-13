import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import type { CourseDetail } from '../api';
import { useI18n } from '../i18n/context';

export function CoursePage() {
  const { slug = '' } = useParams();
  const { t, lang } = useI18n();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    api
      .course(slug)
      .then(setCourse)
      .catch(() => setNotFound(true));
  }, [slug]);

  if (notFound) {
    return (
      <p className="empty-state">
        404 — <Link to="/courses">{t.courses.back}</Link>
      </p>
    );
  }
  if (!course) return <p className="mono-label">{t.courses.loading}</p>;

  // L'article à ouvrir « pour continuer » : le premier non lu.
  const nextUp = course.articles.find((a) => !a.read);

  return (
    <div className="course-page">
      <nav className="breadcrumb">
        <Link to="/courses">{t.courses.back}</Link>
      </nav>

      <header className="page-head">
        <p className="overline mono-label">{course.category}</p>
        <h1>{course.title}</h1>
        {course.description && <p className="course-desc">{course.description}</p>}
        <p className="mono-label course-head-progress">
          {t.courses.read_progress(course.read_count, course.article_count)}
          {course.tp_total > 0 && (
            <> · {t.courses.tp_progress(course.tp_solved, course.tp_total)}</>
          )}
        </p>
      </header>

      <ol className="article-list">
        {course.articles.map((article, i) => (
          <li key={article.slug}>
            <Link
              to={`/courses/${course.slug}/${article.slug}`}
              className={`article-row${article.read ? ' is-read' : ''}`}
            >
              <span className="article-index mono-label">
                {String(i + 1).padStart(2, '0')}
              </span>
              <span className="article-title">
                {lang === 'en' && article.title_en ? article.title_en : article.title_fr}
              </span>
              {article.tp_total > 0 && (
                <span className="mono-label article-tp">
                  {t.courses.tp_progress(article.tp_solved, article.tp_total)}
                </span>
              )}
              {article.read ? (
                <span className="solved-badge">✓ {t.courses.read_badge}</span>
              ) : (
                article === nextUp && (
                  <span className="chip next-chip">{t.courses.continue_here}</span>
                )
              )}
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
