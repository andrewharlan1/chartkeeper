import { createContext, useState, useEffect, ReactNode } from 'react';
import { User } from '../types';

interface AuthContextValue {
  user: User | null;
  token: string | null;
  workspaceId: string | null;
  login: (token: string, user: User, workspaceId: string) => void;
  setWorkspaceId: (id: string) => void;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('token'));
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  });
  const [workspaceId, setWorkspaceIdState] = useState<string | null>(
    () => localStorage.getItem('workspaceId'),
  );

  useEffect(() => {
    if (token) localStorage.setItem('token', token);
    else localStorage.removeItem('token');
  }, [token]);

  useEffect(() => {
    if (user) localStorage.setItem('user', JSON.stringify(user));
    else localStorage.removeItem('user');
  }, [user]);

  useEffect(() => {
    if (workspaceId) localStorage.setItem('workspaceId', workspaceId);
    else localStorage.removeItem('workspaceId');
  }, [workspaceId]);

  function login(t: string, u: User, wsId: string) {
    setToken(t);
    setUser(u);
    setWorkspaceIdState(wsId);
  }

  function setWorkspaceId(id: string) {
    setWorkspaceIdState(id);
  }

  function logout() {
    setToken(null);
    setUser(null);
    setWorkspaceIdState(null);
  }

  return (
    <AuthContext.Provider value={{ user, token, workspaceId, login, setWorkspaceId, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
