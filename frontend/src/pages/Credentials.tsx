import { useEffect, useState } from 'react';
import { api } from '../api';

interface Cred { id: string; name: string; type: string; created_at: string; }
const TYPES = ['bearer', 'basic', 'api_key', 'header', 'oauth2'] as const;

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
    oauth2: ['token_url', 'client_id', 'client_secret', 'refresh_token', 'scope'],
  };
  const SECRET = ['token', 'password', 'key', 'value', 'client_secret', 'refresh_token'];
  const PRESETS: Record<string, Record<string, string>> = {
    google: { token_url: 'https://oauth2.googleapis.com/token', scope: '' },
    x: { token_url: 'https://api.twitter.com/2/oauth2/token', scope: '' },
  };
  const changeType = (t: (typeof TYPES)[number]) => {
    setType(t);
    setFields(Object.fromEntries(fieldSpec[t].map((f) => [f, f === 'header' ? 'x-api-key' : ''])));
  };

  const create = async () => {
    setErr('');
    try {
      await api.post('/credentials', { name, type, data: fields });
      setName(''); setFields(Object.fromEntries(fieldSpec[type].map((f) => [f, ''])));
      load();
    } catch (e: any) { setErr(e.message); }
  };
  const remove = async (id: string) => { await api.del(`/credentials/${id}`); load(); };

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-1">Credentials</h1>
      <p className="text-slate-400 text-sm mb-6">Secrets are encrypted (AES-256-GCM) at rest and never sent back to the browser — HTTP nodes inject them only at execution time.</p>

      <div className="card p-4 mb-6 space-y-3">
        <div className="flex gap-2">
          <div className="flex-1"><label className="label">Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Stripe key" /></div>
          <div className="w-40"><label className="label">Type</label>
            <select className="input" value={type} onChange={(e) => changeType(e.target.value as any)}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        {type === 'oauth2' && (
          <div className="text-xs text-slate-400 space-y-1">
            <div>Keeps Google / YouTube / X (Twitter) / Microsoft logins working: FlowForge swaps your long-lived <b>refresh token</b> for a fresh access token on every run.</div>
            <div className="flex gap-1">Fill token URL for: <button className="text-accent" onClick={() => setFields({ ...fields, ...PRESETS.google })}>Google</button> · <button className="text-accent" onClick={() => setFields({ ...fields, ...PRESETS.x })}>X</button></div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {fieldSpec[type].map((f) => (
            <div key={f}><label className="label">{f}</label>
              <input className="input" type={SECRET.includes(f) ? 'password' : 'text'} autoComplete="off" value={fields[f] ?? ''} onChange={(e) => setFields({ ...fields, [f]: e.target.value })} />
            </div>
          ))}
        </div>
        {err && <div className="text-red-400 text-sm">{err}</div>}
        <button className="btn btn-primary" disabled={!name} onClick={create}>Save credential</button>
      </div>

      <div className="grid gap-2">
        {creds.map((c) => (
          <div key={c.id} className="card p-3 flex items-center gap-3">
            <span className="font-semibold">{c.name}</span>
            <span className="badge bg-edge text-slate-300">{c.type}</span>
            <span className="ml-auto text-xs text-slate-500">{new Date(c.created_at).toLocaleDateString()}</span>
            <button className="btn btn-danger" onClick={() => remove(c.id)}>Delete</button>
          </div>
        ))}
        {creds.length === 0 && <div className="text-slate-500 text-sm">No credentials yet.</div>}
      </div>
    </div>
  );
}
