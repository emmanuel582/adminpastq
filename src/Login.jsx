import { useState } from 'react';
import { ArrowRight, Loader2, ShieldCheck } from 'lucide-react';
import { login } from './api.js';
import { Brand, ThemeToggle } from './Brand.jsx';

export default function Login({onLogin}) {
  const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event) {
    event.preventDefault();setBusy(true);setError('');
    try{onLogin(await login(email,password));}catch(error){setError(error.message);}finally{setBusy(false);}
  }
  return <main className="admin-auth">
    <header className="login-topbar"><Brand/><ThemeToggle/></header>
    <div className="login-layout">
      <aside className="login-scholar" aria-label="Scholar, your study buddy"><div className="scholar-speech">A little order.<br/>A lot of progress.</div><img src="/scholar.webp" alt="Scholar, the PastQ study buddy" width="200" height="300"/></aside>
      <section className="login-form-area" aria-labelledby="admin-login-title">
        <h1 id="admin-login-title">Welcome back.</h1><p>Sign in to your admin workspace.</p>
        <form className="form-stack" onSubmit={submit}>
          <label>Email address<input type="email" value={email} autoComplete="username" onChange={e=>setEmail(e.target.value)} placeholder="you@pastq.com" required/></label>
          <label>Password<input type="password" value={password} autoComplete="current-password" onChange={e=>setPassword(e.target.value)} placeholder="Enter your password" required/></label>
          {error&&<div className="inline-error" role="alert">{error}</div>}
          <button className="button primary" disabled={busy}>{busy?<Loader2 size={17} className="spin"/>:<ArrowRight size={17}/>} {busy?'Signing in…':'Sign in to dashboard'}</button>
        </form>
        <p className="access-note"><ShieldCheck size={14}/> Access is limited to authorized administrators.</p>
      </section>
    </div>
  </main>;
}

