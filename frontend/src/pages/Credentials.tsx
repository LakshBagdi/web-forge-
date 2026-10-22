import { useEffect, useState } from 'react';
import { api } from '../api';

interface Cred { id: string; name: string; type: string; created_at: string; }
const TYPES = ['bearer', 'basic', 'api_key', 'header', 'oauth2'] as const;
const TYPE_LABEL: Record<string, string> = {
  bearer: 'Access token (Bearer)', basic: 'Username & password', api_key: 'API key', header: 'Custom header', oauth2: 'Login that renews itself (OAuth 2) — X, Google, YouTube',
};
const TYPE_HELP: Record<string, string> = {
  bearer: 'For services that give you one long “token” to paste. FlowForge sends it as “Authorization: Bearer …”.',
  basic: 'For services that want a username and password. Sent safely with each request.',
  api_key: 'For services that give you an “API key”. “header” is the name the service expects (the default x-api-key is common — check its docs).',
  header: 'Advanced: send any one header, e.g. name “X-Auth” and its value.',
  oauth2: '',
};
const FIELD_LABEL: Record<string, string> = {
  token: 'Token', username: 'Username', password: 'Password', header: 'Header name', key: 'API key', name: 'Header name', value: 'Header value',
  token_url: 'Token URL', client_id: 'Client ID', client_secret: 'Client secret', refresh_token: 'Refresh token', scope: 'Scope', client_auth: 'How to send the client secret',
};

export default function Credentials() {
  const [creds, setCreds] = useState<Cred[]>([]);
  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof TYPES)[number]>('bearer');
  const [fields, setFields] = useState<Record<string, string>>({ token: '' });
  const [err, setErr] = useState('');
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const redirectUrl = `${window.location.origin}/api/oauth/callback`;
  useEffect(() => {
    // coming back from Google / X after pressing Allow
    const q = new URLSearchParams(window.location.search);
    if (q.get('connected')) setBanner({ ok: true, text: `✓ Connected! “${q.get('connected')}” is saved. Pick it under Authentication on your step.` });
    else if (q.get('oauth_error')) setBanner({ ok: false, text: q.get('oauth_error')! });
    if (q.get('connected') || q.get('oauth_error')) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  const load = () => api.get('/credentials').then((d) => setCreds(d.credentials));
  useEffect(() => { load(); }, []);

  const fieldSpec: Record<string, string[]> = {
    bearer: ['token'], basic: ['username', 'password'], api_key: ['header', 'key'], header: ['name', 'value'],
    oauth2: ['token_url', 'client_id', 'client_secret', 'refresh_token', 'scope', 'client_auth'],
  };
  const SECRET = ['token', 'password', 'key', 'value', 'client_secret', 'refresh_token'];
  const PRESETS: Record<string, Record<string, string>> = {
    google: { token_url: 'https://oauth2.googleapis.com/token', client_auth: 'body' },
    x: { token_url: 'https://api.twitter.com/2/oauth2/token', client_auth: 'basic' },
  };
  const changeType = (t: (typeof TYPES)[number]) => {
    setType(t);
    setFields(Object.fromEntries(fieldSpec[t].map((f) => [f, f === 'header' ? 'x-api-key' : ''])));
  };

  const create = async () => {
    setErr('');
    const missing = fieldSpec[type].filter((f) => !['scope', 'client_auth'].includes(f) && !(fields[f] ?? '').trim());
    if (missing.length) { setErr(`Please fill in: ${missing.map((f) => FIELD_LABEL[f] || f).join(', ')}`); return; }
    try {
      await api.post('/credentials', { name, type, data: fields });
      setName(''); setFields(Object.fromEntries(fieldSpec[type].map((f) => [f, ''])));
      load();
    } catch (e: any) { setErr(e.message); }
  };
  const connect = async (provider: 'google' | 'x') => {
    setErr('');
    if (!name.trim()) { setErr('Give it a name first, e.g. “My Google”.'); return; }
    if (!(fields.client_id ?? '').trim() || !(fields.client_secret ?? '').trim()) { setErr('Paste your Client ID and Client secret first (from your Google / X developer page).'); return; }
    try {
      const r = await api.post('/oauth/start', { provider, name: name.trim(), client_id: fields.client_id.trim(), client_secret: fields.client_secret.trim(), scope: (fields.scope || '').trim() || undefined, redirectBase: window.location.origin });
      window.location.href = r.authUrl;
    } catch (e: any) { setErr(e.message); }
  };
  const copyRedirect = async () => { try { await navigator.clipboard.writeText(redirectUrl); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ } };
  const remove = async (id: string) => { if (!confirm('Delete this saved login? Steps that use it will stop working until you pick another.')) return; await api.del(`/credentials/${id}`); load(); };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-1">Credentials</h1>
      <p className="text-slate-400 text-sm mb-6">Keys and passwords you save here are encrypted and never shown again. Steps use them behind the scenes — pick one under <b>Authentication</b> on an HTTP step.</p>

      {banner && <div className={`mb-4 rounded-md border p-3 text-sm ${banner.ok ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border-red-500/40 bg-red-500/10 text-red-200'}`} data-testid="oauth-banner">{banner.text}</div>}
      <div className="card p-4 mb-6 space-y-3">
        <div className="flex gap-2">
          <div className="flex-1"><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. My X account" /></div>
          <div className="w-72"><label className="label">What kind of login?</label>
            <select className="input" value={type} onChange={(e) => changeType(e.target.value as any)}>
              {TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </div>
        </div>
        {TYPE_HELP[type] && <div className="text-xs text-slate-400">{TYPE_HELP[type]}</div>}
        {type === 'oauth2' ? (
          <div className="space-y-3">
            <div className="text-xs text-slate-400">You bring your own Google / X app (like n8n). Steps: <b>1)</b> copy the address below into your app’s “redirect / callback URL”. <b>2)</b> paste its Client ID and secret here. <b>3)</b> press <b>Connect</b> and click Allow.</div>
            <div>
              <label className="label">Redirect address — add this exactly in Google Cloud (Authorized redirect URIs) or the X app (Callback URL)</label>
              <div className="flex gap-2">
                <input className="input font-mono text-xs" readOnly value={redirectUrl} onFocus={(e) => e.currentTarget.select()} data-testid="redirect-url" />
                <button type="button" className="btn shrink-0" onClick={copyRedirect}>{copied ? 'Copied ✓' : 'Copy'}</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
              {['client_id', 'client_secret', 'scope'].map((f) => (
                <div key={f} className={f === 'scope' ? 'col-span-2' : ''}><label className="label">{FIELD_LABEL[f]}{f === 'scope' ? ' (optional — leave empty to use the usual one)' : ''}</label>
                  <input className="input" data-testid={`oauth-${f}`} type={SECRET.includes(f) ? 'password' : 'text'} autoComplete="off" value={fields[f] ?? ''} onChange={(e) => setFields({ ...fields, [f]: e.target.value })} />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary" data-testid="connect-google" onClick={() => connect('google')}>Connect with Google</button>
              <button type="button" className="btn btn-primary" data-testid="connect-x" onClick={() => connect('x')}>Connect with X</button>
            </div>
            <details data-testid="oauth-advanced" className="rounded border border-edge/70 p-2">
              <summary className="text-xs text-slate-400 cursor-pointer select-none">Advanced: paste a refresh token yourself instead</summary>
              <div className="mt-2 space-y-2">
                <div className="text-xs text-slate-400 flex gap-1">Fill token URL for: <button className="text-accent" onClick={() => setFields({ ...fields, ...PRESETS.google })}>Google</button> · <button className="text-accent" onClick={() => setFields({ ...fields, ...PRESETS.x })}>X</button></div>
                <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
                  {['token_url', 'refresh_token', 'client_auth'].map((f) => (
                    <div key={f}><label className="label">{FIELD_LABEL[f]}{f === 'client_auth' ? ' (body or basic — X needs basic)' : ''}</label>
                      <input className="input" data-testid={`oauth-${f}`} type={SECRET.includes(f) ? 'password' : 'text'} autoComplete="off" value={fields[f] ?? ''} onChange={(e) => setFields({ ...fields, [f]: e.target.value })} />
                    </div>
                  ))}
                </div>
                <button className="btn" disabled={!name} onClick={create}>Save credential</button>
              </div>
            </details>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
            {fieldSpec[type].map((f) => (
              <div key={f}><label className="label">{FIELD_LABEL[f] || f}</label>
                <input className="input" type={SECRET.includes(f) ? 'password' : 'text'} autoComplete="off" value={fields[f] ?? ''} onChange={(e) => setFields({ ...fields, [f]: e.target.value })} />
              </div>
            ))}
          </div>
        )}
        {err && <div className="text-red-400 text-sm">{err}</div>}
        {type !== 'oauth2' && <button className="btn btn-primary" disabled={!name} onClick={create}>Save credential</button>}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {creds.map((c) => (
          <div key={c.id} className="card p-3 flex items-center gap-3">
            <span className="font-semibold truncate min-w-0">{c.name}</span>
            <span className="badge bg-edge text-slate-300">{TYPE_LABEL[c.type]?.split(' —')[0] || c.type}</span>
            <span className="ml-auto text-xs text-slate-500">{new Date(c.created_at).toLocaleDateString()}</span>
            <button className="btn btn-danger" onClick={() => remove(c.id)}>Delete</button>
          </div>
        ))}
        {creds.length === 0 && <div className="text-slate-500 text-sm">No saved logins yet. You only need one for services that ask for a key or login (X, Google…). Discord and Slack webhook links need none.</div>}
      </div>
    </div>
  );
}
