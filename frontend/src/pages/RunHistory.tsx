import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { STATUS_STYLE } from '../constants';

interface RunRow {
  id: string; version: number; status: string; trigger: string; error: string | null;
  started_at: string | null; finished_at: string | null; created_at: string;
}

function duration(r: RunRow) {
  if (!r.started_at || !r.finished_at) return '—';
  const ms = new Date(r.finished_at).getTime() - new Date(r.started_at).getTime();
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export default function RunHistory() {
  const { id } = useParams();
  const nav = useNavigate();
  const [name, setName] = useState('');
  const [runs, setRuns] = useState<RunRow[]>([]);

  const load = () => api.get(`/runs?workflowId=${id}`).then((d) => setRuns(d.runs));
  useEffect(() => {
    api.get(`/workflows/${id}`).then((d) => setName(d.workflow.name));
    load();
    const t = setInterval(load, 3000); // keep running/queued rows fresh
    return () => clearInterval(t);
  }, [id]);

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-6">
        <Link to={`/editor/${id}`} className="btn">← Editor</Link>
        <h1 className="text-2xl font-bold">Run history</h1>
        <span className="text-slate-400">{name}</span>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink text-slate-400 text-xs uppercase">
            <tr>
              <th className="text-left p-3">Status</th><th className="text-left p-3">Trigger</th>
              <th className="text-left p-3">Version</th><th className="text-left p-3">Started</th>
              <th className="text-left p-3">Duration</th><th className="text-left p-3">Error</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const st = STATUS_STYLE[r.status] || STATUS_STYLE.pending;
              return (
                <tr key={r.id} className="border-t border-edge hover:bg-edge/40 cursor-pointer" onClick={() => nav(`/runs/${r.id}`)}>
                  <td className="p-3"><span className={`badge ${st.bg} ${st.text}`}>{st.label}</span></td>
                  <td className="p-3">{r.trigger}</td>
                  <td className="p-3">v{r.version}</td>
                  <td className="p-3 text-slate-400">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="p-3">{duration(r)}</td>
                  <td className="p-3 text-red-300 max-w-xs truncate">{r.error || ''}</td>
                </tr>
              );
            })}
            {runs.length === 0 && (
              <tr><td colSpan={6} className="p-8 text-center text-slate-500">No runs yet. Open the editor and press Run.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
