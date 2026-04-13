import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { useAuth } from './hooks/useAuth';
import { Login } from './pages/Login';
import { Signup } from './pages/Signup';
import { Dashboard } from './pages/Dashboard';
import { EnsemblePage } from './pages/Ensemble';
import { ChartPage } from './pages/Chart';
import { UploadVersion } from './pages/UploadVersion';
import { VersionDetail } from './pages/VersionDetail';
import { PlayerView } from './pages/PlayerView';
function RequireAuth({ children }) {
    const { token } = useAuth();
    if (!token)
        return _jsx(Navigate, { to: "/login", replace: true });
    return children;
}
function AppRoutes() {
    return (_jsxs(Routes, { children: [_jsx(Route, { path: "/login", element: _jsx(Login, {}) }), _jsx(Route, { path: "/signup", element: _jsx(Signup, {}) }), _jsx(Route, { path: "/", element: _jsx(RequireAuth, { children: _jsx(Dashboard, {}) }) }), _jsx(Route, { path: "/ensembles/:id", element: _jsx(RequireAuth, { children: _jsx(EnsemblePage, {}) }) }), _jsx(Route, { path: "/charts/:id", element: _jsx(RequireAuth, { children: _jsx(ChartPage, {}) }) }), _jsx(Route, { path: "/charts/:id/upload", element: _jsx(RequireAuth, { children: _jsx(UploadVersion, {}) }) }), _jsx(Route, { path: "/charts/:id/versions/:vId", element: _jsx(RequireAuth, { children: _jsx(VersionDetail, {}) }) }), _jsx(Route, { path: "/my-parts", element: _jsx(RequireAuth, { children: _jsx(PlayerView, {}) }) }), _jsx(Route, { path: "*", element: _jsx(Navigate, { to: "/", replace: true }) })] }));
}
export function App() {
    return (_jsx(AuthProvider, { children: _jsx(BrowserRouter, { children: _jsx(AppRoutes, {}) }) }));
}
