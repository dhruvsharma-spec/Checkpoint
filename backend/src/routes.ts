import { Router } from 'express';
import { randomBytes } from 'crypto';
import * as A from './auth';
import * as O from './oidc';
import * as ccb from './ccb';
import { cfg } from './config';
import { db } from './db';
import { HttpError, bad, body, conflict, forbidden, handle } from './http';
import { inventory } from './inventory';
import { GROUPED, approvers, describeChange, saveApprovers, stepsOfEmail, type Owner } from './approvers';
import * as S from './schemas';

export const api = Router();
const param = (v: string | string[] | undefined) => decodeURIComponent(String(v ?? ''));
const safeNext = (n?: string | null) => (n && n.startsWith('/') && !n.startsWith('//') ? n : '/');

// ---------- health (public, used by the Kubernetes probes) ----------
// /health checks the database too (readiness: stop sending traffic). /live does not (liveness: a database outage must
// not restart every pod).
api.get('/health', handle(async () => { await db.$queryRaw`SELECT 1`; return { ok: true }; }));
api.get('/live', (_req, res) => void res.json({ ok: true }));

// ---------- auth ----------
// Public: tells the sign-in page which options to show.
api.get('/auth/config', handle(async () => ({ google: A.googleConfigured(), oidc: { enabled: O.oidcConfigured(), label: cfg.oidc.label }, devLogin: cfg.devLogin, domains: cfg.allowedDomains })));

api.get('/auth/me', handle(async (req) => A.requireUser(req)));

// The signed-in person's own details: who they are, what they may do, which steps they answer for.
api.get('/me', handle(async (req) => {
  const me = await A.requireUser(req);
  const [u, filed] = await Promise.all([
    db.user.findUnique({ where: { id: me.id }, select: { createdAt: true, lastLoginAt: true } }),
    db.ccb.count({ where: { requesterId: me.id } }),
  ]);
  return { name: me.name, email: me.email, access: me.access, approves: stepsOfEmail(me.email), createdAt: u?.createdAt ?? null, lastLoginAt: u?.lastLoginAt ?? null, filed };
}));

api.post('/auth/logout', handle(async (_req, res) => { A.clearCookie(res, A.SESSION_COOKIE); return { ok: true }; }));

// Local development only. devLogin() refuses unless APP_ENV=local.
api.post('/auth/dev-login', handle(async (req, res) => {
  const u = await A.devLogin(body(req, S.devLogin).email);
  A.setSessionCookie(res, await A.signSession(u));
  return u;
}));

// Step 1 of Google sign-in: remember a random state and where to return to, then go to Google.
api.get('/auth/google', handle(async (req, res) => {
  if (!A.googleConfigured()) return res.redirect(`${cfg.webUrl}/login?error=google_not_configured`);
  const state = randomBytes(16).toString('hex');
  A.setCookie(res, A.OAUTH_COOKIE, `${state}|${safeNext(String(req.query.next ?? ''))}`, 600);
  res.redirect(A.googleUrl(state));
}));
// Step 2: Google sends the person back here with a code.
api.get('/auth/google/callback', handle(async (req, res) => {
  const [saved, next] = String(A.readCookie(req, A.OAUTH_COOKIE) ?? '').split('|');
  const fail = (e: string) => { A.clearCookie(res, A.OAUTH_COOKIE); res.redirect(`${cfg.webUrl}/login?error=${e}`); };
  const code = String(req.query.code ?? ''), state = String(req.query.state ?? '');
  if (!code || !state || state !== saved) return fail('state');
  try {
    const u = await A.googleCallback(code);
    A.setSessionCookie(res, await A.signSession(u));
    A.clearCookie(res, A.OAUTH_COOKIE);
    res.redirect(cfg.webUrl + safeNext(next));
  } catch (e) {
    fail(e instanceof HttpError ? 'domain' : 'google');
  }
}));

// Step 1 of IdP sign-in: the same shape as Google, but the provider is whatever OIDC_ISSUER points at.
api.get('/auth/oidc', handle(async (req, res) => {
  if (!O.oidcConfigured()) return res.redirect(`${cfg.webUrl}/login?error=oidc_not_configured`);
  const { url, cookie } = await O.begin(safeNext(String(req.query.next ?? '')));
  A.setCookie(res, O.OIDC_COOKIE, cookie, 600);
  res.redirect(url);
}));
// Step 2: the provider sends the browser back here with a code.
api.get('/auth/oidc/callback', handle(async (req, res) => {
  const cookie = A.readCookie(req, O.OIDC_COOKIE) ?? '';
  const fail = (e: string, reason = '') => { A.clearCookie(res, O.OIDC_COOKIE); res.redirect(`${cfg.webUrl}/login?error=${e}${reason ? `&reason=${reason}` : ''}`); };
  const flat = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').slice(0, n);
  // The provider can send the person back with an error instead of a code: access denied for this account, a scope it
  // refuses, an unknown client. Say what it was, in the log and on the login page, rather than a generic message.
  const refused = flat(req.query.error, 40);
  if (refused) {
    console.warn(`OIDC: the provider returned error=${refused} ${flat(req.query.error_description, 200)}`);
    return fail('oidc_denied', refused.replace(/[^a-z_]/gi, ''));
  }
  const code = String(req.query.code ?? ''), state = String(req.query.state ?? '');
  if (!code || !state) {
    console.warn(`OIDC: callback arrived without a code or a state (query keys: ${Object.keys(req.query).join(',') || 'none'})`);
    return fail('state');
  }
  try {
    const { user, next } = await O.finish(code, state, cookie);
    A.setSessionCookie(res, await A.signSession(user));
    A.clearCookie(res, O.OIDC_COOKIE);
    res.redirect(cfg.webUrl + safeNext(next));
  } catch (e) {
    console.warn(`OIDC: sign-in failed: ${flat(e instanceof Error ? e.message : e, 300)}`);
    fail(e instanceof HttpError && e.message.includes('domain') ? 'domain' : 'oidc');
  }
}));

// ---------- who approves what: everyone can see it, only an admin can change it ----------
api.get('/approvers', handle(async (req) => { await A.requireUser(req); return approvers(); }));
api.put('/approvers', handle(async (req) => {
  const admin = await A.requireAdmin(req);
  const b = body(req, S.saveApprovers);
  const before = approvers();
    // Only company addresses can be approvers.
  const everyone: Owner[] = b.roles.flatMap((r) => [...(r.owners ?? []), ...(r.groups ?? []).flatMap((g) => g.owners)]);
  const outside = everyone.filter((o) => o.email && !A.isAllowedEmail(o.email)).map((o) => o.email);
  if (outside.length) throw bad(`Only company emails (${cfg.allowedDomains.join(' or ')}) can be approvers: ${outside.join(', ')}`);
  const names = b.roles.find((r) => r.role === GROUPED)?.groups?.map((g) => g.name.toLowerCase()) ?? [];
  if (new Set(names).size !== names.length) throw bad('Two service teams have the same name.');
  const changes = describeChange(before, b.roles);
  try { await saveApprovers(b.roles); } catch (e) { throw conflict((e as Error).message); }
  if (changes.length) await db.auditLog.create({ data: { actorId: admin.id, action: `Approvers changed by ${admin.name}`, detail: changes } });
  return approvers();
}));

// ---------- access: member, power user, admin. Anyone signed in can look; only admins change it ----------
api.get('/rbac', handle(async (req) => {
  await A.requireUser(req);
  const users = await db.user.findMany({ select: { id: true, name: true, email: true, access: true, lastLoginAt: true }, orderBy: { email: 'asc' }, take: 2000 });
  return { users: users.map((u) => ({ ...u, approves: stepsOfEmail(u.email) })) };
}));
api.patch('/rbac/users/:id', handle(async (req) => {
  const admin = await A.requireAdmin(req);
  const next = body(req, S.access).access;
  if (req.params.id === admin.id) throw forbidden('You cannot change your own access');
  const target = await db.user.findUnique({ where: { id: req.params.id } });
  if (!target) throw bad('That user does not exist');
  if (target.access === 'admin' && next !== 'admin' && (await db.user.count({ where: { access: 'admin' } })) <= 1) throw conflict('There must always be at least one admin');
  const u = await db.user.update({ where: { id: target.id }, data: { access: next }, select: { id: true, name: true, email: true, access: true } });
  await db.auditLog.create({ data: { actorId: admin.id, action: `Access for ${u.email} changed from ${target.access} to ${next}` } });
  return u;
}));
api.post('/rbac/users', handle(async (req, res) => {
  const admin = await A.requireAdmin(req);
  const b = body(req, S.addUser);
  const email = b.email.toLowerCase();
  if (!A.isAllowedEmail(email)) throw bad(`Only company emails (${cfg.allowedDomains.join(' or ')}) can be added.`);
  if (await db.user.findUnique({ where: { email } })) throw conflict('That person is already in the list');
  const u = await db.user.create({ data: { email, name: b.name, access: b.access }, select: { id: true, name: true, email: true, access: true } });
  await db.auditLog.create({ data: { actorId: admin.id, action: `Access for ${email} added with ${b.access} access` } });
  res.status(201).json(u);
}));

// ---------- the database servers offered in the Database CCB ----------
api.get('/inventory', handle(async (req) => { await A.requireUser(req); return inventory(); }));

// ---------- CCBs ----------
api.get('/templates', handle(async (req) => { await A.requireUser(req); return ccb.catalog(); }));
api.get('/dashboard', handle(async (req) => ccb.dashboard(await A.requireUser(req))));
api.get('/calendar', handle(async (req) => {
  await A.requireUser(req);
  const from = new Date(String(req.query.from ?? '')), to = new Date(String(req.query.to ?? ''));
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > 100 * 86400_000) throw bad('Provide a valid from and to range (max 100 days)');
  return ccb.calendar(from, to, req.query.pending === '1');
}));

api.get('/ccbs', handle(async (req) => {
  await A.requireUser(req);
  const s = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  return ccb.list({ type: s(req.query.type), q: s(req.query.q) });
}));
api.post('/ccbs', handle(async (req, res) => {
  const u = await A.requireUser(req);
  const c = await ccb.create(u, body(req, S.createCcb));
  res.status(201).json(c);
}));
api.delete('/ccbs/:code', handle(async (req) => ccb.remove(await A.requirePower(req), param(req.params.code))));
api.get('/ccbs/:code', handle(async (req) => { await A.requireUser(req); return ccb.get(param(req.params.code)); }));
api.post('/ccbs/:code/decision', handle(async (req) => ccb.decide(await A.requireUser(req), param(req.params.code), body(req, S.decision))));
api.post('/ccbs/:code/comments', handle(async (req) => ccb.comment(await A.requireUser(req), param(req.params.code), body(req, S.comment).body)));
api.post('/ccbs/:code/implementation', handle(async (req) => ccb.implementation(await A.requireUser(req), param(req.params.code), body(req, S.implementation).result)));
api.post('/ccbs/:code/remind', handle(async (req) => ccb.remind(await A.requireUser(req), param(req.params.code), body(req, S.remind).id)));
// DevOps, DataOps or QA add their analysis after the CCB is filed. Only people listed for that team can.
api.put('/ccbs/:code/analysis', handle(async (req) => ccb.saveAnalysis(await A.requireUser(req), param(req.params.code), body(req, S.analysis))));
