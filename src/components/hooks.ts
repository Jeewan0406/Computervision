import { useEffect, useRef } from 'react';

/** Keeps a scroll box pinned to the bottom while content streams in,
 * unless the reader has scrolled up to read something. */
export function useAutoScroll<T extends HTMLElement>(dep: unknown, enabled = true) {
  const ref = useRef<T>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current && enabled) el.scrollTop = el.scrollHeight;
  }, [dep, enabled]);
  const toBottom = () => {
    const el = ref.current;
    if (el) {
      stick.current = true;
      el.scrollTop = el.scrollHeight;
    }
  };
  return { ref, toBottom };
}
