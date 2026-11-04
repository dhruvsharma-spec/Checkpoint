'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, ApiError } from './api';
import type { User } from './types';

// ---- data fetching ----
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const router = useRouter();
  useEffect(() => {
    if (!path) return;
    let live = true;
    setLoading(true);
    api<T>(path).then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e: ApiError) => { if (live) { setError(e); if (e.status === 401) router.replace('/login'); } })
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [path, tick, router]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

// ---- count up for numbers ----
export function useCountUp(target: number, ms = 800) {
  const [v, setV] = useState(0);
  useEffect(() => {
    let raf = 0, t0 = 0;
    const step = (t: number) => { if (!t0) t0 = t; const p = Math.min(1, (t - t0) / ms); setV(Math.round(target * (1 - Math.pow(1 - p, 3)))); if (p < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

// ---- toast ----
const ToastCtx = createContext<(m: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const show = useCallback((m: string) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(''), 3200); }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div role="status" className="rise card" style={{ position: 'fixed', left: '50%', bottom: 26, transform: 'translateX(-50%)', zIndex: 90, padding: '12px 22px', borderRadius: 999, fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', background: 'var(--toast)', color: 'var(--toastInk)', border: 0 }}>{msg}</div>}
    </ToastCtx.Provider>
  );
}

// ---- confirm: nothing that changes something runs on a single click ----
type ConfirmOpts = { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
// const ok = await confirm({ title: 'Send a reminder?', body: '...', confirmLabel: 'Send reminder' });  if (!ok) return;
export const useConfirm = () => useContext(ConfirmCtx);
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [ask, setAsk] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const confirm = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setAsk({ ...o, resolve })), []);
  const close = (v: boolean) => { ask?.resolve(v); setAsk(null); };
  useEffect(() => {
    if (!ask) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { ask.resolve(false); setAsk(null); } };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [ask]);
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      {ask && (
        <div onMouseDown={(e) => { if (e.target === e.currentTarget) close(false); }} style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(8,10,30,.5)' }}>
          <div role="alertdialog" aria-modal="true" aria-labelledby="cf-t" className="card rise" style={{ width: '100%', maxWidth: 460, padding: 26, background: 'var(--bg)', boxShadow: 'var(--liftShadow)' }}>
            <h2 id="cf-t" className="h2" style={{ fontSize: 21 }}>{ask.title}</h2>
            {ask.body && <div style={{ color: 'var(--ink2)', marginTop: 10, lineHeight: 1.5, fontSize: 14.5 }}>{ask.body}</div>}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 22, flexWrap: 'wrap' }}>
              {/* The safe choice has the focus, so pressing Enter by accident does not confirm. */}
              <button className="btnS" autoFocus onClick={() => close(false)}>Cancel</button>
              <button className={ask.danger ? 'btnD' : 'btnP'} onClick={() => close(true)}>{ask.confirmLabel ?? 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </ConfirmCtx.Provider>
  );
}

// ---- session ----
type Session = { user: User | null; signOut: () => Promise<void>; refresh: () => void };
const SessionCtx = createContext<Session>({ user: null, signOut: async () => {}, refresh: () => {} });
export const useSession = () => useContext(SessionCtx);
export function SessionProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { data, error, reload } = useApi<User>('/auth/me');
  useEffect(() => { if (error?.status === 401) router.replace('/login?next=' + encodeURIComponent(path + window.location.search)); }, [error, router, path]);
  const signOut = useCallback(async () => { await api('/auth/logout', { method: 'POST', body: {} }).catch(() => {}); router.replace('/login'); }, [router]);
  if (!data) return null;
  return <SessionCtx.Provider value={{ user: data, signOut, refresh: reload }}>{children}</SessionCtx.Provider>;
}

export const refreshQueue = () => window.dispatchEvent(new Event('cp-refresh'));
