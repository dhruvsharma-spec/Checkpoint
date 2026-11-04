'use client';
import { DEV_USERS, type Flow } from './useLoginFlow';

export function GoogleMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.4 3.62v3h3.88c2.27-2.09 3.57-5.17 3.57-8.81z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.91l-3.88-3a7.18 7.18 0 0 1-10.7-3.77H1.33v3.1A12 12 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.37 14.32a7.2 7.2 0 0 1 0-4.64v-3.1H1.33a12 12 0 0 0 0 10.84l4.04-3.1z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44A11.94 11.94 0 0 0 12 0 12 12 0 0 0 1.33 6.58l4.04 3.1A7.15 7.15 0 0 1 12 4.77z" />
    </svg>
  );
}

export function BrandMark({ size = 30, id = 'bm' }: { size?: number; id?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <defs><linearGradient id={id} x1="0" y1="0" x2="32" y2="32"><stop offset="0" stopColor="#5CF2D6" /><stop offset="1" stopColor="#6A7BFF" /></linearGradient></defs>
      <rect width="32" height="32" rx="10" fill={`url(#${id})`} />
      <path d="M9 16.5l4.8 4.8L23 11" stroke="#00001E" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ErrorNote({ flow }: { flow: Flow }) {
  return flow.err ? <div role="alert" className="lg-err">{flow.err}</div> : null;
}

export function DevLogin({ flow }: { flow: Flow }) {
  if (!flow.cfg?.devLogin) return null;
  return (
    <div className="lg-dev">
      <div className="lg-dev-t">Local development only</div>
      <div className="lg-dev-r">{DEV_USERS.map(([e, n]) => <button key={e} type="button" className="lg-dev-b" onClick={() => flow.devLogin(e)}>{n}</button>)}</div>
    </div>
  );
}

