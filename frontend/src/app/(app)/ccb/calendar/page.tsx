'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '@/lib/hooks';
import { ist, ymd } from '@/lib/format';
import type { CalEvent } from '@/lib/types';

type View = 'focus' | 'week' | 'month';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const KIND_META = {
  release: { label: 'RELEASE', color: '--ok', bg: '--okBg' },
  pending: { label: 'AWAITING', color: '--warn', bg: '--warnBg' },
  activity: { label: 'ACTIVITY', color: '--ink', bg: '--fill' },
} as const;

const chipStyle = (k: CalEvent['kind']): React.CSSProperties => {
  const m = KIND_META[k];
  return {
    display: 'block', fontSize: 11.5, fontWeight: 600, padding: '3px 7px', borderRadius: 6,
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    background: `var(${m.bg})`, color: `var(${m.color})`,
    ...(k === 'pending' ? { boxShadow: 'inset 0 0 0 1px var(--warn)' } : {}),
  };
};

function addDays(ymdStr: string, n: number) {
  const [y, m, d] = ymdStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

function DayPopup({ day, events, onClose }: { day: string; events: CalEvent[]; onClose: () => void }) {
  const dp = ist(new Date(`${day}T12:00:00+05:30`));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(15,16,32,.45)' }}>
      <div role="dialog" aria-modal="true" aria-label={`Schedule for ${day}`} className="card rise" style={{ width: 'min(520px, 100%)', maxHeight: 'min(80vh, 640px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '20px 22px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow">Day detail</div>
            <h2 className="h2" style={{ fontSize: 22, marginTop: 4 }}>{dp.dayName} {dp.dn} {dp.mon}</h2>
          </div>
          <button className="btnS btnSm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div style={{ padding: '8px 22px 22px', overflowY: 'auto' }}>
          {events.length === 0 && <div style={{ color: 'var(--ink2)', padding: '18px 0' }}>Nothing scheduled this day.</div>}
          {events.map((e, i) => {
            const meta = KIND_META[e.kind];
            const href = e.kind === 'activity' ? '/activities' : `/ccb/${e.code}`;
            return (
              <div key={i} style={{ padding: '14px 0', borderTop: i ? '1px solid var(--line)' : 0 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="mono" style={{ color: 'var(--ink2)' }}>{ist(e.at).time} IST</span>
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', color: `var(${meta.color})` }}>{meta.label}</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 15, letterSpacing: '-0.02em', margin: '4px 0 2px' }}>{e.title}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{e.sub}</div>
                <Link className="btnS btnSm" href={href} style={{ marginTop: 10, textDecoration: 'none' }}>{e.kind === 'activity' ? 'Open Activities' : 'Open CCB'}</Link>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const todayYmd = ymd(new Date());
  const yesterdayYmd = addDays(todayYmd, -1);
  const [view, setView] = useState<View>('focus');
  const [cur, setCur] = useState(() => { const [y, m] = todayYmd.split('-').map(Number); return { y, m: m - 1 }; });
  const [anchor, setAnchor] = useState(yesterdayYmd);
  const [pending, setPending] = useState(false);
  const [popup, setPopup] = useState<string | null>(null);

  const focusDays = useMemo(() => [anchor, addDays(anchor, 1)], [anchor]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(anchor, i)), [anchor]);

  const monthCells = useMemo(() => {
    const off = (new Date(Date.UTC(cur.y, cur.m, 1)).getUTCDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(Date.UTC(cur.y, cur.m, 1 - off + i));
      return { iso: d.toISOString().slice(0, 10), dn: d.getUTCDate(), inM: d.getUTCMonth() === cur.m };
    });
  }, [cur]);

  const range = useMemo(() => {
    if (view === 'focus') {
      const from = new Date(`${focusDays[0]}T00:00:00+05:30`);
      return { from, to: new Date(from.getTime() + 2 * 86400000) };
    }
    if (view === 'week') {
      const from = new Date(`${weekDays[0]}T00:00:00+05:30`);
      return { from, to: new Date(from.getTime() + 7 * 86400000) };
    }
    const from = new Date(`${monthCells[0].iso}T00:00:00+05:30`);
    return { from, to: new Date(from.getTime() + 42 * 86400000) };
  }, [view, focusDays, weekDays, monthCells]);

  const { data } = useApi<CalEvent[]>(`/calendar?from=${encodeURIComponent(range.from.toISOString())}&to=${encodeURIComponent(range.to.toISOString())}${pending ? '&pending=1' : ''}`);
  const byDay = useMemo(() => {
    const m: Record<string, CalEvent[]> = {};
    (data ?? []).forEach((e) => { (m[ymd(new Date(e.at))] ??= []).push(e); });
    return m;
  }, [data]);

  const moveFocus = (n: number) => setAnchor((a) => addDays(a, n * (view === 'week' ? 7 : 2)));
  const moveMonth = (n: number) => setCur((c) => { let m = c.m + n, y = c.y; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } return { y, m }; });
  const resetToday = () => {
    setAnchor(yesterdayYmd);
    const [y, m] = todayYmd.split('-').map(Number);
    setCur({ y, m: m - 1 });
  };

  const openDay = (iso: string) => setPopup(iso);
  const heading = view === 'month'
    ? `${MONTHS[cur.m]} ${cur.y}`
    : view === 'week'
      ? `${ist(new Date(`${weekDays[0]}T12:00:00+05:30`)).dn} ${ist(new Date(`${weekDays[0]}T12:00:00+05:30`)).mon} – ${ist(new Date(`${weekDays[6]}T12:00:00+05:30`)).dn} ${ist(new Date(`${weekDays[6]}T12:00:00+05:30`)).mon}`
      : 'Yesterday & today';

  const renderDayColumn = (iso: string) => {
    const ev = byDay[iso] ?? [];
    const p = ist(new Date(`${iso}T12:00:00+05:30`));
    const isToday = iso === todayYmd;
    const isYest = iso === yesterdayYmd;
    return (
      <button key={iso} type="button" className="cell th" onClick={() => openDay(iso)}
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8, minHeight: view === 'focus' ? 280 : 160, padding: 14, textAlign: 'left', cursor: 'pointer', border: 0, borderRadius: 14, font: 'inherit', color: 'var(--ink)', background: 'var(--fill)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={isToday ? { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 28, height: 28, padding: '0 8px', borderRadius: 8, background: 'var(--accent)', color: 'var(--accentInk)', fontWeight: 700, fontSize: 13 } : { fontWeight: 700, fontSize: 14 }}>{p.dayName} {p.dn}</span>
          {isToday && <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink2)' }}>Today</span>}
          {isYest && <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink2)' }}>Yesterday</span>}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink2)' }}>{ev.length || '—'}</span>
        </div>
        {ev.length === 0 && <div style={{ color: 'var(--ink2)', fontSize: 13.5, paddingTop: 8 }}>No changes or activities</div>}
        {ev.slice(0, view === 'focus' ? 8 : 4).map((e, i) => (
          <span key={i} style={chipStyle(e.kind)}>{ist(e.at).time} {e.title}</span>
        ))}
        {ev.length > (view === 'focus' ? 8 : 4) && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink2)' }}>+{ev.length - (view === 'focus' ? 8 : 4)} more — open day</span>}
      </button>
    );
  };

  return (
    <>
      <section className="rise">
        <div className="eyebrow">CCB</div>
        <h1 className="h1" style={{ marginTop: 8 }}>Calendar.</h1>
        <div style={{ fontSize: 16, color: 'var(--ink2)', marginTop: 6 }}>Changes and organisation activities. Default view is the last 48 hours — expand when you need more.</div>
      </section>

      <section className="card rise" style={{ padding: 20, animationDelay: '.05s' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <h2 className="h2" style={{ flex: '1 1 200px', fontSize: 20 }}>{heading}</h2>
          <div role="tablist" aria-label="Calendar range" style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 10, background: 'var(--fill)' }}>
            {([['focus', '48 hours'], ['week', 'Week'], ['month', 'Month']] as [View, string][]).map(([v, label]) => (
              <button key={v} role="tab" aria-selected={view === v} className="th" onClick={() => setView(v)}
                style={{ minHeight: 32, padding: '0 12px', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: view === v ? 'var(--card)' : 'transparent', color: view === v ? 'var(--ink)' : 'var(--ink2)', boxShadow: view === v ? 'var(--cardShadow)' : 'none' }}>{label}</button>
            ))}
          </div>
          <button onClick={() => setPending(!pending)} style={{ minHeight: 32, padding: '0 12px', border: 0, borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', background: pending ? 'var(--warnBg)' : 'var(--fill)', color: pending ? 'var(--warn)' : 'var(--ink)' }}>{pending ? 'Showing awaiting' : 'Show awaiting'}</button>
          <button className="btnS btnSm" onClick={resetToday}>Today</button>
          {view !== 'month' ? (
            <>
              <button className="btnS btnSm" onClick={() => moveFocus(-1)} aria-label="Previous">‹</button>
              <button className="btnS btnSm" onClick={() => moveFocus(1)} aria-label="Next">›</button>
            </>
          ) : (
            <>
              <button className="btnS btnSm" onClick={() => moveMonth(-1)} aria-label="Previous month">‹</button>
              <button className="btnS btnSm" onClick={() => moveMonth(1)} aria-label="Next month">›</button>
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--ink2)', marginBottom: 14 }}>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--okBg)', boxShadow: 'inset 0 0 0 1px var(--ok)', marginRight: 6, verticalAlign: -1 }} />Release</span>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, boxShadow: 'inset 0 0 0 1px var(--warn)', marginRight: 6, verticalAlign: -1 }} />Awaiting</span>
          <span><i style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: 'var(--fill)', boxShadow: 'inset 0 0 0 1px var(--line)', marginRight: 6, verticalAlign: -1 }} />Activity</span>
        </div>

        {view === 'focus' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
            {focusDays.map(renderDayColumn)}
          </div>
        )}

        {view === 'week' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
            {weekDays.map(renderDayColumn)}
          </div>
        )}

        {view === 'month' && (
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 700 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 5, marginBottom: 5 }}>
                {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((w) => <div key={w} style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: 'var(--ink2)', padding: '0 7px' }}>{w}</div>)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 5 }}>
                {monthCells.map((c) => {
                  const ev = byDay[c.iso] ?? [];
                  const today = c.iso === todayYmd;
                  return (
                    <button key={c.iso} type="button" className="cell th" onClick={() => openDay(c.iso)} aria-label={c.iso}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 4, minHeight: 96, padding: 8, boxSizing: 'border-box', textAlign: 'left', cursor: 'pointer', border: 0, borderRadius: 12, font: 'inherit', color: 'var(--ink)', background: c.inM ? 'var(--fill)' : 'transparent', opacity: c.inM ? 1 : 0.45 }}>
                      <span style={today ? { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: 7, background: 'var(--accent)', color: 'var(--accentInk)', fontWeight: 700, fontSize: 12.5 } : { display: 'inline-block', padding: '2px 4px', fontWeight: 700, fontSize: 12.5, color: 'var(--ink2)' }}>{c.dn}</span>
                      {ev.slice(0, 2).map((e, i) => <span key={i} style={chipStyle(e.kind)}>{ist(e.at).time} {e.title}</span>)}
                      {ev.length > 2 && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--ink2)' }}>+{ev.length - 2} more</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>

      {popup && <DayPopup day={popup} events={byDay[popup] ?? []} onClose={() => setPopup(null)} />}
    </>
  );
}
