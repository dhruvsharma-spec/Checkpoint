'use client';
import Link from 'next/link';
import { useApi } from '@/lib/hooks';
import { ist, whenText } from '@/lib/format';
import { StatusPill, TypeBadge } from '@/components/ui';
import type { Insights } from '@/lib/types';

export default function HomePage() {
  const { data } = useApi<Insights>('/insights');
  const k = data?.kpis;

  return (
    <>
      <section className="rise" style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 320px' }}>
          <div className="eyebrow">Checkpoint</div>
          <h1 className="h1" style={{ marginTop: 8 }}>Overview.</h1>
          <div style={{ fontSize: 16, color: 'var(--ink2)', marginTop: 6 }}>Organisation-wide view of changes and activities.</div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Link href="/ccb/new" className="btnP" style={{ textDecoration: 'none' }}>New CCB</Link>
          <Link href="/activities" className="btnS" style={{ textDecoration: 'none' }}>Log activity</Link>
        </div>
      </section>

      <div className="rise" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))', gap: 12, animationDelay: '.04s' }}>
        {[
          { label: 'Open CCBs', value: k?.total, href: '/ccb', hint: 'All statuses in view' },
          { label: 'Awaiting', value: k?.awaiting, href: '/ccb', hint: 'Need a decision' },
          { label: 'Cleared', value: k?.cleared, href: '/ccb', hint: 'Ready to ship' },
          { label: 'Rejected', value: k?.rejected, href: '/ccb', hint: 'Stopped' },
          { label: 'Filed this week', value: k?.filedThisWeek, href: '/ccb', hint: 'Last 7 days' },
          { label: 'Activities up', value: k?.activitiesUpcoming, href: '/activities', hint: 'Organisation level' },
        ].map((card) => (
          <Link key={card.label} href={card.href} className="card th lift" style={{ padding: '18px 18px 16px', textDecoration: 'none', color: 'var(--ink)', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="eyebrow">{card.label}</div>
            <div className="num" style={{ fontSize: 30, marginTop: 4 }}>{card.value ?? '—'}</div>
            <div style={{ fontSize: 12, color: 'var(--ink2)' }}>{card.hint}</div>
          </Link>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        <section className="card rise" style={{ padding: '10px 22px 18px', animationDelay: '.08s' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '12px 0 6px' }}>
            <h2 className="h2" style={{ fontSize: 18, flex: 1 }}>Upcoming changes</h2>
            <Link href="/ccb/calendar" className="btnS btnSm" style={{ textDecoration: 'none' }}>Calendar</Link>
          </div>
          {(data?.upcomingChanges ?? []).length === 0 && <div style={{ padding: '18px 0', color: 'var(--ink2)' }}>No upcoming change windows.</div>}
          {(data?.upcomingChanges ?? []).map((c) => {
            const p = ist(c.windowAt);
            return (
              <Link key={c.code} href={`/ccb/${c.code}`} className="row th" style={{ display: 'grid', gridTemplateColumns: '92px 1fr auto', gap: 14, alignItems: 'center', padding: '13px 0', borderTop: '1px solid var(--line)', textDecoration: 'none', color: 'var(--ink)' }}>
                <div style={{ fontSize: 12.5 }}>
                  <div style={{ fontWeight: 700 }}>{p.dayName} {p.dn}</div>
                  <div style={{ color: 'var(--ink2)' }}>{p.time} IST</div>
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 2, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span className="mono">{c.code}</span>
                    <TypeBadge t={c.typeName} />
                  </div>
                </div>
                <StatusPill s={c.status} />
              </Link>
            );
          })}
        </section>

        <section className="card rise" style={{ padding: '10px 22px 18px', animationDelay: '.1s' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '12px 0 6px' }}>
            <h2 className="h2" style={{ fontSize: 18, flex: 1 }}>Upcoming organisation activities</h2>
            <Link href="/activities" className="btnS btnSm" style={{ textDecoration: 'none' }}>All</Link>
          </div>
          {(data?.upcomingActivities ?? []).length === 0 && <div style={{ padding: '18px 0', color: 'var(--ink2)' }}>No organisation activities scheduled.</div>}
          {(data?.upcomingActivities ?? []).map((a) => (
            <div key={a.id} style={{ display: 'grid', gridTemplateColumns: '92px 1fr', gap: 14, alignItems: 'start', padding: '13px 0', borderTop: '1px solid var(--line)' }}>
              <div style={{ fontSize: 12.5 }}>
                <div style={{ fontWeight: 700 }}>{whenText(a.startsAt).split(' · ')[0]}</div>
                <div style={{ color: 'var(--ink2)' }}>{whenText(a.startsAt).split(' · ')[1]}</div>
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                  <div style={{ fontWeight: 600, fontSize: 14.5 }}>{a.title}</div>
                  {a.team && <span style={{ fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: 'var(--fill)', color: 'var(--ink2)' }}>{a.team}</span>}
                </div>
                {a.summary && <div style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 3 }}>{a.summary}</div>}
                <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 4 }}>Logged by {a.createdBy.name}</div>
              </div>
            </div>
          ))}
        </section>
      </div>

      <section className="card rise" style={{ padding: '10px 22px 18px', animationDelay: '.14s' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '12px 0 6px' }}>
          <h2 className="h2" style={{ fontSize: 18, flex: 1 }}>Recently filed</h2>
          <Link href="/ccb" className="btnS btnSm" style={{ textDecoration: 'none' }}>All CCBs</Link>
        </div>
        {(data?.recentFiled ?? []).length === 0 && <div style={{ padding: '18px 0', color: 'var(--ink2)' }}>No CCBs filed yet.</div>}
        {(data?.recentFiled ?? []).map((c) => (
          <Link key={c.code} href={`/ccb/${c.code}`} className="row th" style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 14, alignItems: 'center', padding: '13px 0', borderTop: '1px solid var(--line)', textDecoration: 'none', color: 'var(--ink)' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</div>
              <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 2 }}>{c.code} · {c.requester.name}</div>
            </div>
            <TypeBadge t={c.typeName} />
            <StatusPill s={c.status} />
          </Link>
        ))}
      </section>
    </>
  );
}
