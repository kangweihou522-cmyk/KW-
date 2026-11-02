import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Portalled so menus remain usable in the scrollable paper list, including its last row. */
export function LibraryPopover({ anchor, label, onClose, children, width = 288 }: {
  anchor: HTMLElement; label: string; onClose: () => void; children: ReactNode; width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const height = ref.current?.getBoundingClientRect().height || 320;
      const column = anchor.closest('[data-tour="paper-list"]')?.getBoundingClientRect();
      const minLeft = column && column.width >= width + 16 ? column.left + 8 : 8;
      const maxLeft = column && column.width >= width + 16 ? column.right - width - 8 : window.innerWidth - width - 8;
      setPosition({
        left: Math.max(minLeft, Math.min(rect.left, maxLeft)),
        top: Math.max(8, Math.min(rect.bottom + 6, window.innerHeight - height - 8)),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [anchor, width]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node) && !anchor.contains(event.target as Node)) onClose();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); anchor.focus(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    ref.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [anchor, onClose]);
  return createPortal(<div ref={ref} role="dialog" aria-label={label} className="pq-saas-scope fixed z-[160] max-h-[calc(100vh-16px)] overflow-y-auto rounded-xl border border-[var(--pq-border)] bg-[var(--pq-surface-1)] p-3 text-[var(--pq-text)] shadow-xl" style={{ ...position, width: `min(${width}px, calc(100vw - 16px))` }} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>{children}</div>, document.body);
}
