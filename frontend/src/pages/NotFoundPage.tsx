import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/context';

export function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div className="empty-state-container">
      <h1>404</h1>
      <p className="empty-state">
        <Link to="/problems">{t.problem.back}</Link>
      </p>
    </div>
  );
}
