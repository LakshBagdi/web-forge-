import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { TEMPLATES } from '../templates';

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
  const [loaded, setLoaded] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const nav = useNavigate();

  const load = () => api.get('/workflows').then((d) => { setWfs(d.workflows); setLoadErr(''); }).catch((e: any) => setLoadErr(e?.message || 'Could not load your workflows')).finally(() => setLoaded(true));
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

  const fromTemplate = async (key: string) => {
    const t = TEMPLATES.find((x) => x.key === key)!;
    setBusy(true);
    try {
      const { workflow } = await api.post('/workflows', { name: t.name, description: t.hint, graph: t.graph });
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
      {!loaded && <div className="text-slate-500 text-sm py-10 text-center">Loading your workflows…</div>}
      {loadErr && <div className="card p-3 mb-4 text-sm text-red-300">{loadErr} <button className="underline ml-2" onClick={() => load()}>Try again</button></div>}
      {loaded && wfs.length === 0 && (
        <div className="grid md:grid-cols-3 gap-3 mb-6" data-testid="how-it-works">
          {[['1', 'Pick a template', 'Try an instant demo first — no keys needed — or start a blank workflow.'],
            ['2', 'Fill in the blanks', 'Click a step, type your message or paste your link. Steps connect themselves and changes save automatically.'],
            ['3', 'Run it, then automate it', '▶ Run tests it now. ⏰ Schedule repeats it or runs it at an exact time; a webhook starts it when another app calls.']].map(([n, t, d]) => (
            <div key={n} className="card p-3 flex gap-3">
              <div className="w-7 h-7 shrink-0 rounded-full bg-accent/20 text-accent flex items-center justify-center font-bold">{n}</div>
              <div><div className="font-semibold text-sm">{t}</div><div className="text-xs text-slate-400 mt-0.5">{d}</div></div>
            </div>
          ))}
        </div>
      )}
      {loaded && wfs.length > 0 && (
        <div className="mb-6">
          <div className="text-sm font-semibold text-slate-300 mb-2">Your workflows</div>
          <div className="grid gap-3">
            {wfs.map((w) => (
              <div key={w.id} className="card p-4 flex items-center gap-4 hover:border-accent transition cursor-pointer" onClick={() => nav(`/editor/${w.id}`)} data-testid="wf-row">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{w.name}</div>
                  <div className="text-xs text-slate-400 truncate">{w.description || 'No description'} · {w.run_count} run(s)</div>
                </div>
                <span className="text-xs text-slate-500 hidden sm:block">Edited {new Date(w.updated_at).toLocaleString()}</span>
                <button className="btn" onClick={(e) => { e.stopPropagation(); nav(`/workflows/${w.id}/runs`); }}>History</button>
                <button className="btn btn-danger" onClick={(e) => { e.stopPropagation(); remove(w.id); }}>Delete</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {loaded && <details open={wfs.length === 0} className="mb-6">
        <summary className="cursor-pointer text-sm font-semibold text-slate-300 mb-2 select-none">＋ Start from a ready-made template</summary>
        {(['demo', 'real'] as const).map((g) => (
          <div className="mt-3" key={g}>
            <div className="text-xs font-semibold text-slate-400 mb-2">
              {g === 'real' ? 'Real services — you will paste your own keys/links into the ⚙ Settings step' : 'Instant demos — work right now, offline, no setup'}
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              {TEMPLATES.filter((t) => t.group === g).map((t) => (
                <button key={t.key} disabled={busy} data-testid={`tpl-${t.key}`} onClick={() => fromTemplate(t.key)}
                  className="card p-3 text-left hover:border-accent transition">
                  <div className="font-semibold">{t.emoji} {t.name}</div>
                  <div className="text-xs text-slate-400 mt-1">{t.blurb}</div>
                  {t.needs && <div className="text-[11px] text-amber-300/90 mt-2">You need: {t.needs}</div>}
                </button>
              ))}
            </div>
          </div>
        ))}
      </details>}
    </div>
  );
}
