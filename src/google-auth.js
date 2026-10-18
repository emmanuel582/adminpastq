const PENDING = 'pastq-admin-google-pending';
export const GOOGLE_STORAGE_KEY = 'pastq-admin-google';

export function createGoogleSignIn({ getClient, verifyAdmin, setSession, storage, location, history, now = Date.now }) {
  let callback;
  return {
    async start() {
      const client = await getClient();
      const redirect = new URL('/', location.origin);
      redirect.searchParams.set('admin_auth', 'google');
      storage.setItem(PENDING, String(now()));
      const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: {
        redirectTo: redirect.href, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' },
      } });
      if (error || !data?.url) { storage.removeItem(PENDING); throw error || new Error('Unable to open Google sign-in. Please try again.'); }
      location.assign(data.url);
    },
    finish() {
      if (callback) return callback;
      const url = new URL(location.href);
      if (url.searchParams.get('admin_auth') !== 'google') return Promise.resolve(null);
      // Remove one-use codes and provider errors from browser history immediately.
      const code = url.searchParams.get('code');
      const flowId = url.searchParams.get('sb_flow_id');
      const fragment = new URLSearchParams(url.hash.slice(1));
      const denied = url.searchParams.has('error') || url.searchParams.has('error_description') || fragment.has('error');
      if (fragment.has('error')) url.hash = '';
      for (const key of ['admin_auth', 'code', 'error', 'error_code', 'error_description', 'sb_flow_id']) url.searchParams.delete(key);
      history.replaceState(null, '', url.pathname + url.search + url.hash);
      const started = Number(storage.getItem(PENDING));
      storage.removeItem(PENDING);
      callback = (async () => {
        try {
          if (denied) throw new Error('Google sign-in was cancelled or declined. Please try again.');
          if (!started || now() - started > 15 * 60 * 1000 || started > now() || !code) throw new Error('This sign-in link has expired. Please continue with Google again in this tab.');
          const client = await getClient();
          const { data, error } = await client.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
          if (error || !data?.session) throw new Error('Could not finish Google sign-in. Please try again in the same tab.');
          // The server verifies the token and its admin allowlist before entry.
          setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_at: data.session.expires_at });
          return await verifyAdmin();
        } catch (error) { setSession(null); throw error; }
        finally { storage.removeItem(GOOGLE_STORAGE_KEY); storage.removeItem(GOOGLE_STORAGE_KEY + '-code-verifier'); }
      })();
      return callback;
    },
  };
}
