import { useState } from 'react';
import { api } from '../api';
import { explainError } from '../friendlyError';

/** "Try this step now": really runs just this one step (using data from your last run) and shows what came back. */
export default function TestStep({ workflowId, node }: { workflowId?: string; node: { id: string; type: string; label?: string; config: any; timeoutMs?: number } }) {
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState('');
  if (!workflowId || !['http', 'transform', 'condition'].includes(node.type)) return null;

  const method = String(node.config?.method || 'GET').toUpperCase();
  const sends = node.type === 'http' && !['GET', 'HEAD'].includes(method);

  const go = async () => {
    if (sends && !armed) { setArmed(true); setTimeout(() => setArmed(false), 5000); return; }
    setArmed(false); setBusy(true); setErr(''); setRes(null);
    try {
      setRes(await api.post(`/workflows/${workflowId}/test-node`, { node: { id: node.id, type: node.type, label: node.label, config: node.config, timeoutMs: node.timeoutMs } }));
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const out = res?.output;
  return (
    <div className="rounded-md border border-edge p-2 space-y-2" data-testid="test-step">
      <button className="btn w-full justify-center" disabled={busy} onClick={go} data-testid="test-step-btn">
        {busy ? 'Testing…' : armed ? '⚠ Really send it? Click again' : '🧪 Test this step'}
      </button>
      <p className="text-[11px] text-slate-500">
        {sends ? 'This really sends the request (a real message/post/event). ' : 'Runs only this step. '}
        Earlier steps’ data comes from your last run, so press ▶ Run once first if it uses <span className="font-mono">{'{{steps…}}'}</span>.
      </p>
      {err && <div className="text-xs text-red-400">{err}</div>}
      {res && (
        <div className="space-y-1 text-xs" data-testid="test-result">
          <div className={res.ok ? 'text-emerald-400 font-semibold' : 'text-red-400 font-semibold'}>
            {res.ok ? '✓ It worked' : '✗ It failed'}{res.ok && out?.status ? ` · HTTP ${out.status}` : ''}{res.branch ? ` · branch: ${res.branch}` : ''}
          </div>
          {res.error && (() => { const ex = explainError(res.error); return (
            <div className="text-red-300 whitespace-pre-wrap">
              {ex && <div className="text-red-200 mb-1">{ex.what} <span className="text-red-200/70">{ex.fix}</span></div>}
              <div className="text-red-400/80">{res.error}</div>
            </div>); })()}
          {res.unresolved?.length > 0 && (
            <div className="text-amber-300">No data yet for {res.unresolved.map((u: string) => `{{${u}}}`).join(', ')} — press ▶ Run once so earlier steps have data (it was sent empty).</div>
          )}
          {(res.ok ? out?.body ?? out : res.response?.body) !== undefined && (
            <>
              <div className="text-slate-500">{res.ok ? 'What came back:' : 'What the server said:'}</div>
              <pre className="bg-ink rounded p-2 overflow-auto max-h-48 whitespace-pre-wrap break-all">{JSON.stringify(res.ok ? out?.body ?? out : res.response?.body, null, 2)}</pre>
            </>
          )}
          {res.logs?.length > 0 && <details className="text-slate-500"><summary className="cursor-pointer">Details</summary>{res.logs.map((l: any, i: number) => <div key={i} className="font-mono">{l.message}</div>)}</details>}
        </div>
      )}
    </div>
  );
}
