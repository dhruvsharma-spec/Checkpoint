'use client';
import Link from 'next/link';
import { useApi, useSession } from '@/lib/hooks';
import { whenText } from '@/lib/format';
import type { Me } from '@/lib/types';

const ACCESS = { member: 'Member', power: 'Power user', admin: 'Admin' } as const;

// The signed-in person's own details.
export default function MyDetails() {
  const { signOut } = useSession();
  const { data: me } = useApi<Me>('/me');
  if (!me) return null;
  const initials = me.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const rows: [string, React.ReactNode][] = [
    ['Email', me.email],
    ['Access', ACCESS[me.access]],
    ['Signed off as', me.approves.length ? <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6 }}>{me.approves.map((r) => <span key={r} style={{ fontSize: 12.5, fontWeight: 600, padding: '3px 10px', borderRadius: 999, background: 'var(--fill)' }}>{r}</span>)}</span> : <span style={{ color: 'var(--ink2)' }}>Not listed as an approver or executioner</span>],
    ['CCBs filed', String(me.filed)],
    ['Last signed in', me.lastLoginAt ? whenText(me.lastLoginAt) : 'This is your first visit'],
    ['In Checkpoint since', me.createdAt ? whenText(me.createdAt).split(' · ')[0] : '—'],
  ];
  return (
    <>
      <section className="rise"><div className="eyebrow">My details</div><h1 className="h1" style={{ marginTop: 8 }}>{me.name}.</h1></section>
      <section className="card rise" style={{ padding: 26, animationDelay: '.05s', maxWidth: 720 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--accent)', color: 'var(--accentInk)', fontWeight: 800, fontSize: 19, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{initials}</div>
          <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 800, fontSize: 19, letterSpacing: '-0.03em' }}>{me.name}</div><div style={{ color: 'var(--ink2)' }}>{ACCESS[me.access]}</div></div>
        </div>
        {rows.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, padding: '12px 0', borderTop: '1px solid var(--line)' }}>
            <div style={{ flex: '0 0 170px', fontSize: 11.5, fontWeight: 700, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink2)', paddingTop: 2 }}>{k}</div>
            <div style={{ flex: '1 1 260px', minWidth: 0, wordBreak: 'break-word' }}>{v}</div>
          </div>
        ))}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, borderTop: '1px solid var(--line)', paddingTop: 18 }}>
          {me.access === 'admin' && <Link href="/rbac" className="btnS" style={{ textDecoration: 'none' }}>Access Management</Link>}
          <span style={{ flex: 1 }} />
          <button className="btnD" onClick={signOut}>Sign out</button>
        </div>
      </section>
    </>
  );
}
