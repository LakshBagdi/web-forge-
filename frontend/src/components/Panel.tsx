import { ReactNode, useEffect, useRef, useState } from 'react';

function read(key: string, fallback: number) {
  try { const v = Number(localStorage.getItem(key)); return Number.isFinite(v) && v > 0 ? v : fallback; } catch { return fallback; }
}
function readBool(key: string, fallback = false) { try { const v = localStorage.getItem(key); return v === null ? fallback : v === '1'; } catch { return fallback; } }

/**
 * A side panel you can drag wider/narrower (drag the thin bar on its inner edge; double-click it to reset)
 * and collapse to a slim strip. It always scrolls when its content is taller than the window.
 * Width and collapsed state are remembered per `storageKey`.
 */
export default function Panel({ side, storageKey, defaultWidth, min = 160, max = 720, title, noScroll = false, defaultCollapsed = false, children }:
  { side: 'left' | 'right'; storageKey: string; defaultWidth: number; defaultCollapsed?: boolean; min?: number; max?: number; title: string; noScroll?: boolean; children: ReactNode }) {
  const [width, setWidth] = useState(() => Math.min(max, Math.max(min, read(`ff_w_${storageKey}`, defaultWidth))));
  const [collapsed, setCollapsed] = useState(() => readBool(`ff_c_${storageKey}`, defaultCollapsed));
  const drag = useRef<{ x: number; w: number } | null>(null);

  useEffect(() => { try { localStorage.setItem(`ff_w_${storageKey}`, String(width)); } catch { /* storage blocked */ } }, [width, storageKey]);
  useEffect(() => { try { localStorage.setItem(`ff_c_${storageKey}`, collapsed ? '1' : '0'); } catch { /* storage blocked */ } }, [collapsed, storageKey]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!drag.current) return;
      const dx = e.clientX - drag.current.x;
      const w = side === 'left' ? drag.current.w + dx : drag.current.w - dx;
      setWidth(Math.min(max, Math.max(min, w)));
    };
    const up = () => { if (drag.current) { drag.current = null; document.body.style.userSelect = ''; document.body.style.cursor = ''; } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [side, min, max]);

  const border = side === 'left' ? 'border-r' : 'border-l';
  const arrowOpen = side === 'left' ? '«' : '»';
  const arrowClosed = side === 'left' ? '»' : '«';

  if (collapsed) {
    return (
      <div className={`w-8 shrink-0 ${border} border-edge bg-panel flex flex-col items-center py-2 gap-3`} data-testid={`panel-${storageKey}-collapsed`}>
        <button className="btn px-1.5 py-1" title={`Show ${title}`} onClick={() => setCollapsed(false)}>{arrowClosed}</button>
        <div className="text-[11px] text-slate-500 [writing-mode:vertical-rl] rotate-180 select-none">{title}</div>
      </div>
    );
  }
  return (
    <div style={{ width }} className={`relative shrink-0 ${border} border-edge bg-panel flex flex-col min-h-0`} data-testid={`panel-${storageKey}`}>
      <div className="flex items-center px-2 py-1 border-b border-edge/60 text-[11px] text-slate-500 select-none">
        <span>{title}</span>
        <button className="ml-auto px-1.5 rounded hover:bg-edge text-slate-400" title="Collapse" onClick={() => setCollapsed(true)}>{arrowOpen}</button>
      </div>
      <div className={noScroll ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden'}>{children}</div>
      <div
        role="separator" aria-orientation="vertical" title="Drag to resize · double-click to reset" data-testid={`resize-${storageKey}`}
        onPointerDown={(e) => { drag.current = { x: e.clientX, w: width }; document.body.style.userSelect = 'none'; document.body.style.cursor = 'col-resize'; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
        onDoubleClick={() => setWidth(defaultWidth)}
        className={`absolute top-0 bottom-0 w-1.5 z-20 cursor-col-resize hover:bg-accent/60 active:bg-accent ${side === 'left' ? '-right-0.5' : '-left-0.5'}`}
      />
    </div>
  );
}
