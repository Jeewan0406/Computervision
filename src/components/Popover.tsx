import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/** A floating panel anchored to a button. Flips above when there is no room
 * below and stays inside the window on small screens. */
export function Popover({
  anchor,
  open,
  onClose,
  children,
  width = 360,
  align = 'start',
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  width?: number;
  align?: 'start' | 'end';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number; w: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      if (!a) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const w = Math.min(width, vw - 16);
      let left = align === 'end' ? a.right - w : a.left;
      left = Math.max(8, Math.min(left, vw - w - 8));
      const below = vh - a.bottom - 12;
      const above = a.top - 12;
      const h = ref.current?.scrollHeight ?? 400;
      if (below >= Math.min(h, 320) || below >= above) {
        setPos({ top: a.bottom + 6, left, maxH: Math.max(160, below), w });
      } else {
        const maxH = Math.max(160, above);
        setPos({ top: Math.max(8, a.top - 6 - Math.min(h, maxH)), left, maxH, w });
      }
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, anchor, width, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      className="popover"
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, width: pos?.w ?? width, maxHeight: pos?.maxH }}
      role="dialog"
    >
      {children}
    </div>,
    document.body,
  );
}
