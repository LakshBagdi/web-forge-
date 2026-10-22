import { useRef, useState } from 'react';
import KeyValueEditor from './KeyValueEditor';
import Tip from './Tip';

type Upstream = { id: string; label: string; type: string };
export const FORMATS = [
  { v: 'discord', l: 'Discord message' },
  { v: 'slack', l: 'Slack message' },
  { v: 'x', l: 'X (Twitter) post' },
  { v: 'other', l: 'Other app  (sends {"message": "…"})' },
];

/** Same rules as the server's buildMessageBody, so the preview matches what is really sent. */
export function previewBody(format: string, text: string) {
  switch (format) {
    case 'discord': return { content: text.length > 2000 ? text.slice(0, 1999) + '…' : text };
    case 'slack': return { text: text.replace(/(^|\s)@(channel|here|everyone)\b/g, (_m, pre, w) => `${pre}<!${w === 'everyone' ? 'channel' : w}>`) };
    case 'x': return { text };
    default: return { message: text };
  }
}

/** Effective mode: old workflows that already have a JSON body keep working in "Custom JSON". */
export function bodyModeOf(cfg: any): 'message' | 'fields' | 'json' {
  return cfg.bodyMode || (cfg.body !== undefined && cfg.body !== '' ? 'json' : 'message');
}

export default function BodyEditor({ cfg, set, upstream }: { cfg: any; set: (p: any) => void; upstream: Upstream[] }) {
  const mode = bodyModeOf(cfg);
  const format = cfg.messageFormat || 'discord';
  const msgRef = useRef<HTMLTextAreaElement>(null);
  const [userId, setUserId] = useState('');
  const [roleId, setRoleId] = useState('');

  const insert = (text: string) => {
    const el = msgRef.current;
    const cur: string = cfg.message || '';
    const a = el ? el.selectionStart : cur.length;
    const b = el ? el.selectionEnd : cur.length;
    const pad = a > 0 && !/\s$/.test(cur.slice(0, a)) && !text.startsWith('{{') ? ' ' : '';
    const next = cur.slice(0, a) + pad + text + cur.slice(b);
    set({ bodyMode: 'message', messageFormat: format, message: next });
    requestAnimationFrame(() => { el?.focus(); const pos = a + pad.length + text.length; el?.setSelectionRange(pos, pos); });
  };

  const dataOptions: { label: string; value: string }[] = [
    { label: 'Time the run started', value: '{{now.iso}}' },
    { label: 'Today’s date', value: '{{now.date}}' },
    { label: 'A field from the run input ({ } Input)', value: '{{input.name}}' },
  ];
  for (const u of upstream) {
    const name = u.label || u.id;
    if (u.type === 'http') {
      dataOptions.push({ label: `${name}: whole response`, value: `{{steps.${u.id}.output.body}}` });
      dataOptions.push({ label: `${name}: status code`, value: `{{steps.${u.id}.output.status}}` });
    } else if (u.type === 'watch') {
      dataOptions.push({ label: `${name}: the new value`, value: `{{steps.${u.id}.output.current}}` });
    } else if (u.type === 'transform') {
      dataOptions.push({ label: `${name}: its result`, value: `{{steps.${u.id}.output}}` });
    }
  }

  // Friendly view of any {{ }} pieces in the message: people should type plain words; automatic data is shown as chips.
  const knownIds = new Set(upstream.map((u) => u.id));
  const tokens: string[] = [...String(cfg.message || '').matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1]);
  const tokenOk = (t: string) => t === 'input' || t.startsWith('input.') || t.startsWith('now.') || (t.startsWith('steps.') && knownIds.has(t.split('.')[1]));
  const tokenName = (t: string) => {
    if (t === 'now.iso') return 'the time the run started';
    if (t.startsWith('now.')) return 'the date / time';
    if (t === 'input.message') return 'the message sent to the webhook';
    if (t.startsWith('input.')) return `run input “${t.slice(6)}”`;
    const m = t.match(/^steps\.([^.]+)\.output\.?(.*)$/);
    if (m) { const u = upstream.find((x) => x.id === m[1]); return `${u?.label || m[1]}${m[2] ? ' → ' + m[2].split('.').slice(-1)[0] : ''}`; }
    return t;
  };
  const badTokens = tokens.filter((t) => !tokenOk(t));
  const messageBody = previewBody(format, cfg.message || '');
  const fieldsBody = cfg.fields || {};

  return (
    <div className="space-y-2">
      <div className="flex rounded-md overflow-hidden border border-edge text-xs" role="tablist">
        {([['message', '✉ Message'], ['fields', '☰ Fields'], ['json', '{ } Custom JSON']] as const).map(([m, l]) => (
          <button key={m} role="tab" aria-selected={mode === m} data-testid={`bodymode-${m}`}
            className={`flex-1 py-1.5 ${mode === m ? 'bg-accent text-white' : 'bg-ink text-slate-300 hover:bg-edge'}`}
            onClick={() => set({ bodyMode: m })}>{l}</button>
        ))}
      </div>

      {mode === 'message' && (
        <>
          <div><label className="label">Send it to</label>
            <select className="input" value={format} onChange={(e) => set({ bodyMode: 'message', messageFormat: e.target.value })}>
              {FORMATS.map((f) => <option key={f.v} value={f.v}>{f.l}</option>)}
            </select>
          </div>
          <div><label className="label">Your message — just type it</label>
            <textarea ref={msgRef} className="input h-24" data-testid="message-text" value={cfg.message || ''} spellCheck
              placeholder="e.g. 🎬 New video is out! Check it now."
              onChange={(e) => set({ bodyMode: 'message', messageFormat: format, message: e.target.value })} />
            {tokens.length > 0 && badTokens.length === 0 && (
              <div className="mt-1 text-[11px] text-slate-400" data-testid="message-auto">
                Filled in automatically when it runs: {[...new Set(tokens)].map((t) => <span key={t} className="inline-block mr-1 mb-0.5 px-1.5 py-0.5 rounded bg-accent/15 text-blue-200" title={`{{${t}}}`}>{tokenName(t)}</span>)}
                <span className="block text-slate-500">The <span className="font-mono">{'{{ }}'}</span> parts are automatic — leave them as they are.</span>
              </div>
            )}
            {badTokens.length > 0 && (
              <div className="mt-1 text-[11px] text-amber-300 rounded border border-amber-500/30 bg-amber-500/10 p-1.5" data-testid="message-bad-token">
                ⚠ <span className="font-mono">{`{{${badTokens[0]}}}`}</span> is not data FlowForge has, so it would be sent as nothing. Just delete the curly braces and type normal words, or use <b>＋ Insert data</b>.
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1 items-center">
            <select className="input !w-auto text-xs py-1" value="" onChange={(e) => { if (e.target.value) insert(e.target.value); }} aria-label="insert data">
              <option value="">＋ Insert data…</option>
              {dataOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {(format === 'discord') && <>
              <button className="btn text-xs py-1" onClick={() => insert('@everyone')}>@everyone</button>
              <button className="btn text-xs py-1" onClick={() => insert('@here')}>@here</button>
            </>}
            {(format === 'slack') && <>
              <button className="btn text-xs py-1" onClick={() => insert('@channel')}>@channel</button>
              <button className="btn text-xs py-1" onClick={() => insert('@here')}>@here</button>
            </>}
          </div>
          {format === 'discord' && (
            <div className="space-y-1">
              <div className="flex gap-1"><input className="input flex-1 min-w-0 text-xs" placeholder="Person’s Discord user ID" value={userId} onChange={(e) => setUserId(e.target.value.replace(/\D/g, ''))} />
                <button className="btn text-xs" disabled={!userId} onClick={() => { insert(`<@${userId}>`); setUserId(''); }}>Tag person</button></div>
              <div className="flex gap-1"><input className="input flex-1 min-w-0 text-xs" placeholder="Role ID (to tag a whole role)" value={roleId} onChange={(e) => setRoleId(e.target.value.replace(/\D/g, ''))} />
                <button className="btn text-xs" disabled={!roleId} onClick={() => { insert(`<@&${roleId}>`); setRoleId(''); }}>Tag role</button></div>
              <Tip title="How do I tag someone on Discord?">
                <p><b>Everyone:</b> click <b>@everyone</b> (or <b>@here</b> for people online). FlowForge tells Discord mentions are allowed, so it really pings (members still need notifications on for that channel).</p>
                <p><b>One person:</b> Discord → Settings → Advanced → turn on <b>Developer Mode</b>. Then right-click the person → <b>Copy User ID</b> and paste it above. Roles: Server Settings → Roles → right-click the role → Copy Role ID.</p>
              </Tip>
            </div>
          )}
          {format === 'slack' && (
            <div className="space-y-1">
              <div className="flex gap-1"><input className="input flex-1 min-w-0 text-xs" placeholder="Person’s Slack member ID (U…)" value={userId} onChange={(e) => setUserId(e.target.value.trim())} />
                <button className="btn text-xs" disabled={!userId} onClick={() => { insert(`<@${userId}>`); setUserId(''); }}>Tag person</button></div>
              <Tip title="How do I tag someone on Slack?">
                <p><b>Everyone in the channel:</b> click <b>@channel</b> (or <b>@here</b>).</p>
                <p><b>One person:</b> in Slack open their profile → ⋮ → <b>Copy member ID</b> (looks like U02ABC123) and paste it above.</p>
              </Tip>
            </div>
          )}
          {format === 'x' && (
            <div className="space-y-1">
              <div className="flex gap-1"><input className="input flex-1 min-w-0 text-xs" placeholder="@username to mention" value={userId} onChange={(e) => setUserId(e.target.value.replace(/[^A-Za-z0-9_]/g, ''))} />
                <button className="btn text-xs" disabled={!userId} onClick={() => { insert(`@${userId}`); setUserId(''); }}>Tag person</button></div>
              <Tip title="X (Twitter) tips">
                <p>Just type <b>@username</b> anywhere in the text to mention someone. A post can be 280 characters at most. X refuses an identical post twice, so add <b>{'{{now.iso}}'}</b> from “Insert data” if you repeat it.</p>
              </Tip>
            </div>
          )}
          <details className="rounded border border-edge/70 p-2">
            <summary className="text-[11px] text-slate-500 cursor-pointer select-none">Technical details (optional)</summary>
            <pre className="mt-1 text-[11px] font-mono whitespace-pre-wrap break-all text-slate-300 max-h-32 overflow-y-auto">{JSON.stringify(messageBody, null, 2)}</pre>
          </details>
        </>
      )}

      {mode === 'fields' && (
        <>
          <p className="text-[11px] text-slate-400">Add the pieces of information to send, one per row. Example: name = <span className="font-mono">Asha</span>, plan = <span className="font-mono">pro</span>. Values can use <span className="font-mono">{'{{data}}'}</span> from earlier steps.</p>
          <KeyValueEditor value={fieldsBody} onChange={(fields) => set({ bodyMode: 'fields', fields })} keyPlaceholder="field name" valuePlaceholder="value" addLabel="+ Add a field" />
          <details className="rounded border border-edge/70 p-2">
            <summary className="text-[11px] text-slate-500 cursor-pointer select-none">Technical details (optional)</summary>
            <pre className="mt-1 text-[11px] font-mono whitespace-pre-wrap break-all text-slate-300 max-h-32 overflow-y-auto">{JSON.stringify(fieldsBody, null, 2)}</pre>
          </details>
        </>
      )}

      {mode === 'json' && (
        <>
          <textarea className="input font-mono h-32" value={typeof cfg.body === 'string' ? cfg.body : JSON.stringify(cfg.body ?? {}, null, 2)} spellCheck={false}
            onChange={(e) => set({ bodyMode: 'json', body: e.target.value, bodyType: 'json' })} />
          <Tip title="What is JSON?">
            <p>JSON is a way to write information as <span className="font-mono">{'{"name": "value"}'}</span>. You only need this when an API asks for an exact shape. For ordinary messages use <b>✉ Message</b> instead.</p>
            <p>You can put <span className="font-mono">{'{{input.name}}'}</span> or <span className="font-mono">{'{{steps.http1.output.body.id}}'}</span> inside the quotes.</p>
          </Tip>
        </>
      )}
    </div>
  );
}
