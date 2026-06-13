import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { CourseSummary } from '../api';
import { useI18n } from '../i18n/context';

export function CoursesPage() {
  const { t } = useI18n();
  const [courses, setCourses] = useState<CourseSummary[] | null>(null);

  useEffect(() => {
    api.courses().then(setCourses).catch(() => setCourses([]));
  }, []);

  if (courses === null) return <p className="mono-label">{t.courses.loading}</p>;

  // L'API renvoie trié par catégorie : on regroupe en sections.
  const categories = [...new Set(courses.map((c) => c.category))];

  return (
    <div className="courses-page">
      <header className="page-head">
        <p className="overline mono-label">{t.courses.overline}</p>
        <h1>{t.courses.title}</h1>
      </header>

      {courses.length === 0 && <p className="empty-state">{t.courses.empty}</p>}

      {categories.map((category) => (
        <section key={category} className="course-category">
          <h2 className="mono-label category-label">{category}</h2>
          <div className="course-grid">
            {courses
              .filter((c) => c.category === category)
              .map((course) => {
                const done = course.article_count > 0 && course.read_count === course.article_count;
                return (
                  <Link
                    key={course.slug}
                    to={`/courses/${course.slug}`}
                    className="panel course-card"
                  >
                    <div className="panel-inner">
                      <h3>
                        {course.title}
                        {done && <span className="solved-badge">✓</span>}
                      </h3>
                      {course.description && <p className="course-desc">{course.description}</p>}
                      <div className="course-progress">
                        <span className="mono-label">
                          {t.courses.read_progress(course.read_count, course.article_count)}
                        </span>
                        {course.tp_total > 0 && (
                          <span className="mono-label">
                            {t.courses.tp_progress(course.tp_solved, course.tp_total)}
                          </span>
                        )}
                      </div>
                      <div
                        className="progress-track"
                        role="progressbar"
                        aria-valuenow={course.read_count}
                        aria-valuemax={course.article_count}
                      >
                        <div
                          className="progress-fill"
                          style={{
                            width: `${(course.read_count / Math.max(course.article_count, 1)) * 100}%`,
                          }}
                        />
                      </div>
                    </div>
                  </Link>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
