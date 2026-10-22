import { ReactNode } from 'react';

/** Small collapsible "what is this?" help box. */
export default function Tip({ title, children, open = false }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="text-[11px] leading-relaxed text-slate-400 rounded border border-edge/70 px-2 py-1">
      <summary className="cursor-pointer text-slate-300 select-none">💡 {title}</summary>
      <div className="mt-1 space-y-1">{children}</div>
    </details>
  );
}
