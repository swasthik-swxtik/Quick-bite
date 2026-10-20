import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * useFlash — a transient success/error banner that clears itself.
 *
 * Used by the admin panels to confirm what the server did ("Outlet "X" created.")
 * without leaving a stale message on screen. `id` changes on every call so React
 * remounts the banner and its entrance animation replays.
 *
 * @param {number} timeout - milliseconds to keep the message visible
 */
export const useFlash = (timeout = 5000) => {
  const [flash, setFlash] = useState(null);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  const show = useCallback(
    (kind, message) => {
      setFlash({ kind, message, id: Date.now() });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setFlash(null), timeout);
    },
    [timeout]
  );

  const dismiss = useCallback(() => {
    clearTimeout(timer.current);
    setFlash(null);
  }, []);

  return { flash, show, dismiss };
};
