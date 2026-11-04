'use client';
import { useEffect, useState } from 'react';

export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  // Coming from the sign-in page (always dark), the saved choice is applied here. No saved choice means light.
  useEffect(() => {
    let t = 'light'; try { t = localStorage.getItem('cp-theme') === 'dark' ? 'dark' : 'light'; } catch { /* storage unavailable */ }
    document.documentElement.dataset.theme = t; setDark(t === 'dark');
  }, []);
  const set = (d: boolean) => { setDark(d); document.documentElement.dataset.theme = d ? 'dark' : 'light'; try { localStorage.setItem('cp-theme', d ? 'dark' : 'light'); } catch { /* storage unavailable */ } };
  const btn = (on: boolean): React.CSSProperties => ({ position: 'relative', zIndex: 1, flex: 1, border: 0, background: 'transparent', borderRadius: 999, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'color .2s', color: on ? 'var(--ink)' : 'var(--ink2)' });
  return (
    <div role="group" aria-label="Appearance" className="th" style={{ position: 'relative', display: 'flex', width: 92, height: 44, padding: 4, boxSizing: 'border-box', borderRadius: 999, background: 'var(--fill)' }}>
      <span style={{ position: 'absolute', top: 4, left: 4, width: 42, height: 36, borderRadius: 999, background: 'var(--card)', boxShadow: 'var(--cardShadow)', transition: 'transform .25s cubic-bezier(.3,.9,.3,1)', transform: `translateX(${dark ? 42 : 0}px)` }} />
      <button onClick={() => set(false)} aria-label="Light mode" aria-pressed={!dark} style={btn(!dark)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg></button>
      <button onClick={() => set(true)} aria-label="Dark mode" aria-pressed={dark} style={btn(dark)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg></button>
    </div>
  );
}
