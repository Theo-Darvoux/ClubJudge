import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/context';
import { useI18n } from '../i18n/context';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const { t } = useI18n();
  const location = useLocation();
  if (loading) return <p className="mono-label boot-loading">{t.problems.loading}</p>;
  if (!user) {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" state={{ from }} replace />;
  }
  return children;
}
