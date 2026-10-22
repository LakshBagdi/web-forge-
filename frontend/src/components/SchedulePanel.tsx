import { useEffect, useState } from 'react';
import { api } from '../api';

interface Schedule { id: string; cron: string; enabled: boolean; created_at: string; }

const PRESETS = [
  { label: 'Every minute', cron: '* * * * *' },
  { label: 'Every 5 minutes', cron: '*/5 * * * *' },
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Daily 09:00', cron: '0 9 * * *' },
];

export default function SchedulePanel({ workflowId, onClose }: { workflowId: string; onClose: () => void }) {
  const [items, setItems] = useState<Schedule[]>([]);
  const [cron, setCron] = useState('*/5 * * * *');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/schedules/workflow/${workflowId}`).then((d) => setItems(d.schedules));
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [workflowId]);

  const add = async () => {
    setErr(''); setBusy(true);
    try {
      await api.post(`/schedules/workflow/${workflowId}`, { cron: cron.trim() });
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
        Runs the saved workflow automatically on a cron schedule (server time, UTC on most hosts). Each fire creates a normal run you can open in History.
      </p>
      <div>
        <label className="label">Cron expression (minute hour day month weekday)</label>
        <input className="input font-mono" value={cron} onChange={(e) => setCron(e.target.value)} />
        <div className="flex flex-wrap gap-1 mt-2">
          {PRESETS.map((p) => (
            <button key={p.cron} className="btn text-xs" onClick={() => setCron(p.cron)}>{p.label}</button>
          ))}
        </div>
      </div>
      {err && <div className="text-red-400 text-sm">{err}</div>}
      <button className="btn btn-primary w-full justify-center" disabled={busy || !cron.trim()} onClick={add}>
        {busy ? 'Adding…' : '+ Add schedule'}
      </button>
      <div className="space-y-2 pt-2">
        {items.map((s) => (
          <div key={s.id} className="card p-3 flex items-center gap-2">
            <span className="font-mono text-sm">{s.cron}</span>
            <span className="badge bg-emerald-500/20 text-emerald-300">{s.enabled ? 'active' : 'paused'}</span>
            <button className="btn btn-danger ml-auto text-xs" onClick={() => remove(s.id)}>Delete</button>
          </div>
        ))}
        {items.length === 0 && <div className="text-sm text-slate-500">No schedules yet.</div>}
      </div>
    </div>
  );
}
