import React, { useState } from 'react';
import './insights.css';
const SERIES = [['signups', 'Signups'], ['uploads', 'Uploads'], ['practices', 'Completed sessions']];
export function chartScale(data, keys) {
  const highest = Math.max(0, ...data.flatMap(row => keys.map(key => Number(row[key]) || 0)));
  const rough = Math.max(1, highest / 4), power = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].find(n => n * power >= rough) || 10) * power;
  return { max: step * 4, ticks: [0, 1, 2, 3, 4].map(n => n * step) };
}
const dayLabel = day => new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
export default function ActivityChart({ data = [], updatedAt, error }) {
  const [keys, setKeys] = useState(['signups', 'uploads', 'practices']), [selected, setSelected] = useState(null);
  const { max, ticks } = chartScale(data, keys), W = 900, H = 280, left = 48, right = 20, top = 20, bottom = 48;
  const x = i => left + i * (W - left - right) / Math.max(1, data.length - 1), y = n => H - bottom - (n / max) * (H - top - bottom);
  const active = data[Math.min(selected ?? data.length - 1, data.length - 1)];
  return <div className="live-chart"><div className="chart-series" role="group" aria-label="Chart series">{SERIES.map(([key, title], index) => <label key={key} className={`series-${index}`}><input type="checkbox" checked={keys.includes(key)} onChange={e => setKeys(e.target.checked ? [...keys, key] : keys.filter(item => item !== key))} /><span>{title}</span></label>)}</div>
    {error && <p className="inline-error" role="alert">Refresh failed: {error}. Showing the last successful data.</p>}
    <div className="activity-chart-scroll"><svg className="activity-chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Daily signup, upload, and practice totals, UTC. ${data.length} days. Exact values are available below.`}>
      {ticks.map(tick => <g key={tick}><line x1={left} x2={W - right} y1={y(tick)} y2={y(tick)} stroke="var(--study-soft)" opacity=".12" /><text x={left - 12} y={y(tick) + 4} textAnchor="end">{tick.toLocaleString()}</text></g>)}
      {data.map((row, i) => i === 0 || i === data.length - 1 || i % Math.max(1, Math.round(data.length / 6)) === 0 ? <text key={row.day} x={x(i)} y={H - 18} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}>{dayLabel(row.day)}</text> : null)}
      {SERIES.filter(([key]) => keys.includes(key)).map(([key], index) => <g key={key} className={`chart-line chart-line-${SERIES.findIndex(s => s[0] === key)}`}><polyline points={data.filter(row => row[key] != null).map(row => `${x(data.indexOf(row))},${y(row[key])}`).join(' ')} fill="none" strokeWidth="2.5" strokeDasharray={index === 1 ? '7 5' : index === 2 ? '2 4' : undefined} />{data.map((row, i) => row[key] == null ? null : <circle key={row.day} cx={x(i)} cy={y(row[key])} r={selected === i ? 4 : 2.7}><title>{dayLabel(row.day)}: {row[key]} {key}</title></circle>)}</g>)}
      {selected !== null && data[selected] && <line x1={x(selected)} x2={x(selected)} y1={top} y2={H - bottom} stroke="var(--study-soft)" strokeDasharray="3 4" />}
      {data.map((row, i) => <rect key={row.day} x={x(i) - (W - left - right) / Math.max(1, data.length - 1) / 2} y={top} width={(W - left - right) / Math.max(1, data.length - 1)} height={H - bottom - top} fill="transparent" tabIndex={0} role="button" aria-label={`${row.day}: ${SERIES.map(([key, title]) => `${title} ${row[key] ?? 'unavailable'}`).join(', ')}`} onMouseEnter={() => setSelected(i)} onFocus={() => setSelected(i)} onClick={() => setSelected(i)} onKeyDown={e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setSelected(Math.max(0, Math.min(data.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))); e.currentTarget.parentNode.querySelectorAll('rect')[Math.max(0, Math.min(data.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))]?.focus(); } }} />)}
    </svg></div>
    {active && <div className="chart-readout" aria-live="polite"><strong>{dayLabel(active.day)}</strong>{SERIES.map(([key, title]) => <span key={key}>{title}<b>{active[key] == null ? 'Unavailable' : active[key].toLocaleString()}</b></span>)}</div>}
    <div className="chart-source"><span>Daily totals · UTC · Today is still in progress</span><time dateTime={updatedAt}>Updated {updatedAt ? new Date(updatedAt).toLocaleTimeString() : '—'}</time></div>
    <details className="chart-values"><summary>View exact daily values and data sources</summary><p>Signups: Supabase Auth, including unconfirmed accounts. Uploads: VPS upload records. Completed sessions: saved Supabase exam history. Device-only and pending offline results appear after synchronization. Missing data is marked unavailable.</p><div className="table-scroll"><table><thead><tr><th>Day (UTC)</th>{SERIES.map(([key, title]) => <th key={key}>{title}</th>)}</tr></thead><tbody>{data.map(row => <tr key={row.day}><td>{row.day}</td>{SERIES.map(([key]) => <td key={key}>{row[key] ?? 'Unavailable'}</td>)}</tr>)}</tbody></table></div></details>
  </div>;
}
