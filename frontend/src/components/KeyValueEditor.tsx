/** Rows of "name = value". Used for query parameters, headers, fields and mappings. */
export default function KeyValueEditor({ value, onChange, keyPlaceholder = 'name', valuePlaceholder = 'value', addLabel = '+ Add' }:
  { value: Record<string, string>; onChange: (v: Record<string, string>) => void; keyPlaceholder?: string; valuePlaceholder?: string; addLabel?: string }) {
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
          <input className="input flex-1 min-w-0" value={k} placeholder={keyPlaceholder} onChange={(e) => update(i, e.target.value, v)} />
          <input className="input flex-1 min-w-0" value={v} placeholder={valuePlaceholder} onChange={(e) => update(i, k, e.target.value)} />
          <button className="btn px-2" title="Remove this row" onClick={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))}>✕</button>
        </div>
      ))}
      <button className="btn w-full justify-center text-xs" onClick={() => onChange({ ...value, '': '' })}>{addLabel}</button>
    </div>
  );
}
