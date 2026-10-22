import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuth } from '../auth';

export default function Login() {
  const { user, login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  if (user) return <Navigate to="/" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, name.trim() || undefined);
      nav('/');
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full grid place-items-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-3xl font-bold">⚡ Flow<span className="text-accent">Forge</span></div>
          <p className="text-slate-400 text-sm mt-1">Visual API Workflow Automation</p>
        </div>
        <form onSubmit={submit} className="card p-6 space-y-4">
          {mode === 'register' && (
            <div><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" /></div>
          )}
          <div><label className="label">Email</label><input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><label className="label">Password</label><input className="input" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          {err && <div className="text-red-400 text-sm">{err}</div>}
          <button className="btn btn-primary w-full justify-center" disabled={busy}>
            {busy ? '…' : mode === 'login' ? 'Log in' : 'Create account'}
          </button>
          <div className="text-center text-sm text-slate-400">
            {mode === 'login' ? "No account? " : 'Have an account? '}
            <button type="button" className="text-accent" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
              {mode === 'login' ? 'Register' : 'Log in'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
