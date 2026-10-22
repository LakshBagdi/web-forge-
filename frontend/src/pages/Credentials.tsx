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
  const remove = async (id: string) => { if (!confirm('Delete this saved login? Steps that use it will stop working until you pick another.')) return; await api.del(`/credentials/${id}`); load(); };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-1">Credentials</h1>
      <p className="text-slate-400 text-sm mb-6">Keys and passwords you save here are encrypted and never shown again. Steps use them behind the scenes — pick one under <b>Authentication</b> on an HTTP step.</p>

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
        {type === 'oauth2' && (
          <div className="text-xs text-slate-400 space-y-1">
            <div>Keeps Google / YouTube / X (Twitter) / Microsoft logins working: FlowForge swaps your long-lived <b>refresh token</b> for a fresh access token on every run.</div>
            <div className="flex gap-1">Fill token URL for: <button className="text-accent" onClick={() => setFields({ ...fields, ...PRESETS.google })}>Google</button> · <button className="text-accent" onClick={() => setFields({ ...fields, ...PRESETS.x })}>X</button></div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
          {fieldSpec[type].map((f) => (
            <div key={f}><label className="label">{FIELD_LABEL[f] || f}{f === 'client_auth' ? ' (body or basic — X needs basic)' : f === 'scope' ? ' (optional)' : ''}</label>
              <input className="input" type={SECRET.includes(f) ? 'password' : 'text'} autoComplete="off" value={fields[f] ?? ''} onChange={(e) => setFields({ ...fields, [f]: e.target.value })} />
            </div>
          ))}
        </div>
        {err && <div className="text-red-400 text-sm">{err}</div>}
        <button className="btn btn-primary" disabled={!name} onClick={create}>Save credential</button>
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
