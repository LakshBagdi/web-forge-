import { useEffect, useState } from 'react';
import { api } from '../api';

interface Version { version: number; note: string; created_at: string; }

export default function VersionsPanel({
  workflowId, onRestored, onClose,
}: { workflowId: string; onRestored: () => void; onClose: () => void }) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState('');

  const load = () => api.get(`/workflows/${workflowId}/versions`).then((d) => setVersions(d.versions));
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [workflowId]);

  const restore = async (v: number) => {
    if (!confirm(`Restore version ${v}? Your current canvas is replaced (a new version is created, so nothing is lost).`)) return;
    setBusy(v); setErr('');
    try {
      await api.post(`/workflows/${workflowId}/versions/${v}/restore`);
      await load();
      onRestored();
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center">
        <div className="font-semibold">Version history</div>
        <button className="btn ml-auto px-2" onClick={onClose}>✕</button>
      </div>
      <p className="text-xs text-slate-400">
        Every “Save version” creates an immutable snapshot. Restoring copies an old snapshot onto the canvas as a brand-new version.
      </p>
      {err && <div className="text-red-400 text-sm">{err}</div>}
      <div className="space-y-2">
        {versions.map((v, i) => (
          <div key={v.version} className="card p-3">
            <div className="flex items-center gap-2">
              <span className="badge bg-accent/20 text-accent">v{v.version}</span>
              {i === 0 && <span className="badge bg-emerald-500/20 text-emerald-300">latest</span>}
              <span className="text-xs text-slate-500 ml-auto">{new Date(v.created_at).toLocaleString()}</span>
            </div>
            <div className="text-sm mt-1">{v.note || '—'}</div>
            {i !== 0 && (
              <button className="btn mt-2 text-xs" disabled={busy !== null} onClick={() => restore(v.version)}>
                {busy === v.version ? 'Restoring…' : 'Restore this version'}
              </button>
            )}
          </div>
        ))}
        {versions.length === 0 && <div className="text-sm text-slate-500">No versions yet.</div>}
      </div>
    </div>
  );
}
