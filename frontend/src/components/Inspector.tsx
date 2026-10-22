import { useEffect, useState } from 'react';
import { api } from '../api';
import { NODE_DEFS, NodeType, OPERATORS } from '../constants';
import WebhookPanel from './WebhookPanel';

interface Props {
  node: { id: string; type: NodeType; label?: string; config: any; retry?: any; timeoutMs?: number } | null;
  onChange: (patch: { label?: string; config?: any; retry?: any; timeoutMs?: number }) => void;
  onDelete: () => void;
  upstream?: { id: string; label: string; type: NodeType }[];
  workflowId?: string;
}

/** Click-to-copy chip for a template reference like {{steps.http1.output.body}}. */
function RefChip({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1200); } catch { /* clipboard blocked */ }
  };
  return (
    <button type="button" onClick={copy} title="Click to copy"
      className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-ink border border-edge hover:border-accent text-left break-all">
      {done ? 'copied ✓' : text}
    </button>
  );
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

export default function Inspector({ node, onChange, onDelete, upstream = [], workflowId }: Props) {
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
      {node.type === 'trigger' && (
        <p className="text-xs text-slate-400">Use the <span className="font-mono">{'{ } Input'}</span> button in the top bar to give a run some JSON input, then read it anywhere as <span className="font-mono">{'{{input.field}}'}</span>.</p>
      )}
      {node.type === 'trigger' && workflowId && <WebhookPanel workflowId={workflowId} />}

      <div><label className="label">Label</label>
        <input className="input" value={node.label || ''} onChange={(e) => onChange({ label: e.target.value })} />
        <div className="text-[11px] text-slate-500 mt-1">Node id: <span className="font-mono text-slate-300">{node.id}</span></div>
      </div>

      {upstream.length > 0 && node.type !== 'trigger' && (
        <div className="rounded-md border border-edge p-2 space-y-2">
          <div className="text-xs font-semibold text-slate-400">Data from earlier steps (click to copy)</div>
          {upstream.map((u) => (
            <div key={u.id} className="space-y-1">
              <div className="text-[11px] text-slate-400">{u.label || u.id} <span className="font-mono text-slate-500">({u.id})</span></div>
              <div className="flex flex-wrap gap-1">
                {u.type === 'http' && <>
                  <RefChip text={`{{steps.${u.id}.output.body}}`} />
                  <RefChip text={`{{steps.${u.id}.output.status}}`} />
                </>}
                {u.type === 'watch' && <>
                  <RefChip text={`{{steps.${u.id}.output.current}}`} />
                  <RefChip text={`{{steps.${u.id}.output.previous}}`} />
                </>}
                {u.type !== 'http' && u.type !== 'watch' && <RefChip text={`{{steps.${u.id}.output}}`} />}
              </div>
            </div>
          ))}
          <div className="text-[11px] text-slate-500">Add a field name to go deeper, e.g. <span className="font-mono">.body.name</span></div>
        </div>
      )}

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
          <div><label className="label">Query parameters (values support {'{{templates}}'})</label><KeyValueEditor value={cfg.query || {}} onChange={(query) => set({ query })} /></div>
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
          <div className="border-t border-edge pt-3">
            <label className="label">Or a full expression (overrides the fields above)</label>
            <textarea className="input font-mono h-16" value={cfg.expression || ''}
              placeholder="steps.http1.output.status == 200 && (input.amount > 100 || input.vip == true)"
              onChange={(e) => set({ expression: e.target.value || undefined })} />
            <p className="text-xs text-slate-500 mt-1">Supports && || ! ( ) == != &gt; &gt;= &lt; &lt;= contains startsWith endsWith matches.</p>
          </div>
          <p className="text-xs text-slate-500">Connect the green handle for the true branch, red for false.</p>
        </>
      )}

      {node.type === 'watch' && (
        <>
          <div><label className="label">Value to watch (use a {'{{template}}'})</label>
            <input className="input font-mono" value={cfg.value || ''} placeholder="{{steps.http1.output.body.items.0.id}}" onChange={(e) => set({ value: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cfg.fireOnFirstRun === true} onChange={(e) => set({ fireOnFirstRun: e.target.checked })} />
            Also fire on the very first check
          </label>
          <p className="text-xs text-slate-500">
            Each run compares this value with the one saved last time. Different → the green (changed) branch runs; same → the red branch.
            The first check just saves a baseline, so old items don't trigger anything. Pair it with a ⏰ repeating schedule.
          </p>
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
