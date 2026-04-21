import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './components/Toast';
import { useAuth } from './hooks/useAuth';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Dashboard } from './pages/Dashboard';
import { EnsemblePage } from './pages/Ensemble';
import { ChartPage } from './pages/Chart';
import { UploadVersion } from './pages/UploadVersion';
import { VersionDetail } from './pages/VersionDetail';
import { MigrationSourcesPage } from './pages/MigrationSources';
import { PlayerView } from './pages/PlayerView';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/" element={<RequireAuth><Dashboard /></RequireAuth>} />
      <Route path="/ensembles/:id" element={<RequireAuth><EnsemblePage /></RequireAuth>} />
      <Route path="/charts/:id" element={<RequireAuth><ChartPage /></RequireAuth>} />
      <Route path="/charts/:id/upload" element={<RequireAuth><UploadVersion /></RequireAuth>} />
      <Route path="/charts/:id/versions/:vId" element={<RequireAuth><VersionDetail /></RequireAuth>} />
      <Route path="/charts/:id/migration-sources" element={<RequireAuth><MigrationSourcesPage /></RequireAuth>} />
      <Route path="/my-parts" element={<RequireAuth><PlayerView /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
