import { useEffect, useState } from 'react';
import { api } from '../api';

/** Shows the public URL that starts this workflow when any app POSTs to it. */
export default function WebhookPanel({ workflowId }: { workflowId: string }) {
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState('');
  const base = (import.meta.env.VITE_API_BASE as string) || window.location.origin;

  useEffect(() => {
    setToken(''); setErr('');
    api.get(`/workflows/${workflowId}/webhook`).then((d) => setToken(d.token)).catch((e) => setErr(e.message));
  }, [workflowId]);

  const url = token ? `${base}/hooks/${token}` : '';
  const curl = url ? `curl -X POST ${url} \\\n  -H "content-type: application/json" \\\n  -d '{"event":"hello","amount":150}'` : '';
  const copy = async (what: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(''), 1200); } catch { /* clipboard blocked */ }
  };
  const rotate = async () => {
    if (!confirm('Generate a new URL? The old one stops working immediately.')) return;
    try { const d = await api.post(`/workflows/${workflowId}/webhook/rotate`); setToken(d.token); } catch (e: any) { setErr(e.message); }
  };

  return (
    <div className="rounded-md border border-edge p-2 space-y-2" data-testid="webhook-panel">
      <div className="text-xs font-semibold text-slate-400">🪝 Webhook URL — any app can start this workflow</div>
      {err && <div className="text-red-400 text-xs">{err}</div>}
      {url && (
        <>
          <div className="flex gap-1">
            <input readOnly className="input font-mono text-[11px]" value={url} onFocus={(e) => e.target.select()} />
            <button className="btn text-xs" onClick={() => copy('url', url)}>{copied === 'url' ? '✓' : 'Copy'}</button>
          </div>
          <details className="text-[11px] text-slate-400">
            <summary className="cursor-pointer">curl example</summary>
            <pre className="bg-ink rounded p-2 mt-1 overflow-x-auto whitespace-pre-wrap break-all">{curl}</pre>
            <button className="btn text-xs mt-1" onClick={() => copy('curl', curl)}>{copied === 'curl' ? 'copied ✓' : 'Copy curl'}</button>
          </details>
          <p className="text-[11px] text-slate-500">
            JSON fields in the request become <span className="font-mono">{'{{input.field}}'}</span>. The URL is a secret — anyone who has it can trigger runs.
            {' '}Runs the <b>saved</b> version of the workflow.
          </p>
          <button className="btn text-xs" onClick={rotate}>↻ Regenerate URL</button>
        </>
      )}
    </div>
  );
}
