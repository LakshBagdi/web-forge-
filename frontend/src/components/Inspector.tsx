import { useEffect, useState } from 'react';
import { api } from '../api';
import { NODE_DEFS, NodeType, OPERATORS } from '../constants';

interface Props {
  node: { id: string; type: NodeType; label?: string; config: any; retry?: any; timeoutMs?: number } | null;
  onChange: (patch: { label?: string; config?: any; retry?: any; timeoutMs?: number }) => void;
  onDelete: () => void;
}

function KeyValueEditor({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const entries = Object.entries(value || {});
  const update = (i: number, k: string, v: string) => {
    const next = entries.slice();
    next[i] = [k, v];
    onChange(Object.fromEntries(next.filter(([key]) => key !== '')));
  };
  return (
    <div className="space-y-1">
      {entries.map(([k, v], i) => (
        <div key={i} className="flex gap-1">
          <input className="input flex-1" value={k} placeholder="key" onChange={(e) => update(i, e.target.value, v)} />
          <input className="input flex-1" value={v} placeholder="value" onChange={(e) => update(i, k, e.target.value)} />
          <button className="btn px-2" onClick={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))}>✕</button>
        </div>
      ))}
      <button className="btn w-full justify-center text-xs" onClick={() => onChange({ ...value, '': '' })}>+ Add</button>
    </div>
  );
}

export default function Inspector({ node, onChange, onDelete }: Props) {
  const [creds, setCreds] = useState<{ id: string; name: string; type: string }[]>([]);
  useEffect(() => { api.get('/credentials').then((d) => setCreds(d.credentials)).catch(() => {}); }, []);

  if (!node) {
    return <div className="p-4 text-sm text-slate-400">Select a node to configure it, or drag one in from the palette.</div>;
  }
  const def = NODE_DEFS[node.type];
  const cfg = node.config || {};
  const set = (patch: any) => onChange({ config: { ...cfg, ...patch } });

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      <div className="flex items-center gap-2">
        <span style={{ color: def.color }}>{def.icon}</span>
        <span className="font-semibold">{def.label}</span>
        {node.type !== 'trigger' && <button className="btn btn-danger ml-auto text-xs" onClick={onDelete}>Delete node</button>}
      </div>
      <p className="text-xs text-slate-400">{def.description}</p>

      <div><label className="label">Label</label>
        <input className="input" value={node.label || ''} onChange={(e) => onChange({ label: e.target.value })} />
      </div>

      {node.type === 'http' && (
        <>
          <div className="flex gap-2">
            <div className="w-28"><label className="label">Method</label>
              <select className="input" value={cfg.method || 'GET'} onChange={(e) => set({ method: e.target.value })}>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="flex-1"><label className="label">URL</label>
              <input className="input font-mono" value={cfg.url || ''} placeholder="https://api.example.com/x" onChange={(e) => set({ url: e.target.value })} />
            </div>
          </div>
          <div><label className="label">Headers</label><KeyValueEditor value={cfg.headers || {}} onChange={(headers) => set({ headers })} /></div>
          <div><label className="label">Authentication</label>
            <select className="input" value={cfg.credentialId || ''} onChange={(e) => set({ credentialId: e.target.value || undefined })}>
              <option value="">None</option>
              {creds.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
            </select>
          </div>
          {['POST', 'PUT', 'PATCH'].includes((cfg.method || 'GET')) && (
            <div><label className="label">Body (JSON — supports {'{{templates}}'})</label>
              <textarea className="input font-mono h-24" value={typeof cfg.body === 'string' ? cfg.body : JSON.stringify(cfg.body ?? {}, null, 2)}
                onChange={(e) => set({ body: e.target.value, bodyType: 'json' })} />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cfg.failOnErrorStatus !== false} onChange={(e) => set({ failOnErrorStatus: e.target.checked })} />
            Treat HTTP ≥400 as failure
          </label>
        </>
      )}

      {node.type === 'condition' && (
        <>
          <div><label className="label">Left (value or {'{{path}}'})</label>
            <input className="input font-mono" value={cfg.left || ''} placeholder="steps.http1.output.body.tier" onChange={(e) => set({ left: e.target.value })} />
          </div>
          <div><label className="label">Operator</label>
            <select className="input" value={cfg.operator || 'eq'} onChange={(e) => set({ operator: e.target.value })}>
              {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {!['exists', 'truthy'].includes(cfg.operator) && (
            <div><label className="label">Right</label>
              <input className="input font-mono" value={cfg.right ?? ''} onChange={(e) => set({ right: e.target.value })} />
            </div>
          )}
          <p className="text-xs text-slate-500">Connect the green handle for the true branch, red for false.</p>
        </>
      )}

      {node.type === 'transform' && (
        <div><label className="label">Output mapping (value supports {'{{templates}}'})</label>
          <KeyValueEditor value={cfg.mapping || {}} onChange={(mapping) => set({ mapping })} />
        </div>
      )}

      {node.type === 'delay' && (
        <div><label className="label">Delay (ms)</label>
          <input className="input" type="number" value={cfg.ms ?? 0} onChange={(e) => set({ ms: Number(e.target.value) })} />
        </div>
      )}

      {node.type !== 'trigger' && (
        <div className="border-t border-edge pt-3 space-y-2">
          <div className="text-xs font-semibold text-slate-400">Reliability</div>
          <div className="flex gap-2">
            <div className="flex-1"><label className="label">Max attempts</label>
              <input className="input" type="number" min={1} max={10} value={node.retry?.maxAttempts ?? 1}
                onChange={(e) => onChange({ retry: { ...(node.retry || { backoffMs: 500 }), maxAttempts: Number(e.target.value) } })} />
            </div>
            <div className="flex-1"><label className="label">Backoff (ms)</label>
              <input className="input" type="number" min={0} value={node.retry?.backoffMs ?? 500}
                onChange={(e) => onChange({ retry: { ...(node.retry || { maxAttempts: 1 }), backoffMs: Number(e.target.value) } })} />
            </div>
            <div className="flex-1"><label className="label">Timeout (ms)</label>
              <input className="input" type="number" min={100} value={node.timeoutMs ?? 15000}
                onChange={(e) => onChange({ timeoutMs: Number(e.target.value) })} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
