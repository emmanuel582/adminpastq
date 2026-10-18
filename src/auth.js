import { createClient } from '@supabase/supabase-js';
import { api, setSession } from './api.js';
import { createGoogleSignIn, GOOGLE_STORAGE_KEY } from './google-auth.js';

let client;
async function getClient() {
  if (!client) client = api('/auth/config').then(({ supabaseUrl, supabaseAnonKey }) => createClient(supabaseUrl, supabaseAnonKey, {
    auth: { flowType: 'pkce', storage: sessionStorage, storageKey: GOOGLE_STORAGE_KEY, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false },
  })).catch(error => { client = null; throw error; });
  return client;
}
export const googleSignIn = createGoogleSignIn({ getClient, verifyAdmin: () => api('/admin/me'), setSession, storage: sessionStorage, location: window.location, history: window.history });
