import type { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { SignJWT, jwtVerify } from 'jose';
import { db } from './db';
import { cfg } from './config';
import { forbidden, unauthorized } from './http';

export const SESSION_COOKIE = 'cp_session';
export const OAUTH_COOKIE = 'cp_oauth';
export type Access = 'member' | 'power' | 'admin';
export type SessionUser = { id: string; email: string; name: string; access: Access };

const key = () => new TextEncoder().encode(cfg.sessionSecret);
const asAccess = (a: string): Access => (a === 'admin' || a === 'power' ? a : 'member');
const toSession = (u: { id: string; email: string; name: string; access: string }): SessionUser => ({ id: u.id, email: u.email, name: u.name, access: asAccess(u.access) });

// ---------- cookies ----------
export function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return undefined; }
    }
  }
  return undefined;
}
export const setCookie = (res: Response, name: string, value: string, maxAgeSec: number) =>
  res.cookie(name, value, { httpOnly: true, sameSite: 'lax', secure: cfg.cookieSecure, maxAge: maxAgeSec * 1000, path: '/' });
export const clearCookie = (res: Response, name: string) => res.cookie(name, '', { httpOnly: true, sameSite: 'lax', secure: cfg.cookieSecure, maxAge: 0, path: '/' });

// ---------- session cookie ----------
export async function signSession(u: SessionUser) {
  return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(u.id).setIssuedAt().setExpirationTime(`${cfg.sessionHours}h`).sign(key());
}
export const setSessionCookie = (res: Response, token: string) => setCookie(res, SESSION_COOKIE, token, cfg.sessionHours * 3600);

// The token only holds the user's id. Access is read from the database on every request,
// so a change takes effect immediately without signing out.
export async function currentUser(req: Request): Promise<SessionUser | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] });
    const u = payload.sub ? await db.user.findUnique({ where: { id: payload.sub } }) : null;
    return u ? toSession(u) : null;
  } catch { return null; }
}
export async function requireUser(req: Request) {
  const u = await currentUser(req);
  if (!u) throw unauthorized();
  return u;
}
// Power users and admins can delete CCBs.
export async function requirePower(req: Request) {
  const u = await requireUser(req);
  if (u.access === 'member') throw forbidden('Only a power user or an admin can delete a CCB.');
  return u;
}
export async function requireAdmin(req: Request) {
  const u = await requireUser(req);
  if (u.access !== 'admin') throw forbidden('Admins only');
  return u;
}

// ---------- who may sign in ----------
export const isAllowedEmail = (email: string) => {
  const d = email.toLowerCase().split('@')[1];
  return !!d && cfg.allowedDomains.includes(d);
};
// People listed in BOOTSTRAP_ADMINS become admins the first time they sign in. Everyone else starts as a member.
const bootstrapAccess = (email: string): Access => (cfg.bootstrapAdmins.includes(email.toLowerCase()) ? 'admin' : 'member');

// ---------- Google ----------
export const googleConfigured = () => !!(cfg.google.clientId && cfg.google.clientSecret);
let google: OAuth2Client | undefined;
const gclient = () => (google ??= new OAuth2Client(cfg.google.clientId, cfg.google.clientSecret, cfg.google.redirectUri));
export const googleUrl = (state: string) => gclient().generateAuthUrl({ scope: ['openid', 'email', 'profile'], state, prompt: 'select_account', access_type: 'online' });

// Swaps the code for an ID token, then verifies it and the company domain on the server.
// The first time someone signs in, they are added as a new user automatically (a member, or an admin if listed in
// BOOTSTRAP_ADMINS). There is no other way to sign in or to sign up.
export async function googleCallback(code: string): Promise<SessionUser> {
  const { tokens } = await gclient().getToken(code);
  if (!tokens.id_token) throw unauthorized('No identity returned by Google');
  const ticket = await gclient().verifyIdToken({ idToken: tokens.id_token, audience: cfg.google.clientId });
  const p = ticket.getPayload();
  if (!p?.email || !p.email_verified) throw unauthorized('Google account email is not verified');
  if (!isAllowedEmail(p.email)) throw unauthorized('This account is not part of an allowed company domain');
  const email = p.email.toLowerCase();
  const existing = await db.user.findUnique({ where: { email } });
  const access = existing ? (bootstrapAccess(email) === 'admin' ? 'admin' : existing.access) : bootstrapAccess(email);
  const u = await db.user.upsert({ where: { email }, update: { lastLoginAt: new Date(), access }, create: { email, name: p.name || email.split('@')[0], access, lastLoginAt: new Date() } });
  return toSession(u);
}

// Local development only: sign in as a seeded user without Google credentials.
export async function devLogin(email: string): Promise<SessionUser> {
  if (!cfg.devLogin) throw unauthorized();
  const u = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
  if (!u) throw unauthorized('Unknown user');
  return toSession(u);
}
