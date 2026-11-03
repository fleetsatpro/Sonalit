import { useState, useEffect, useCallback, useRef } from 'react';

/** Runs an async function, tracking loading/error state. */
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ data: null, loading: false, error: null });
  const run = useCallback(async (...args) => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn(...args);
      setState({ data, loading: false, error: null });
      return data;
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.response?.data?.error || err.message }));
      throw err;
    }
  }, deps);
  return { ...state, run };
}

/** Debounces a value by `delay` ms. */
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

/** Syncs state with localStorage. */
export function useLocalStorage(key, initial) {
  const [value, setValue] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key)) ?? initial; }
    catch { return initial; }
  });
  const set = (v) => {
    setValue(v);
    localStorage.setItem(key, JSON.stringify(v));
  };
  return [value, set];
}

/** Calls `fn` on every `ms` interval while component is mounted. */
export function useInterval(fn, ms) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; }, [fn]);
  useEffect(() => {
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** Returns true once the component has mounted (avoids SSR flash). */
export function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
