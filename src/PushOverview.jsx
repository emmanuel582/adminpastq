import React, { useEffect, useState } from 'react';
import { Smartphone, Monitor, Users, RefreshCw } from 'lucide-react';
import { api } from './api.js';

export default function PushOverview({ version, tick, busy, onChooseSelf }) {
  const [status,setStatus]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{let active=true;api('/admin/notifications/push-status').then(data=>{if(active){setStatus(data);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[version,tick,retry]);
  return <section className="panel push-overview" aria-label="Live push notification connections">
    <div className="panel-heading"><div><h2>Push notifications</h2><p>Send to the installed PastQ app and connected browsers.</p></div><button type="button" className="button" disabled={busy} onClick={onChooseSelf}>Choose my account</button></div>
    {error&&<div className="error-box" role="alert"><span>Push connection counts could not refresh: {error}</span><button type="button" className="button" onClick={()=>setRetry(v=>v+1)}><RefreshCw size={15}/>Retry</button></div>}
    {!status?<p className="push-setup" role="status">{error?'Connection status unavailable.':'Checking live push connections…'}</p>:<>
      <div className="push-stats">{[[Users,status.readyAccounts,'accounts can receive push'],[Smartphone,status.phoneDevices,'connected phones'],[Monitor,status.browserDevices,'enabled browsers']].map(([Icon,count,label])=><div key={label}><Icon size={20}/><strong>{count.toLocaleString()}</strong><span>{label}</span></div>)}</div>
      <div className="push-setup"><p>{status.inboxOnly.toLocaleString()} accounts currently have no enabled push device. Their messages can still appear in the PastQ inbox.</p>
        <details><summary>How students connect a device</summary><p><strong>Phone app:</strong> Sign in to the installed PastQ app and allow notifications when prompted.</p><p><strong>Browser:</strong> Open Preferences → Study reminders, turn reminders on, and allow notifications on that device.</p></details>
        {!status.browserConfigured&&<p>Browser push is unavailable on the API. Phone connections are counted separately.</p>}
        <small>Checked {new Date(status.checkedAt).toLocaleTimeString()} · Updates automatically. A connection does not guarantee delivery; results appear after sending.</small>
      </div>
    </>}
  </section>;
}
