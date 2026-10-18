import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleSignIn } from '../src/google-auth.js';

function setup({ href = 'https://adminpastq.vercel.app/', pending = true, expired = false, rejected = false, providerError = false } = {}) {
  const records = new Map(pending ? [['pastq-admin-google-pending', String(expired ? 1 : 1_000_000)]] : []);
  const calls = { exchange: 0, verify: 0, sessions: [], replaced: null };
  const storage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value), removeItem: key => records.delete(key) };
  const location = { href, origin: new URL(href).origin, assign: value => { calls.redirect = value; } };
  const client = { auth: {
    signInWithOAuth: async request => { calls.oauth = request; return providerError ? { error: new Error('Provider unavailable') } : { data: { url: 'https://project.supabase.co/auth/v1/authorize?provider=google' } }; },
    exchangeCodeForSession: async (code, options) => { calls.exchange++; calls.code = code; calls.options = options; return { data: { session: { access_token: 'test-access', refresh_token: 'test-refresh', expires_at: 999, user: { private: true } } } }; },
  } };
  const auth = createGoogleSignIn({ getClient: async () => client, verifyAdmin: async () => { calls.verify++; if (rejected) throw new Error('You do not have permission to perform this action'); return { user: { id: 'admin' } }; }, setSession: value => calls.sessions.push(value), storage, location, history: { replaceState: (_s, _t, path) => { calls.replaced = path; } }, now: () => 1_000_000 });
  return { auth, calls, records };
}

test('Google sign-in returns to the same admin origin without password or extra scopes', async () => {
  const { auth, calls, records } = setup(); await auth.start();
  assert.equal(calls.oauth.provider, 'google');
  assert.equal(calls.oauth.options.redirectTo, 'https://adminpastq.vercel.app/?admin_auth=google');
  assert.deepEqual(calls.oauth.options.queryParams, { prompt: 'select_account' });
  assert.ok(calls.redirect.startsWith('https://project.supabase.co/'));
  assert.ok(records.has('pastq-admin-google-pending'));
});
test('callback exchanges once, removes code from history, and verifies admin on the server', async () => {
  const { auth, calls, records } = setup({ href: 'https://adminpastq.vercel.app/?admin_auth=google&code=one-use&sb_flow_id=flow-id#users' });
  const [first, second] = await Promise.all([auth.finish(), auth.finish()]);
  assert.deepEqual(first, second); assert.equal(calls.exchange, 1); assert.equal(calls.verify, 1);
  assert.equal(calls.replaced, '/#users'); assert.deepEqual(calls.options, { flowId: 'flow-id' });
  assert.equal(records.has('pastq-admin-google-pending'), false);
  assert.deepEqual(Object.keys(calls.sessions[0]).sort(), ['access_token', 'expires_at', 'refresh_token']);
});
test('a Google account without admin permission cannot enter and its local session is cleared', async () => {
  const { auth, calls } = setup({ href: 'https://adminpastq.vercel.app/?admin_auth=google&code=one-use', rejected: true });
  await assert.rejects(auth.finish(), /permission/); assert.equal(calls.sessions.at(-1), null);
});
test('missing, expired, and cancelled callbacks fail without exchanging tokens', async () => {
  for (const options of [{ pending: false }, { expired: true }, { href: 'https://adminpastq.vercel.app/?admin_auth=google#error=access_denied' }]) {
    const { auth, calls } = setup({ href: 'https://adminpastq.vercel.app/?admin_auth=google&code=one-use', ...options });
    await assert.rejects(auth.finish()); assert.equal(calls.exchange, 0); assert.equal(calls.verify, 0); assert.equal(calls.sessions.at(-1), null);
  }
});
test('ordinary dashboard URL does not try to log in; provider failure allows retry', async () => {
  const { auth, calls, records } = setup({ providerError: true });
  assert.equal(await auth.finish(), null); assert.equal(calls.exchange, 0);
  await assert.rejects(auth.start(), /Provider unavailable/); assert.equal(records.has('pastq-admin-google-pending'), false);
});
