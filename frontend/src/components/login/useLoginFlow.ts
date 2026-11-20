'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
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
const STEP_TIMERS_MS = [450, 900, 1350];
const MIN_LOADING_MS = 1600;
const REDIRECT_OUT_MS = 900;

/** All sign-in behaviour lives here so every visual design shares the same logic. */
export function useLoginFlow() {
  const router = useRouter();
  const qs = useSearchParams();
  const next = qs.get('next') && qs.get('next')!.startsWith('/') ? qs.get('next')! : '/';
  const ssoComplete = qs.get('sso') === 'complete' && !qs.get('error');
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [err, setErr] = useState(qs.get('error') ? (ERRORS[qs.get('error')!] ?? 'Sign-in failed.') + (qs.get('reason') ? ` (${qs.get('reason')})` : '') : '');
  const [phase, setPhase] = useState<'form' | 'loading'>(ssoComplete ? 'loading' : 'form');
  const [step, setStep] = useState(0);
  const [msg, setMsg] = useState(ssoComplete ? 'Opening the gate' : '');
  const finishing = useRef(false);

  const startSteps = useCallback(() => {
    setStep(0);
    return STEP_TIMERS_MS.map((ms, i) => setTimeout(() => setStep(i + 1), ms));
  }, []);

  const finishAndGo = useCallback(
    async (dest: string, label: string) => {
      if (finishing.current) return;
      finishing.current = true;
      setErr('');
      setMsg(label);
      setPhase('loading');
      const timers = startSteps();
      try {
        await api('/auth/me');
        await new Promise((r) => setTimeout(r, MIN_LOADING_MS));
        router.replace(dest);
      } catch {
        finishing.current = false;
        timers.forEach(clearTimeout);
        setPhase('form');
        setErr('Sign-in did not complete. Please try again.');
      }
    },
    [router, startSteps],
  );

  useEffect(() => {
    api<Cfg>('/auth/config').then(setCfg).catch(() => {});
  }, []);

  useEffect(() => {
    if (ssoComplete) {
      const dest = qs.get('next') && qs.get('next')!.startsWith('/') ? qs.get('next')! : '/';
      finishAndGo(dest, 'Opening the gate');
      return;
    }
    api('/auth/me')
      .then(() => router.replace(next))
      .catch(() => {});
  }, [finishAndGo, next, qs, router, ssoComplete]);

  const run = async (label: string, request: () => Promise<unknown>) => {
    setErr('');
    setMsg(label);
    setPhase('loading');
    const timers = startSteps();
    try {
      await Promise.all([request(), new Promise((r) => setTimeout(r, MIN_LOADING_MS))]);
      router.replace(next);
    } catch (e) {
      timers.forEach(clearTimeout);
      setPhase('form');
      setErr(e instanceof ApiError ? e.message : 'Something went wrong. Please try again.');
    }
  };

  const leaveForProvider = (label: string, url: string) => {
    setErr('');
    setMsg(label);
    setPhase('loading');
    const timers = startSteps();
    window.setTimeout(() => {
      timers.forEach(clearTimeout);
      window.location.href = url;
    }, REDIRECT_OUT_MS);
  };

  const google = () => leaveForProvider('Redirecting to Google', `/api/auth/google?next=${encodeURIComponent(next)}`);
  const oidc = () => leaveForProvider('Redirecting to company sign-in', `/api/auth/oidc?next=${encodeURIComponent(next)}`);
  const devLogin = (email: string) => run('Signing in for local development', () => api('/auth/dev-login', { body: { email } }));
  const accessNote = !cfg
    ? ''
    : cfg.domains.length
      ? `Access is limited to ${cfg.domains.map((d) => '@' + d).join(' and ')} accounts.`
      : 'Anyone your company SSO administrator allows on the IdP can sign in.';

  return { cfg, err, phase, step, msg, google, oidc, devLogin, accessNote };
}
export type Flow = ReturnType<typeof useLoginFlow>;