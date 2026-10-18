import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';
import { googleSignIn } from './auth.js';
import { Brand, ThemeToggle } from './Brand.jsx';

export default function Login({onLogin}) {
  const [busy,setBusy]=useState(true),[error,setError]=useState('');
  useEffect(()=>{let active=true;googleSignIn.finish().then(data=>{if(active&&data)onLogin(data);}).catch(error=>{if(active)setError(error.message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};},[]);
  async function submit() {
    setBusy(true);setError('');
    try{await googleSignIn.start();}catch(error){setError(error.message);setBusy(false);}
  }
  return <main className="admin-auth">
    <header className="login-topbar"><Brand/><ThemeToggle/></header>
    <div className="login-layout">
      <aside className="login-scholar" aria-label="Scholar, your study buddy"><div className="scholar-speech">A little order.<br/>A lot of progress.</div><img src="/scholar.webp" alt="Scholar, the PastQ study buddy" width="200" height="300"/></aside>
      <section className="login-form-area" aria-labelledby="admin-login-title">
        <h1 id="admin-login-title">Welcome back.</h1><p>Use your Google account to open your admin workspace.</p>
        <div className="form-stack">
          {error&&<div className="inline-error" role="alert">{error}</div>}
          <button className="button primary" onClick={submit} disabled={busy}>{busy?<Loader2 size={17} className="spin"/>:<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.5-.2-2.2H12v4h5.4a4.6 4.6 0 0 1-2 3c-.9.6-2 1-3.4 1a6 6 0 1 1 0-12c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 1 0 12 22c2.7 0 5-.9 6.6-2.5 1.9-1.7 3-4.2 3-7.3Z"/></svg>} {busy?'Connecting…':'Continue with Google'}</button>
        </div>
        <p className="access-note"><ShieldCheck size={14}/> Access is limited to authorized administrators.</p>
      </section>
    </div>
  </main>;
}

