import { useEffect, useState } from 'react';
import { api } from '../api';
import { NODE_DEFS, NodeType, OPERATORS } from '../constants';
import WebhookPanel from './WebhookPanel';
import KeyValueEditor from './KeyValueEditor';
import BodyEditor from './BodyEditor';
import TestStep from './TestStep';
import Tip from './Tip';
import { PRESETS } from '../presets';

const METHOD_HELP: Record<string, string> = {
  GET: 'GET = ask for information (read only). Nothing is changed on the other side.',
  POST: 'POST = send something new (a message, a post, a new event). This is the usual choice for “do something”.',
  PUT: 'PUT = replace something that already exists with the data you send.',
  PATCH: 'PATCH = change only some parts of something that already exists.',
  DELETE: 'DELETE = remove something.',
  HEAD: 'HEAD = like GET but only checks the headers, no data comes back.',
};

function msToParts(ms: number): { n: number; unit: 'ms' | 's' | 'm' | 'h' } {
  if (ms > 0 && ms % 3_600_000 === 0) return { n: ms / 3_600_000, unit: 'h' };
  if (ms > 0 && ms % 60_000 === 0) return { n: ms / 60_000, unit: 'm' };
  if (ms > 0 && ms % 1000 === 0) return { n: ms / 1000, unit: 's' };
  return { n: ms, unit: 'ms' };
}
const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as const;

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

function MoreOptions({ simple, children }: { simple: boolean; children: React.ReactNode }) {
  if (!simple) return <>{children}</>;
  return (
    <details className="rounded-md border border-edge p-2" data-testid="more-options">
      <summary className="cursor-pointer text-xs text-slate-400 select-none">More options (usually not needed)</summary>
      <div className="space-y-3 mt-3">{children}</div>
    </details>
  );
}

export default function Inspector({ node, onChange, onDelete, upstream = [], workflowId }: Props) {
  const [creds, setCreds] = useState<{ id: string; name: string; type: string }[]>([]);
  useEffect(() => { api.get('/credentials').then((d) => setCreds(d.credentials)).catch(() => {}); }, []);
  // which Quick setup the person just picked for THIS node (shown as a confirmation, so the pick never looks like it "did nothing")
  const [applied, setApplied] = useState('');
  const nodeId = node?.id;
  useEffect(() => { setApplied(''); }, [nodeId]);

  if (!node) {
    return <div className="p-4 text-sm text-slate-400">Select a node to configure it, or drag one in from the palette.</div>;
  }
  const def = NODE_DEFS[node.type];
  const cfg = node.config || {};
  const fmt = cfg.messageFormat;
  // "simple mode": a message going to X / Discord / Slack only needs a link (or login) and the text — everything else hides under More options
  const simple = node.type === 'http' && cfg.bodyMode === 'message' && ['discord', 'slack', 'x'].includes(fmt) && (cfg.method || 'GET') === 'POST';
  const isX = fmt === 'x';
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
          <div>
            <label className="label">Quick setup (optional)</label>
            <select className="input" value={applied} data-testid="preset" onChange={(e) => {
              const p = PRESETS.find((x) => x.id === e.target.value);
              if (!p) { setApplied(''); return; }
              setApplied(p.id);
              const title = p.label.replace(/^[^\p{L}]+/u, '');
              const keepLabel = node.label && node.label !== NODE_DEFS.http.label && !PRESETS.some((x) => x.label.replace(/^[^\p{L}]+/u, '') === node.label);
              onChange({ ...(keepLabel ? {} : { label: title }), config: { ...p.patch, credentialId: cfg.credentialId, failOnErrorStatus: cfg.failOnErrorStatus } });
              // jump to the next thing they need to fill in
              if (!p.patch.url) setTimeout(() => (document.querySelector('[data-testid="url"]') as HTMLInputElement | null)?.focus(), 50);
            }}>
              <option value="">Pick what you want to do…</option>
              {PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
            {applied && (() => {
              const p = PRESETS.find((x) => x.id === applied)!;
              return (
                <div className="mt-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-2 text-xs text-emerald-200" data-testid="preset-done">
                  <div className="font-semibold">✓ Set up: {p.label.replace(/^[^\p{L}]+/u, '')}</div>
                  <div className="text-emerald-100/80 mt-0.5">{p.help} <span className="text-slate-400">(Method, address and message below were filled in for you — change anything you like.)</span></div>
                </div>
              );
            })()}
          </div>
          {simple && !isX && (
            <div>
              <label className="label">{fmt === 'slack' ? 'Slack webhook link' : 'Discord webhook link'}</label>
              <input className="input font-mono" value={cfg.url || ''} placeholder={fmt === 'slack' ? 'https://hooks.slack.com/services/…' : 'https://discord.com/api/webhooks/…'} data-testid="url" onChange={(e) => set({ url: e.target.value })} />
              <div className="text-[11px] text-slate-500 mt-1">
                {fmt === 'slack'
                  ? 'In Slack: api.slack.com/apps → Create app → Incoming Webhooks → Add New Webhook → Copy.'
                  : 'In Discord: channel ⚙ → Integrations → Webhooks → New Webhook → Copy Webhook URL.'}
              </div>
            </div>
          )}
          {simple && isX && (
            <div>
              <label className="label">Your X login</label>
              <select className="input" value={cfg.credentialId || ''} data-testid="x-login" onChange={(e) => set({ credentialId: e.target.value || undefined })}>
                <option value="">Pick your X login…</option>
                {creds.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
              </select>
              <div className="mt-1 rounded border border-amber-500/40 bg-amber-500/10 p-1.5 text-[11px] text-amber-200" data-testid="x-paid-note">💳 Uses X’s paid API — X charges credits for posting, so add credit in your X developer account first.</div>
              <div className="text-[11px] text-slate-500 mt-1">Not in the list? Open the <b>Credentials</b> page → “Connect X”, then come back.</div>
            </div>
          )}
          {simple && (
            <div><label className="label">Message</label>
              <BodyEditor cfg={cfg} set={set} upstream={upstream} simple />
            </div>
          )}
          <MoreOptions key={applied} simple={simple}>
          <div className="flex gap-2">
            <div className="w-28"><label className="label">Method</label>
              <select className="input" value={cfg.method || 'GET'} data-testid="method" onChange={(e) => {
                const m = e.target.value;
                const sends = ['POST', 'PUT', 'PATCH'].includes(m);
                // switching to a method that sends data gives it a body style automatically; switching away hides it
                set(sends && !cfg.bodyMode && (cfg.body === undefined || cfg.body === '') ? { method: m, bodyMode: 'message', messageFormat: cfg.messageFormat || 'other' } : { method: m });
              }}>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            {!simple && <div className="flex-1"><label className="label">URL (the web address)</label>
              <input className="input font-mono" value={cfg.url || ''} placeholder="https://api.example.com/x" data-testid="url" onChange={(e) => set({ url: e.target.value })} />
            </div>}
          </div>
          {!simple && <p className="text-[11px] text-slate-400" data-testid="method-help">{METHOD_HELP[cfg.method || 'GET']}</p>}

          <div><label className="label">Extra info in the address — “Query parameters”</label>
            <KeyValueEditor value={cfg.query || {}} onChange={(query) => set({ query })} keyPlaceholder="name  e.g. maxResults" valuePlaceholder="value  e.g. 5" addLabel="+ Add a parameter" />
            <div className="mt-1"><Tip title="What are query parameters?">
              <p>They are small settings added to the end of the web address, like <span className="font-mono">?city=Paris&amp;units=metric</span>. You don’t type the <span className="font-mono">?</span> or <span className="font-mono">&amp;</span> — add one row per setting.</p>
              <p><b>Name</b> = the setting’s name (given in the API’s docs). <b>Value</b> = what you want it to be.</p>
              <p>Example: name <span className="font-mono">city</span>, value <span className="font-mono">Paris</span>.</p>
            </Tip></div>
          </div>
          <div><label className="label">Headers (extra labels sent with the request)</label>
            <KeyValueEditor value={cfg.headers || {}} onChange={(headers) => set({ headers })} keyPlaceholder="name  e.g. Accept" valuePlaceholder="value  e.g. application/json" addLabel="+ Add a header" />
            <div className="mt-1"><Tip title="What are headers? Do I need any?">
              <p>Usually <b>no</b>. Headers are behind-the-scenes notes sent with the request, like <span className="font-mono">Content-Type: application/json</span>. FlowForge adds the common ones for you.</p>
              <p>Passwords/keys go in <b>Authentication</b> below (safer), not here.</p>
              <p>Only add one if an API’s docs say “send header X: Y”. Name = <span className="font-mono">X</span>, Value = <span className="font-mono">Y</span>.</p>
            </Tip></div>
          </div>
          {!(simple && isX) && <div><label className="label">Authentication (saved login / API key)</label>
            <select className="input" value={cfg.credentialId || ''} onChange={(e) => set({ credentialId: e.target.value || undefined })}>
              <option value="">None</option>
              {creds.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.type})</option>)}
            </select>
            <div className="text-[11px] text-slate-500 mt-1">Add logins in the <b>Credentials</b> page, then pick one here.</div>
          </div>}
          {!simple && ['POST', 'PUT', 'PATCH'].includes((cfg.method || 'GET')) && (
            <div><label className="label">What to send</label>
              <BodyEditor cfg={cfg} set={set} upstream={upstream} />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={cfg.failOnErrorStatus !== false} onChange={(e) => set({ failOnErrorStatus: e.target.checked })} />
            Stop with an error if the website says it failed
          </label>
          </MoreOptions>
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
          <Tip title="What is a Condition? (examples)">
            <p>A Condition asks a yes/no question and sends the run down the <b>green</b> (yes) or <b>red</b> (no) path.</p>
            <p><b>Example:</b> only post big payments → Left <span className="font-mono">input.amount</span>, Operator “&gt; greater”, Right <span className="font-mono">1000</span>. Green → send alert. Red → do nothing.</p>
            <p><b>Example:</b> only continue if the website answered OK → Left <span className="font-mono">steps.http1.output.status</span>, “= equals”, Right <span className="font-mono">200</span>.</p>
          </Tip>
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
          <Tip title="Example: tell me when a YouTube channel posts">
            <p>⏰ Every 5 minutes → HTTP GET (latest video) → <b>Watch</b> the video id → green: post to Discord. Red: nothing.</p>
            <p>Nothing happens on the first check (it only remembers the latest video). When a <i>new</i> video appears, the green path runs once.</p>
          </Tip>
        </>
      )}

      {node.type === 'transform' && (
        <div><label className="label">Output mapping (value supports {'{{templates}}'})</label>
          <KeyValueEditor value={cfg.mapping || {}} onChange={(mapping) => set({ mapping })} keyPlaceholder="new name" valuePlaceholder="value or {{data}}" addLabel="+ Add a field" />
          <div className="mt-1"><Tip title="What is Transform for?">
            <p>It builds a tidy little bundle of data from earlier steps so later steps can use it easily.</p>
            <p><b>Example:</b> name = <span className="font-mono">{'New video: {{steps.fetch.output.body.title}}'}</span>. A later step can then use <span className="font-mono">{'{{steps.transform1.output.name}}'}</span>.</p>
            <p>It is also great as a “settings” step: put the things you must fill in (links, texts) in one place.</p>
          </Tip></div>
        </div>
      )}

      {node.type === 'delay' && (() => {
        const { n, unit } = msToParts(Number(cfg.ms ?? 0));
        const setDelay = (num: number, u: 'ms' | 's' | 'm' | 'h') => set({ ms: Math.max(0, Math.round(num * UNIT_MS[u])) });
        return (
          <>
            <div><label className="label">Wait for</label>
              <div className="flex gap-1">
                <input className="input flex-1 min-w-0" type="number" min={0} value={n} data-testid="delay-n" onChange={(e) => setDelay(Number(e.target.value), unit)} />
                <select className="input !w-28" value={unit} data-testid="delay-unit" onChange={(e) => setDelay(n, e.target.value as any)}>
                  <option value="ms">milliseconds</option><option value="s">seconds</option><option value="m">minutes</option><option value="h">hours</option>
                </select>
              </div>
            </div>
            <div>
              <label className="label">…or wait until a date &amp; time (optional)</label>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-1">
                <input className="input font-mono" placeholder="2026-10-23T19:50:00" value={cfg.until || ''} data-testid="delay-until" onChange={(e) => set({ until: e.target.value || undefined })} />
                <input className="input font-mono" placeholder="Asia/Kolkata" value={cfg.untilZone || ''} data-testid="delay-zone" onChange={(e) => set({ untilZone: e.target.value || undefined })} />
              </div>
              <div className="text-[11px] text-slate-500 mt-1">Date &amp; time, then the time-zone name. Waits up to 30 minutes; if the time is further away it carries on immediately.</div>
            </div>
            {!cfg.until && n * UNIT_MS[unit] > 120_000 && <div className="text-xs text-amber-300">⚠ Too long — a Delay waits at most 2 minutes, so this will be cut to 2 minutes. Use ⏰ Schedule for longer waits.</div>}
            <Tip title="When do I use Delay?" open>
              <p>It makes the workflow <b>pause</b>, then carry on with the next step.</p>
              <p><b>Example:</b> Trigger → Post “Starting soon!” → <b>Delay 10 minutes</b> → Post “We are live now!”.</p>
              <p><b>Example:</b> Create order → <b>Delay 30 seconds</b> → Check the order status (give the other system time to finish).</p>
              <p>Delay is “wait <i>after</i> this point”. To start a whole workflow at an exact clock time (e.g. 6:30 PM), use the ⏰ Schedule button in the top bar instead.</p>
              <p><b>Limit:</b> one Delay waits at most <b>2 minutes</b>. You can chain two Delays for 4 minutes, but for “in an hour” or “tomorrow 9 AM” use ⏰ Schedule → <i>Run once at a specific time</i>.</p>
            </Tip>
          </>
        );
      })()}

      <TestStep workflowId={workflowId} node={node as any} />

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
