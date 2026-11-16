'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api, ApiError } from '@/lib/api';

export type Cfg = { google: boolean; oidc: { enabled: boolean; label: string }; devLogin: boolean; domains: string[] };

const ERRORS: Record<string, string> = {
  google_not_configured: 'Google sign-in is not set up on this server yet.',
  domain: 'That Google account is not part of an allowed company domain.',
  state: 'The sign-in session expired. Please try again.',
  google: 'Google sign-in did not complete. Please try again.',
  oidc_not_configured: 'Company sign-in is not set up on this server yet.',
  oidc: 'Company sign-in did not complete. Please try again.',
  oidc_denied: 'The company sign-in refused this request',
};

export const DEV_USERS: [string, string][] = [['dhruv.sharma@lenskart.com', 'Dhruv']];
export const STEPS = ['Verifying your company domain', 'Reading your group memberships', 'Mapping your roles'];

/** All sign-in behaviour lives here so every visual design shares the same logic. */
export function useLoginFlow() {
  const router = useRouter();
  const qs = useSearchParams();
  const next = qs.get('next') && qs.get('next')!.startsWith('/') ? qs.get('next')! : '/';
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [err, setErr] = useState(qs.get('error') ? (ERRORS[qs.get('error')!] ?? 'Sign-in failed.') + (qs.get('reason') ? ` (${qs.get('reason')})` : '') : '');
  const [phase, setPhase] = useState<'form' | 'loading'>('form');
  const [step, setStep] = useState(0);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api<Cfg>('/auth/config').then(setCfg).catch(() => {});
    api('/auth/me').then(() => router.replace(next)).catch(() => {});
  }, [router, next]);

  const run = async (label: string, request: () => Promise<unknown>) => {
    setErr(''); setMsg(label); setPhase('loading'); setStep(0);
    const timers = [450, 900, 1350].map((ms, i) => setTimeout(() => setStep(i + 1), ms));
    try {
      await Promise.all([request(), new Promise((r) => setTimeout(r, 1600))]);
      router.replace(next);
    } catch (e) {
      timers.forEach(clearTimeout);
      setPhase('form'); setErr(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    }
  };
  const google = () => { window.location.href = `/api/auth/google?next=${encodeURIComponent(next)}`; };
  // The company IdP: same redirect pattern, the backend does the rest.
  const oidc = () => { window.location.href = `/api/auth/oidc?next=${encodeURIComponent(next)}`; };
  const devLogin = (email: string) => run('Signing in for local development', () => api('/auth/dev-login', { body: { email } }));
  const domains = cfg ? cfg.domains.map((d) => '@' + d).join(' and ') : 'company';

  return { cfg, err, phase, step, msg, google, oidc, devLogin, domains };
}
export type Flow = ReturnType<typeof useLoginFlow>;
