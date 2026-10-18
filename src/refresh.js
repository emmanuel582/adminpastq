/** Refresh when visible, on return to the tab, and when connectivity returns. */
export function startAutoRefresh(callback, {
  intervalMs = 15000,
  windowTarget = window,
  documentTarget = document,
  schedule = setInterval,
  cancel = clearInterval,
} = {}) {
  const refresh = () => { if (documentTarget.visibilityState === 'visible' && windowTarget.navigator?.onLine !== false) callback(); };
  const timer = schedule(refresh, intervalMs);
  windowTarget.addEventListener('focus', refresh);
  windowTarget.addEventListener('online', refresh);
  documentTarget.addEventListener('visibilitychange', refresh);
  return () => {
    cancel(timer);
    windowTarget.removeEventListener('focus', refresh);
    windowTarget.removeEventListener('online', refresh);
    documentTarget.removeEventListener('visibilitychange', refresh);
  };
}
