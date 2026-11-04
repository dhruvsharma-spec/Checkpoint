'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

// The pages inside CCB (list, calendar, approvers) are in the sidebar. This is only the title and the New CCB button.
export default function CcbLayout({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return (
    <>
      <div className="rise" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: '1 1 200px' }}>
          <span style={{ width: 29, height: 29, borderRadius: 9, background: 'var(--accent)', color: 'var(--accentInk)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6" /></svg>
          </span>
          <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: '-0.04em' }}>CCB</span>
        </div>
        {path !== '/ccb/new' && <Link href="/ccb/new" className="btnP th" style={{ textDecoration: 'none' }}>+ New CCB</Link>}
      </div>
      {children}
    </>
  );
}
