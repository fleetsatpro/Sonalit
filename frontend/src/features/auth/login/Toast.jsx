import { useEffect, useRef, useState } from 'react';

// Small custom toast so login can style it into the ops-wall aesthetic without
// pulling react-hot-toast's default chrome onto this route. Fire via the
// exposed imperative handle from useLoginToast() below.
export function useLoginToast() {
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState(false);
  const [show, setShow] = useState(false);
  const timer = useRef(null);

  function fire(message, isError = false) {
    setMsg(message);
    setErr(!!isError);
    setShow(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(false), 3200);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  return { toastProps: { msg, err, show }, fire };
}

export default function Toast({ msg, err, show }) {
  return (
    <div
      className={'toast' + (show ? ' show' : '') + (err ? ' err' : '')}
      role="status"
      aria-live="polite"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5M12 16v.01" strokeLinecap="round" />
      </svg>
      <span>{msg}</span>
    </div>
  );
}
