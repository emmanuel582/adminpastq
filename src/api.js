
const configuredBase = (import.meta.env.VITE_API_URL || (import.meta.env.PROD ? 'https://76.13.110.6.nip.io/api' : '/api')).replace(/\/$/, '');
const BASE = configuredBase.endsWith('/api') ? configuredBase : `${configuredBase}/api`;
let session;
try { session = JSON.parse(sessionStorage.getItem('pastq-admin-session') || 'null'); } catch { sessionStorage.removeItem('pastq-admin-session'); }
export function setSession(value) { session = value; value ? sessionStorage.setItem('pastq-admin-session', JSON.stringify(value)) : sessionStorage.removeItem('pastq-admin-session'); }
export function hasSession() { return Boolean(session?.access_token); }
let refreshing;
async function refresh() {
  if (!refreshing) refreshing = fetch(`${BASE}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: session?.refresh_token }) }).then(async res => {
    if (!res.ok) { setSession(null); throw new Error('Your session expired. Please sign in again.'); }
    const data = await res.json(); setSession(data.session);
  }).finally(() => { refreshing = null; });
  return refreshing;
}
export async function api(path, options = {}, retry = true) {

  if (session?.expires_at && session.expires_at * 1000 < Date.now() + 30000 && !path.startsWith('/auth/')) await refresh();
  const res = await fetch(BASE + path, { cache: 'no-store', ...options, headers: { ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}), ...(!(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers }, body: options.body instanceof FormData ? options.body : options.body ? JSON.stringify(options.body) : undefined });
  if (res.status === 401 && session?.refresh_token && retry) { await refresh(); return api(path, options, false); }
  if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || `Request failed (${res.status})`); }
  return options.blob ? res.blob() : res.json();
}
export async function login(email, password) { const result = await api('/auth/login', { method: 'POST', body: { email, password } }); setSession(result.session); try { return await api('/admin/me'); } catch (error) { setSession(null); throw error; } }
export function exportRows(items, name) {
  if (!items.length) return;
  const columns = [...new Set(items.flatMap(item => Object.keys(item)))];
  const escape = value => {
    let text = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
    if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const csv = [columns, ...items.map(item => columns.map(key => item[key]))].map(row => row.map(escape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${name}.csv`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}


