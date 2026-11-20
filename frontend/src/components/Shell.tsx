'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { MODULES } from '@/lib/modules';
import { useSession } from '@/lib/hooks';
import type { Dashboard } from '@/lib/types';
import { ThemeToggle } from './ThemeToggle';

const navStyle = (on: boolean): React.CSSProperties => ({ display: 'flex', alignItems: 'center', gap: 12, width: '100%', boxSizing: 'border-box', minHeight: 38, padding: '0 12px', border: 0, borderRadius: 10, fontSize: 13.5, textDecoration: 'none', cursor: 'pointer', background: on ? 'var(--fill)' : 'transparent', color: on ? 'var(--ink)' : 'var(--ink2)', fontWeight: on ? 600 : 500 });
const ACCESS_LABEL = { member: 'Member', power: 'Power user', admin: 'Admin' };
const Icon = ({ d }: { d: string }) => <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;

function crumb(p: string) {
  if (p === '/') return 'Home';
  if (p === '/ccb') return 'CCB';
  if (p === '/ccb/new') return 'CCB  /  New CCB';
  if (p === '/ccb/calendar') return 'CCB  /  Calendar';
  if (p === '/ccb/approvers') return 'CCB  /  Approval matrix';
  if (p.startsWith('/ccb/')) return 'CCB  /  ' + decodeURIComponent(p.split('/')[2]);
  if (p === '/activities' || p.startsWith('/activities/')) return 'Activities';
  if (p === '/rbac') return 'Access Management';
  if (p === '/me') return 'My details';
  return '';
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const { user, signOut } = useSession();
  const [queue, setQueue] = useState(0);
  useEffect(() => {
    const load = () => api<Dashboard>('/dashboard').then((d) => setQueue(d.kpis.awaitingYou)).catch(() => {});
    load();
    window.addEventListener('cp-refresh', load);
    return () => window.removeEventListener('cp-refresh', load);
  }, []);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', minHeight: '100vh' }}>
      <aside className="side th" style={{ flex: '0 0 232px', boxSizing: 'border-box', position: 'sticky', top: 0, alignSelf: 'flex-start', height: '100vh', overflowY: 'auto', padding: '18px 14px', display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--sideBg)', WebkitBackdropFilter: 'blur(24px)', backdropFilter: 'blur(24px)', borderRight: '1px solid var(--line)' }}>
        <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 10px 18px', textDecoration: 'none', color: 'var(--ink)' }}>
          <svg width="28" height="28" viewBox="0 0 32 32" fill="none" aria-hidden="true"><defs><linearGradient id="brand" x1="0" y1="0" x2="32" y2="32"><stop offset="0" style={{ stopColor: 'var(--ringA)' }} /><stop offset="1" style={{ stopColor: 'var(--ringB)' }} /></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#brand)" /><path d="M9 16.5l4.8 4.8L23 11" style={{ stroke: 'var(--brandInk)' }} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: '-0.03em' }}>Checkpoint</span>
        </Link>
        <div className="eyebrow" style={{ padding: '16px 14px 5px' }}>Modules</div>
        {MODULES.map((m) => (
          <div key={m.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Link className="nav th" href={m.href} style={{ ...navStyle(m.isHome(path)), fontWeight: 700 }}>
              <Icon d={m.icon} /><span style={{ flex: 1 }}>{m.label}</span>
              {m.showQueue && queue > 0 && <span style={{ fontSize: 12, fontWeight: 600, background: 'var(--accent)', color: 'var(--accentInk)', borderRadius: 6, padding: '1px 8px' }}>{queue}</span>}
            </Link>
            {m.items.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginLeft: 26, paddingLeft: 10, borderLeft: '1.5px solid var(--line)' }}>
                {m.items.filter((it) => !it.adminOnly || user?.access === 'admin').map((it) => (
                  <Link key={it.href} className="nav th" href={it.href} style={{ ...navStyle(it.match(path)), minHeight: 36, fontSize: 13.5 }}>{it.label}</Link>
                ))}
              </div>
            )}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 6, borderRadius: 16, background: path === '/me' ? 'var(--fill2)' : 'var(--fill)' }}>
          <Link href="/me" className="nav th" aria-label="My details" style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0, padding: 4, borderRadius: 12, textDecoration: 'none', color: 'var(--ink)' }}>
            <div style={{ width: 33, height: 33, borderRadius: '50%', background: 'var(--accent)', color: 'var(--accentInk)', fontWeight: 700, fontSize: 12.5, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{user?.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
              <div style={{ fontSize: 12, color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user ? ACCESS_LABEL[user.access] : ''} · My details</div>
            </div>
          </Link>
          <button className="btnS btnSm th" onClick={signOut}>Sign out</button>
        </div>
      </aside>

      <div style={{ flex: '999 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <header className="th" style={{ position: 'sticky', top: 0, zIndex: 30, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: '11px 31px', background: 'var(--sideBg)', WebkitBackdropFilter: 'blur(24px)', backdropFilter: 'blur(24px)', borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: '1 1 200px', minWidth: 0, fontSize: 13.5, color: 'var(--ink2)', fontWeight: 500 }}>{crumb(path)}</div>
          {user?.access === 'admin' && (
            <Link href="/rbac" className="btnS btnSm th" style={{ textDecoration: 'none', background: path === '/rbac' ? 'var(--accent)' : undefined, color: path === '/rbac' ? 'var(--accentInk)' : undefined }}>Access Management</Link>
          )}
          <ThemeToggle />
        </header>
        <main style={{ padding: '31px 31px 86px', display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 1440, width: '100%', boxSizing: 'border-box' }}>{children}</main>
      </div>
    </div>
  );
}
