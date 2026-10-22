import { Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import Login from './pages/Login';
import Workflows from './pages/Workflows';
import Editor from './pages/Editor';
import RunView from './pages/RunView';
import RunHistory from './pages/RunHistory';
import Credentials from './pages/Credentials';

function Protected({ children }: { children: JSX.Element }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-10 text-slate-400">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function TopBar() {
  const { user, logout } = useAuth();
  const loc = useLocation();
  if (!user || loc.pathname.startsWith('/editor') || loc.pathname === '/login') return null;
  return (
    <header className="flex items-center gap-4 px-5 h-14 border-b border-edge bg-panel">
      <Link to="/" className="font-bold text-lg">⚡ Flow<span className="text-accent">Forge</span></Link>
      <nav className="flex gap-1 text-sm ml-4">
        <Link to="/" className="px-3 py-1.5 rounded hover:bg-edge">Workflows</Link>
        <Link to="/credentials" className="px-3 py-1.5 rounded hover:bg-edge">Credentials</Link>
      </nav>
      <div className="ml-auto flex items-center gap-3 text-sm text-slate-400">
        <span>{user.name}</span>
        <button className="btn" onClick={logout}>Logout</button>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <div className="h-full flex flex-col">
        <TopBar />
        <main className="flex-1 min-h-0">
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Protected><Workflows /></Protected>} />
            <Route path="/editor/:id" element={<Protected><Editor /></Protected>} />
            <Route path="/workflows/:id/runs" element={<Protected><RunHistory /></Protected>} />
            <Route path="/runs/:id" element={<Protected><RunView /></Protected>} />
            <Route path="/credentials" element={<Protected><Credentials /></Protected>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </AuthProvider>
  );
}
