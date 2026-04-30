import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login } from '../api/auth';
import { getWorkspaces } from '../api/workspaces';
import { useAuth } from '../hooks/useAuth';
import { Button } from '../components/Button';
import { ApiError } from '../api/client';

export function Login() {
  const { login: setAuth } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { token, user } = await login({ email, password });
      // Store token so the workspaces fetch is authenticated
      localStorage.setItem('token', token);
      const { workspaces } = await getWorkspaces();
      const ws = workspaces[0];
      const wsId = ws?.id ?? '';
      setAuth(token, user, wsId, ws?.role);
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: 380, padding: 32, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <img src="/logo.svg" alt="Scorva" style={{ width: 56, height: 56, margin: '0 auto 12px', display: 'block', borderRadius: 10 }} />
          <h1 style={{ fontFamily: 'var(--serif)', fontSize: 24, fontWeight: 500, letterSpacing: '-0.02em' }}>Scorva</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Music chart management</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <p className="form-error">{error}</p>}
          <Button type="submit" loading={loading} style={{ width: '100%', marginTop: 8 }}>
            Sign in
          </Button>
        </form>
        <p style={{ textAlign: 'center', marginTop: 16, color: 'var(--text-muted)', fontSize: 13 }}>
          No account? <Link to="/signup">Sign up</Link>
        </p>
      </div>
    </div>
  );
}
