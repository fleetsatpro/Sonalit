import { useEffect, useRef } from 'react';

// Escape-to-close, focus-trap on Tab/Shift-Tab, focus-restore on close.
// Backdrop click-to-close is handled at the render site (onClick on backdrop).
export function useModal(open, onClose) {
  const rootRef = useRef(null);
  const lastFocused = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    lastFocused.current = document.activeElement;
    const root = rootRef.current;
    if (!root) return undefined;

    const focusable = () =>
      Array.from(
        root.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.disabled && el.offsetParent !== null);

    const f = focusable();
    if (f.length) f[0].focus();

    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const list = focusable();
      if (!list.length) return;
      const first = list[0];
      const last  = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    };

    root.addEventListener('keydown', onKey);
    return () => {
      root.removeEventListener('keydown', onKey);
      // Focus restore — but only if the previously-focused element is still
      // in the DOM (e.g. it may have been removed on route unmount).
      const prev = lastFocused.current;
      if (prev && document.body.contains(prev) && typeof prev.focus === 'function') {
        prev.focus();
      }
    };
  }, [open, onClose]);

  return rootRef;
}
