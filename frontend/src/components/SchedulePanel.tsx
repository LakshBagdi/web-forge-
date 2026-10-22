import { useEffect, useState } from 'react';
import { api } from '../api';

interface Schedule { id: string; cron: string | null; tz: string; run_at: string | null; fired_at: string | null; enabled: boolean; created_at: string; }

const PRESETS = [
  { label: 'Every minute', cron: '* * * * *' },
  { label: 'Every 5 min', cron: '*/5 * * * *' },
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Daily 09:00', cron: '0 9 * * *' },
  { label: 'Weekdays 09:00', cron: '0 9 * * 1-5' },
];

const browserTz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();

/** <input type=datetime-local> value for "now + minutes", in the browser's local time. */
function localInput(minutesAhead: number) {
  const d = new Date(Date.now() + minutesAhead * 60_000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SchedulePanel({ workflowId, onClose }: { workflowId: string; onClose: () => void }) {
  const [items, setItems] = useState<Schedule[]>([]);
  const [mode, setMode] = useState<'repeat' | 'once'>('repeat');
  const [cron, setCron] = useState('*/5 * * * *');
  const [when, setWhen] = useState(() => localInput(10));
  const [tz, setTz] = useState(browserTz);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/schedules/workflow/${workflowId}`).then((d) => setItems(d.schedules));
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [workflowId]);

  const add = async () => {
    setErr(''); setBusy(true);
    try {
      if (mode === 'repeat') {
        await api.post(`/schedules/workflow/${workflowId}`, { cron: cron.trim(), tz });
      } else {
        // datetime-local has no zone: interpret it as the BROWSER's local time.
        const at = new Date(when);
        if (Number.isNaN(at.getTime())) throw new Error('Pick a date and time');
        await api.post(`/schedules/workflow/${workflowId}`, { runAt: at.toISOString(), tz });
      }
      await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const remove = async (id: string) => { await api.del(`/schedules/${id}`); load(); };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center">
        <div className="font-semibold">Scheduled runs</div>
        <button className="btn ml-auto px-2" onClick={onClose}>✕</button>
      </div>
      <p className="text-xs text-slate-400">
        Run the <b>saved</b> workflow automatically — repeatedly, or once at an exact date and time. Each fire is a normal run you can open in History.
      </p>
      <div className="flex gap-1">
        <button className={`btn flex-1 justify-center ${mode === 'repeat' ? 'btn-primary' : ''}`} onClick={() => setMode('repeat')}>🔁 Repeat</button>
        <button className={`btn flex-1 justify-center ${mode === 'once' ? 'btn-primary' : ''}`} onClick={() => setMode('once')}>📌 Run once</button>
      </div>

      {mode === 'repeat' ? (
        <div>
          <label className="label">Cron expression (minute hour day month weekday)</label>
          <input className="input font-mono" aria-label="cron" value={cron} onChange={(e) => setCron(e.target.value)} />
          <div className="flex flex-wrap gap-1 mt-2">
            {PRESETS.map((p) => (
              <button key={p.cron} className="btn text-xs" onClick={() => setCron(p.cron)}>{p.label}</button>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <label className="label">Date and time</label>
          <input className="input" type="datetime-local" aria-label="run at" value={when} onChange={(e) => setWhen(e.target.value)} />
          <div className="flex gap-1 mt-2">
            {[[5, '+5 min'], [60, '+1 hour'], [1440, 'Tomorrow']].map(([m, l]) => (
              <button key={String(l)} className="btn text-xs" onClick={() => setWhen(localInput(Number(m)))}>{l}</button>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="label">Time zone</label>
        <input className="input" aria-label="time zone" list="ff-tz" value={tz} onChange={(e) => setTz(e.target.value)} />
        <datalist id="ff-tz">
          {['UTC', browserTz, 'Asia/Kolkata', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Australia/Sydney']
            .filter((v, i, a) => a.indexOf(v) === i).map((z) => <option key={z} value={z} />)}
        </datalist>
        <p className="text-[11px] text-slate-500 mt-1">
          {mode === 'repeat' ? `“Daily 09:00” means 09:00 in ${tz || 'this zone'}.` : 'The time above is read in your browser’s zone, so it fires at that exact moment everywhere.'}
        </p>
      </div>

      {err && <div className="text-red-400 text-sm">{err}</div>}
      <button className="btn btn-primary w-full justify-center" disabled={busy || (mode === 'repeat' ? !cron.trim() : !when)} onClick={add}>
        {busy ? 'Adding…' : mode === 'repeat' ? '+ Add repeating schedule' : '+ Schedule one run'}
      </button>

      <div className="space-y-2 pt-2">
        {items.map((s) => {
          const once = !!s.run_at;
          const state = once ? (s.fired_at ? 'ran' : s.enabled ? 'waiting' : 'missed') : (s.enabled ? 'active' : 'paused');
          const color = state === 'ran' ? 'bg-slate-500/20 text-slate-300' : state === 'missed' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300';
          return (
            <div key={s.id} className="card p-3 flex items-center gap-2" data-testid="schedule-item">
              <div className="min-w-0">
                {once
                  ? <div className="text-sm">📌 {new Date(s.run_at!).toLocaleString()}</div>
                  : <div className="font-mono text-sm">{s.cron}</div>}
                <div className="text-[11px] text-slate-500">{once ? 'one time' : `repeats · ${s.tz}`}</div>
              </div>
              <span className={`badge ${color}`}>{state}</span>
              <button className="btn btn-danger ml-auto text-xs" onClick={() => remove(s.id)}>Delete</button>
            </div>
          );
        })}
        {items.length === 0 && <div className="text-sm text-slate-500">No schedules yet.</div>}
      </div>
    </div>
  );
}
