// Match client/src/utils/theme.ts. Both apps use the same theme preference.
export function readTheme() {
  try { const theme = localStorage.getItem('pastq-theme'); return theme === 'light' || theme === 'dark' ? theme : 'system'; }
  catch { return 'system'; }
}
export function applyTheme(theme) {
  const resolved = theme === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document.documentElement.style.colorScheme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#151515' : '#faf6f0');
  try { localStorage.setItem('pastq-theme', theme); } catch { /* In-memory theme remains available. */ }
  window.dispatchEvent(new Event('pastq-admin-theme'));
}
export function initializeTheme() {
  applyTheme(readTheme());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (readTheme() === 'system') applyTheme('system'); });
}
