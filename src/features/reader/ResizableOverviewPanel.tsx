import { useEffect, useRef, useState, type ReactNode } from 'react';

/** A persistent, independently scrolling overview with a visible bottom drag handle. */
export function ResizableOverviewPanel({ name, label, children, initialHeight = 380 }: {
  name: 'personal' | 'ai'; label: string; children: ReactNode; initialHeight?: number;
}) {
  const key = `paperdesk:overview-height:v1:${name}`;
  const [height, setHeight] = useState(() => {
    try { const saved = Number(localStorage.getItem(key)); return Number.isFinite(saved) && saved >= 120 ? saved : initialHeight; }
    catch { return initialHeight; }
  });
  const [resizing, setResizing] = useState(false);
  const start = useRef({ y: 0, height: 0 });
  useEffect(() => {
    try { localStorage.setItem(key, String(Math.round(height))); } catch { /* Layout remains usable without persistence. */ }
  }, [key, height]);
  useEffect(() => {
    if (!resizing) return;
    const previousCursor = document.body.style.cursor;
    const previousSelect = document.body.style.userSelect;
    document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none';
    const move = (event: PointerEvent) => setHeight(Math.max(120, Math.round(start.current.height + event.clientY - start.current.y)));
    const stop = () => setResizing(false);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
    return () => {
      document.body.style.cursor = previousCursor; document.body.style.userSelect = previousSelect;
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop);
    };
  }, [resizing]);
  return <div data-resizable-overview={name} className="flex min-w-0 flex-col" style={{ height }}>
    <div data-wheel-scroll-target className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain">{children}</div>
    <div role="separator" tabIndex={0} aria-label={`调整${label}高度`} aria-orientation="horizontal" aria-valuemin={120} aria-valuenow={height}
      title="上下拖动调整高度，双击恢复；也可使用上下方向键"
      className={`group flex h-4 shrink-0 cursor-row-resize touch-none items-center justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--pq-accent)] ${resizing ? 'bg-[var(--pq-accent-soft)]' : 'hover:bg-[var(--pq-accent-soft)]'}`}
      onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); start.current = { y: event.clientY, height }; setResizing(true); }}
      onDoubleClick={() => setHeight(initialHeight)}
      onKeyDown={event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setHeight(current => Math.max(120, current + (event.key === 'ArrowUp' ? -24 : 24))); } else if (event.key === 'Home') { event.preventDefault(); setHeight(initialHeight); } }}>
      <span className="h-1 w-12 rounded bg-[var(--pq-border)] group-hover:bg-[var(--pq-accent)]" />
    </div>
  </div>;
}
