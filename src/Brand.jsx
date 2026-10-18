import { useState, useEffect } from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';
import { readTheme, applyTheme } from './theme.js';

export function Brand() {
  return <div className="brand" aria-label="PastQ Admin"><span className="wordmark">past<span>q</span><span className="wordmark-rule"/></span><span className="brand-admin">ADMIN</span></div>;
}
function useTheme() {
  const [theme,setTheme]=useState(readTheme);
  useEffect(()=>{const update=()=>setTheme(readTheme());window.addEventListener('pastq-admin-theme',update);return()=>window.removeEventListener('pastq-admin-theme',update);},[]);
  return [theme,value=>{applyTheme(value);setTheme(value);}];
}
export function ThemeToggle() {
  const [theme,setTheme]=useTheme();
  const next={system:'light',light:'dark',dark:'system'}[theme];
  const Icon=theme==='dark'?Moon:theme==='light'?Sun:Monitor;
  return <button type="button" className="icon-button theme-control" aria-label={`Theme: ${theme}. Switch to ${next} mode`} title={`Theme: ${theme} · Switch to ${next}`} onClick={()=>setTheme(next)}><Icon size={18}/></button>;
}
export function ThemeSettings() {
  const [theme,setTheme]=useTheme();
  return <section className="panel"><div className="panel-heading"><div><h2>Appearance</h2><p>The same light and dark themes as your PastQ website.</p><div className="theme-options">{[['light','Light',Sun],['dark','Dark',Moon],['system','System',Monitor]].map(([value,label,Icon])=><button className="button" key={value} aria-pressed={theme===value} onClick={()=>setTheme(value)}><Icon size={16}/>{label}</button>)}</div></div></div></section>;
}
