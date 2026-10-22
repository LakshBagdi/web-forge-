import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';

interface WF { id: string; name: string; description: string; active_version: number; updated_at: string; run_count: string; }

const STARTER = {
  nodes: [
    { id: 'trigger', type: 'trigger', label: 'Start', position: { x: 60, y: 160 }, config: {} },
    { id: 'http1', type: 'http', label: 'Get user', position: { x: 320, y: 160 }, config: { method: 'GET', url: 'http://localhost:4000/mock/users/1', headers: {}, failOnErrorStatus: true } },
    { id: 'cond1', type: 'condition', label: 'Pro tier?', position: { x: 600, y: 160 }, config: { left: 'steps.http1.output.body.tier', operator: 'eq', right: 'pro' } },
    { id: 'notify', type: 'http', label: 'Notify', position: { x: 880, y: 80 }, config: { method: 'POST', url: 'http://localhost:4000/mock/notify', body: { user: '{{steps.http1.output.body.name}}' }, bodyType: 'json', headers: {} } },
    { id: 'shape', type: 'transform', label: 'Shape', position: { x: 880, y: 260 }, config: { mapping: { name: '{{steps.http1.output.body.name}}', tier: '{{steps.http1.output.body.tier}}' } } },
  ],
  edges: [
    { id: 'e1', source: 'trigger', target: 'http1' },
    { id: 'e2', source: 'http1', target: 'cond1' },
    { id: 'e3', source: 'cond1', target: 'notify', sourceHandle: 'true' },
    { id: 'e4', source: 'cond1', target: 'shape', sourceHandle: 'false' },
  ],
};

export default function Workflows() {
  const [wfs, setWfs] = useState<WF[]>([]);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const load = () => api.get('/workflows').then((d) => setWfs(d.workflows));
  useEffect(() => { load(); }, []);

  const create = async (withSample: boolean) => {
    setBusy(true);
    try {
      const { workflow } = await api.post('/workflows', {
        name: withSample ? 'Sample: user tier router' : 'Untitled workflow',
        graph: withSample ? STARTER : { nodes: [{ id: 'trigger', type: 'trigger', label: 'Start', position: { x: 80, y: 160 }, config: {} }], edges: [] },
      });
      nav(`/editor/${workflow.id}`);
    } finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this workflow and its runs?')) return;
    await api.del(`/workflows/${id}`);
    load();
  };

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center mb-6">
        <h1 className="text-2xl font-bold">Workflows</h1>
        <div className="ml-auto flex gap-2">
          <button className="btn" disabled={busy} onClick={() => create(true)}>+ Sample workflow</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => create(false)}>+ New workflow</button>
        </div>
      </div>
      {wfs.length === 0 ? (
        <div className="card p-10 text-center text-slate-400">
          No workflows yet. Start with a <button className="text-accent" onClick={() => create(true)}>sample workflow</button> to see branching + API calls in action.
        </div>
      ) : (
        <div className="grid gap-3">
          {wfs.map((w) => (
            <div key={w.id} className="card p-4 flex items-center gap-4 hover:border-accent transition cursor-pointer" onClick={() => nav(`/editor/${w.id}`)}>
              <div className="flex-1">
                <div className="font-semibold">{w.name}</div>
                <div className="text-xs text-slate-400">{w.description || 'No description'} · v{w.active_version} · {w.run_count} run(s)</div>
              </div>
              <span className="text-xs text-slate-500">{new Date(w.updated_at).toLocaleString()}</span>
              <button className="btn btn-danger" onClick={(e) => { e.stopPropagation(); remove(w.id); }}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
