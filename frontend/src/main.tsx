import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './auth/AuthProvider';
import { Layout } from './components/Layout';
import { RequireAuth } from './components/RequireAuth';
import { I18nProvider } from './i18n';
import { AdminPage } from './pages/AdminPage';
import { ArticlePage } from './pages/ArticlePage';
import { AuthPage } from './pages/AuthPage';
import { ContestPage } from './pages/ContestPage';
import { ContestsPage } from './pages/ContestsPage';
import { CoursePage } from './pages/CoursePage';
import { CoursesPage } from './pages/CoursesPage';
import { ProblemPage } from './pages/ProblemPage';
import { ProblemsPage } from './pages/ProblemsPage';
import { SkillTreePage } from './pages/SkillTreePage';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<AuthPage />} />
            <Route
              element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }
            >
              <Route path="/problems" element={<SkillTreePage />} />
              <Route path="/problems/list" element={<ProblemsPage />} />
              <Route path="/problems/:slug" element={<ProblemPage />} />
              <Route path="/contests" element={<ContestsPage />} />
              <Route path="/contests/:slug" element={<ContestPage />} />
              <Route path="/courses" element={<CoursesPage />} />
              <Route path="/courses/:slug" element={<CoursePage />} />
              <Route path="/courses/:slug/:articleSlug" element={<ArticlePage />} />
              <Route path="/admin" element={<AdminPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/problems" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </I18nProvider>
  </StrictMode>,
);
