import { Routes, Route, useLocation } from 'react-router-dom';
import { ProjectProvider, AuthProvider, useAuth } from './context';
import type { AuthUser } from './context';
import Layout from './components/Layout';
import HomePage from './pages/HomePage';
import DocumentPage from './pages/DocumentPage';
import CollectionsPage from './pages/CollectionsPage';
import CollectionPage from './pages/CollectionPage';
import SearchPage from './pages/SearchPage';
import GraphPage from './pages/GraphPage';
import ProjectsPage from './pages/ProjectsPage';
import LoginPage from './pages/LoginPage';
import SettingsPage from './pages/SettingsPage';

function AppInner() {
  const { user, loading, login } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: 'var(--bg)',
      }}>
        <div style={{ fontSize: 14, color: 'var(--text2)' }}>Loading…</div>
      </div>
    );
  }

  if (!user && location.pathname !== '/login') {
    return <LoginPage onLogin={(u: AuthUser) => login(u)} />;
  }

  if (!user) {
    return <LoginPage onLogin={(u: AuthUser) => login(u)} />;
  }

  return (
    <ProjectProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/login" element={<HomePage />} />
          <Route path="/doc/:id" element={<DocumentPage />} />
          <Route path="/collections" element={<CollectionsPage />} />
          <Route path="/collections/:id" element={<CollectionPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/graph" element={<GraphPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </Layout>
    </ProjectProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}
