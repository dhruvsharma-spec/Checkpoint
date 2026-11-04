'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useApi } from '@/lib/hooks';
import { ist, ymd } from '@/lib/format';
import type { CalEvent } from '@/lib/types';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const chipStyle = (k: string): React.CSSProperties => ({ display: 'block', fontSize: 11.5, fontWeight: 600, padding: '2px 7px', borderRadius: 7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...(k === 'release' ? { background: 'var(--okBg)', color: 'var(--ok)' } : { color: 'var(--warn)', boxShadow: 'inset 0 0 0 1.5px var(--warn)' }) });

export default function CalendarPage() {
  const todayYmd = ymd(new Date());
  const [cur, setCur] = useState(() => { const [y, m] = todayYmd.split('-').map(Number); return { y, m: m - 1 }; });
  const [day, setDay] = useState(todayYmd);
  const [pending, setPending] = useState(false);

  const cells = useMemo(() => {
    const off = (new Date(Date.UTC(cur.y, cur.m, 1)).getUTCDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(Date.UTC(cur.y, cur.m, 1 - off + i)); return { iso: d.toISOString().slice(0, 10), dn: d.getUTCDate(), inM: d.getUTCMonth() === cur.m }; });
  }, [cur]);
  const from = new Date(`${cells[0].iso}T00:00:00+05:30`);
  const to = new Date(from.getTime() + 42 * 86400000);
  const { data } = useApi<CalEvent[]>(`/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}${pending ? '&pending=1' : ''}`);
  const byDay = useMemo(() => { const m: Record<string, CalEvent[]> = {}; (data ?? []).forEach((e) => { (m[ymd(new Date(e.at))] ??= []).push(e); }); return m; }, [data]);
  const move = (n: number) => setCur((c) => { let m = c.m + n, y = c.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } return { y, m }; });
  const agenda = byDay[day] ?? [];
  const dp = ist(new Date(`${day}T12:00:00+05:30`));
  const kind = { release: ['RELEASE', '--ok'], pending: ['AWAITING APPROVAL', '--warn'] } as const;

  return (
    <>
      <section className="rise"><div className="eyebrow">CCB</div><h1 className="h1" style={{ marginTop: 8 }}>Calendar.</h1><div style={{ fontSize: 16, color: 'var(--ink2)', marginTop: 6 }}>Approved changes appear at their change window.</div></section>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <section className="card rise" style={{ flex: '3 1 640px', minWidth: 0, padding: 20, animationDelay: '.05s' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <h2 className="h2" style={{ flex: '1 1 200px' }}>{MONTHS[cur.m]} {cur.y}</h2>
            <button onClick={() => setPending(!pending)} style={{ minHeight: 32, padding: '0 14px', border: 0, borderRadius: 999, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: pending ? 'var(--warnBg)' : 'var(--fill)', color: pending ? 'var(--warn)' : 'var(--ink)' }}>{pending ? 'Showing awaiting' : 'Show awaiting'}</button>
            <button className="btnS btnSm" onClick={() => { const [y, m] = todayYmd.split('-').map(Number); setCur({ y, m: m - 1 }); setDay(todayYmd); }}>Today</button>
            <button className="btnS btnSm" onClick={() => move(-1)} aria-label="Previous month">‹</button>
            <button className="btnS btnSm" onClick={() => move(1)} aria-label="Next month">›</button>
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--ink2)', marginBottom: 12 }}>
            <span><i style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 4, background: 'var(--okBg)', boxShadow: 'inset 0 0 0 1.5px var(--ok)', marginRight: 6, verticalAlign: -1 }} />Release</span>
            <span><i style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 4, boxShadow: 'inset 0 0 0 1.5px var(--warn)', marginRight: 6, verticalAlign: -1 }} />Awaiting approval</span>
          </div>
          <div style={{ overflowX: 'auto' }}><div style={{ minWidth: 700 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 5, marginBottom: 5 }}>{['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((w) => <div key={w} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.12em', color: 'var(--ink2)', padding: '0 7px' }}>{w}</div>)}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 5 }}>
              {cells.map((c) => { const ev = byDay[c.iso] ?? []; const sel = c.iso === day; const today = c.iso === todayYmd; return (
                <button key={c.iso} className="cell th" onClick={() => setDay(c.iso)} aria-label={c.iso} style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4, minHeight: 90, padding: 7, boxSizing: 'border-box', textAlign: 'left', cursor: 'pointer', border: 0, borderRadius: 13, font: 'inherit', color: 'var(--ink)', background: c.inM ? 'var(--fill)' : 'transparent', opacity: c.inM ? 1 : 0.5, boxShadow: sel ? 'inset 0 0 0 2px var(--solid)' : 'none' }}>
                  <span style={today ? { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: 'var(--accent)', color: 'var(--accentInk)', fontWeight: 800, fontSize: 12.5 } : { display: 'inline-block', padding: '2px 4px', fontWeight: 700, fontSize: 12.5, color: 'var(--ink2)' }}>{c.dn}</span>
                  {ev.slice(0, 2).map((e, i) => <span key={i} style={chipStyle(e.kind)}>{ist(e.at).time} {e.title}</span>)}
                  {ev.length > 2 && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink2)' }}>+{ev.length - 2} more</span>}
                </button>); })}
            </div>
          </div></div>
        </section>
        <aside className="card rise" style={{ flex: '1 1 300px', minWidth: 0, padding: 20, animationDelay: '.1s' }}>
          <div className="eyebrow">Agenda</div>
          <h2 className="h2" style={{ margin: '4px 0 12px', fontSize: 20 }}>{dp.dayName} {dp.dn} {dp.mon}</h2>
          {agenda.length === 0 && <div style={{ color: 'var(--ink2)', padding: '10px 0' }}>Nothing scheduled this day.</div>}
          {agenda.map((e, i) => (
            <div key={i} style={{ padding: '12px 0', borderTop: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="mono" style={{ color: 'var(--ink2)' }}>{ist(e.at).time} IST</span><span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '.1em', color: `var(${kind[e.kind][1]})` }}>{kind[e.kind][0]}</span></div>
              <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em', margin: '4px 0 2px' }}>{e.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{e.sub}</div>
              <Link className="btnS btnSm" href={`/ccb/${e.code}`} style={{ marginTop: 8, textDecoration: 'none' }}>Open CCB</Link>
            </div>
          ))}
        </aside>
      </div>
    </>
  );
}
