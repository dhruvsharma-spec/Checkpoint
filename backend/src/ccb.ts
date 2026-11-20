import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { db } from './db';
import { bad, conflict, forbidden, notFound } from './http';
import { enqueue } from './mail';
import { approvalRequest, decisionNotice, reminder, CcbMail, MailStage } from './mail.templates';
import { statusOf } from './status';
import { BUSINESS_UNITS, CATEGORIES, COMMON_FIELDS, ENVIRONMENTS, LEGACY_FIELDS, OTHER, Spec, applies } from './templates';
import { calendarEvents } from './activities';
import { GROUPED, isOwner, kindOf, labelFor, reachableFor, roleOf, serviceTeams, type Owner } from './approvers';
import { isAllowedEmail, type SessionUser } from './auth';
import { cfg } from './config';
import * as S from './schemas';

const WINDOW_SLACK_MS = 2 * 60_000;

const include = {
  requester: { select: { id: true, name: true, email: true } },
  approvals: { include: { decidedBy: { select: { name: true } } }, orderBy: [{ stage: 'asc' as const }, { id: 'asc' as const }] },
} satisfies Prisma.CcbInclude;
type Full = Prisma.CcbGetPayload<{ include: typeof include }>;
type Appr = Full['approvals'][number];
type Data = Record<string, string>;

// ---------- who answers what ----------
// Each approval names the one person picked for it. CCBs filed before people were picked have none, and then anyone
// listed for the role (and team) can answer.
const answerers = (c: Full, a: Appr): Owner[] => (a.email ? [{ name: a.name || a.email, email: a.email }] : reachableFor(a.role, a.group || c.devTeam));
const mayAnswer = (email: string, c: Full, a: Appr) => answerers(c, a).some((o) => o.email === email.toLowerCase());
const labelOf = (a: Appr) => a.label || labelFor(a.role, a.group);

// ---------- shaping ----------
const typeNames = async () => Object.fromEntries((await db.template.findMany({ select: { key: true, name: true } })).map((t) => [t.key, t.name])) as Record<string, string>;
const dataOf = (c: Full) => (c.data ?? {}) as unknown as Data;

function dto(c: Full, names: Record<string, string>) {
  return {
    code: c.code, type: c.type, typeName: names[c.type] ?? c.type, title: c.title, environment: c.environment, risk: c.risk,
    windowAt: c.windowAt, windowEndAt: c.windowEndAt, createdAt: c.createdAt,
    businessUnit: c.businessUnit, systemOwner: c.systemOwner, ownerTeam: c.ownerTeam, devTeam: c.devTeam,
    requester: { name: c.requester.name, email: c.requester.email },
    status: statusOf(c), pending: c.approvals.filter((a) => a.status === 'PENDING').map(labelOf), implementation: c.implementation, data: dataOf(c),
    approvals: c.approvals.map((a) => ({
      id: a.id, stage: a.stage, label: labelOf(a), role: roleOf(a.role), group: a.group, kind: kindOf(a.role), owners: answerers(c, a),
      status: a.status, decidedAt: a.decidedAt, decidedBy: a.decidedBy?.name ?? null, note: a.note,
    })),
  };
}

// Everything an email needs to show the change: its answers labelled the way the form labelled them.
async function mailCtx(c: Full): Promise<CcbMail> {
  const tpl = await db.template.findUnique({ where: { key: c.type } });
  const spec = tpl?.spec as unknown as Spec | undefined;
  const data = dataOf(c);
  const details = [...(spec?.questions ?? []).map((q) => ({ l: q.l, v: data[q.k] === OTHER && data[`${q.k}_other`] ? `${OTHER}: ${data[`${q.k}_other`]}` : data[q.k] })), ...(spec?.fields ?? []).map((f) => ({ l: f.l, v: data[f.k] }))].filter((d) => d.v);
  return {
    code: c.code, title: c.title, typeName: tpl?.name ?? c.type, risk: c.risk, environment: c.environment,
    businessUnit: c.businessUnit, ownerTeam: c.ownerTeam, devTeam: c.devTeam,
    requester: { name: c.requester.name, email: c.requester.email }, systemOwner: c.systemOwner || c.requester.email,
    windowAt: c.windowAt, windowEndAt: c.windowEndAt, data, details,
    stages: c.approvals.map((a): MailStage => ({ id: a.id, stage: a.stage, role: roleOf(a.role), label: labelOf(a), who: a.name, status: a.status })),
  };
}
async function find(code: string): Promise<Full> {
  const c = await db.ccb.findUnique({ where: { code }, include });
  if (!c) throw notFound('CCB not found');
  return c;
}
const canManage = (u: SessionUser, c: Full) => u.access !== 'member' || c.requester.id === u.id || c.approvals.some((a) => mayAnswer(u.email, c, a));
const audit = (ccbId: string | null, actorId: string | null, action: string, detail?: Prisma.InputJsonValue) => db.auditLog.create({ data: { ccbId, actorId, action, detail } });

// Emails everyone who still has to answer, all at once: one email per step, to the person picked for it.
// Returns how many emails were queued.
async function askPending(c: Full, actorId: string | null) {
  const ctx = await mailCtx(c);
  let sent = 0;
  for (const a of c.approvals.filter((x) => x.status === 'PENDING')) {
    const to = answerers(c, a).map((o) => o.email);
    if (!to.length) { await audit(c.id, actorId, `Nobody with an email is listed for ${labelOf(a)}, so nobody was emailed for it`); continue; }
    await enqueue({ to, ...approvalRequest(ctx, a.id) });
    sent++;
  }
  return sent;
}

// ---------- catalog ----------
// Only the types listed in ENABLED_CCB_TYPES can be filed ("all" turns every one on). The others are still described,
// so CCBs that already exist show properly.
const isEnabled = (key: string) => cfg.enabledTypes.includes('all') || cfg.enabledTypes.includes(key);
const requireEnabled = (key: string) => { if (!isEnabled(key)) throw bad('This kind of CCB is not available yet.'); };

export async function catalog() {
  const rows = await db.template.findMany({ orderBy: { sort: 'asc' } });
  return {
    templates: rows.map((t) => { const spec = t.spec as unknown as Spec; return { key: t.key, name: t.name, category: t.category, enabled: isEnabled(t.key), manual: t.manual, blurb: t.blurb, tone: t.tone, series: t.series, defaultRisk: t.defaultRisk, questions: spec.questions, fields: spec.fields }; }),
    common: COMMON_FIELDS, legacy: LEGACY_FIELDS, environments: ENVIRONMENTS, categories: CATEGORIES, businessUnits: [...BUSINESS_UNITS], other: OTHER,
  };
}

// ---------- create / read ----------
async function nextCode(series: string) {
  const key = series === 'dt' ? 'dt' : 'ccb';
  const c = await db.counter.upsert({ where: { key }, update: { value: { increment: 1 } }, create: { key, value: key === 'dt' ? 15001 : 1 } });
  return key === 'dt' ? `DT-${c.value}` : `CCB-${String(c.value).padStart(4, '0')}`;
}

export async function create(u: SessionUser, b: z.infer<typeof S.createCcb>) {
  const tpl = await db.template.findUnique({ where: { key: b.template } });
  if (!tpl) throw bad('Unknown CCB type');
  requireEnabled(tpl.key);
  const spec = tpl.spec as unknown as Spec;
  const data: Data = {};
  const missing: string[] = [];
  for (const q of spec.questions) {
    const v = String(b.data[q.k] ?? '').trim();
    if (!q.opts.some((o) => o.v === v)) { missing.push(q.l); continue; }
    data[q.k] = v;
    if (v === OTHER) {
      const note = String(b.data[`${q.k}_other`] ?? '').trim().slice(0, 500);
      if (note) data[`${q.k}_other`] = note; else missing.push(`${q.l} (describe "${OTHER}")`);
    }
  }
  for (const f of [...spec.fields, ...COMMON_FIELDS]) {
    if (!applies(f, data)) continue;
    let v = String(b.data[f.k] ?? '').trim().slice(0, 5000);
    if (!v && f.t === 'select') v = f.opts?.[0] ?? '';
    if (f.t === 'yesno' && v && v !== 'Yes' && v !== 'No') v = '';
    if (v) data[f.k] = v; else if (!f.opt) missing.push(f.l);
  }
  if (missing.length) throw bad('Required fields are missing', { missing });
  const start = new Date(b.windowAt), end = new Date(b.windowEndAt);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) throw bad('The change window needs a valid start and end');
  if (end <= start) throw bad('The change window must end after it starts');
  // A change cannot be scheduled in the past. The form already refuses it; this is the same rule for anyone calling the
  // API directly. The slack covers clock differences and the seconds a submit takes, so picking "now" still works.
  if (start.getTime() < Date.now() - WINDOW_SLACK_MS) throw bad('The change window cannot start in the past');

  // Everyone picked, checked against the lists: each must be listed, with an email, where they were picked from.
  const rows: { role: string; group: string; email: string; name: string }[] = [];
  const add = (role: string, group: string, emails: string[]) => {
    for (const email of emails) {
      const o = reachableFor(role, group).find((x) => x.email === email);
      if (!o) throw bad(`${email} is not listed with an email for ${labelFor(role, group)}.`);
      if (!rows.some((r) => r.role === role && r.group === group && r.email === email)) rows.push({ role, group, email, name: o.name });
    }
  };
  for (const s of b.service) {
    const listed = serviceTeams().some((g) => g.name.toLowerCase() === s.team.toLowerCase());
    if (s.other) {
      // A team that is not listed: its name is typed in, and exactly one approver, who must have a company email.
      if (listed) throw bad(`${s.team} is already on the list. Pick it from the list.`);
      if (s.approvers.length !== 1) throw bad(`Give exactly one approver for ${s.team}.`);
      if (!isAllowedEmail(s.approvers[0])) throw bad(`Only company emails (${cfg.allowedDomains.join(' or ')}) can be approvers: ${s.approvers[0]}`);
      if (!rows.some((r) => r.group === s.team && r.email === s.approvers[0])) rows.push({ role: GROUPED, group: s.team, email: s.approvers[0], name: s.approvers[0] });
      continue;
    }
    if (!listed) throw bad(`Unknown team: ${s.team}`);
    add(GROUPED, serviceTeams().find((g) => g.name.toLowerCase() === s.team.toLowerCase())!.name, s.approvers);
  }
  // Pratiti is always a Platform approver (when she has an email), whatever was picked.
  const pratiti = reachableFor('LK Platform').find((o) => /^pratiti\b/i.test(o.name));
  if (pratiti && !(b.people['LK Platform'] ?? []).includes(pratiti.email)) b.people['LK Platform'] = [pratiti.email, ...(b.people['LK Platform'] ?? [])];
  for (const role of ['LK Platform', 'Security', 'QA', 'DevOps', 'DataOps'] as const) add(role, '', b.people[role] ?? []);

  const teams = Array.from(new Set(b.service.map((s) => s.team)));
  const code = await nextCode(tpl.series);
  const c = await db.ccb.create({
    data: {
      code, type: tpl.key, title: b.title, environment: b.environment, risk: b.risk, windowAt: start, windowEndAt: end,
      ownerTeam: teams.join(', '), devTeam: teams[0], businessUnit: b.businessUnit, systemOwner: b.systemOwner.toLowerCase(),
      requesterId: u.id, data, approvals: { create: rows.map((r, i) => ({ ...r, stage: i + 1, label: labelFor(r.role, r.group) })) },
    },
    include,
  });
  await audit(c.id, u.id, `${code} filed. Asked: ${rows.map((r) => `${r.name} (${labelFor(r.role, r.group)})`).join(', ')}`, { asked: rows.map((r) => ({ role: r.role, group: r.group, email: r.email })) });
  const notified = await askPending(c, u.id);
  return { ...dto(c, await typeNames()), notified };
}

export async function list(q: { type?: string; q?: string }) {
  const where: Prisma.CcbWhereInput = {};
  if (q.type) where.type = q.type;
  // MySQL's default collation compares case-insensitively, so this matches "cdn" and "CDN" alike.
  if (q.q) where.OR = [{ code: { contains: q.q } }, { title: { contains: q.q } }, { requester: { name: { contains: q.q } } }];
  const [rows, names] = await Promise.all([db.ccb.findMany({ where, include, orderBy: { windowAt: 'asc' }, take: 500 }), typeNames()]);
  return rows.map((c) => dto(c, names));
}

export async function get(code: string) {
  const c = await find(code);
  const [comments, trail, analyses, names] = await Promise.all([
    db.comment.findMany({ where: { ccbId: c.id }, include: { author: { select: { name: true } } }, orderBy: { createdAt: 'asc' } }),
    db.auditLog.findMany({ where: { ccbId: c.id }, include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, take: 50 }),
    db.analysis.findMany({ where: { ccbId: c.id }, include: { author: { select: { name: true } } } }),
    typeNames(),
  ]);
  return {
    ...dto(c, names),
    analyses: analyses.map((a) => ({ team: a.team, body: a.body, by: a.author.name, at: a.updatedAt })),
    comments: comments.map((m) => ({ id: m.id, who: m.author.name, body: m.body, at: m.createdAt })),
    audit: trail.map((a) => ({ id: a.id, text: a.action, who: a.actor?.name ?? null, at: a.createdAt })),
  };
}

// ---------- decisions ----------
// Everyone is asked at once and answers on their own. A person answers for the steps they were picked for that are
// still pending; b.id picks one when they have several (otherwise all of theirs are answered together).
export async function decide(u: SessionUser, code: string, b: z.infer<typeof S.decision>) {
  const c = await find(code);
  const st = statusOf(c);
  if (st === 'Rolled out' || st === 'Rolled back') throw conflict('This change is already closed');
  if (st === 'Rejected') throw conflict('This change was rejected. File a new one with the fixes.');
  if (st === 'Cleared') throw conflict('Everyone has already approved this change');
  const mine = c.approvals.filter((a) => a.status === 'PENDING' && mayAnswer(u.email, c, a) && (!b.id || a.id === b.id));
  if (!mine.length) throw forbidden('You are not asked for a step on this change that is still waiting');
  const approved = b.decision === 'approve';
  if (!approved && (b.note ?? '').trim().length < 3) throw bad('Add a reason when rejecting a change');
  await db.approval.updateMany({
    where: { id: { in: mine.map((a) => a.id) } },
    data: { status: approved ? 'APPROVED' : 'REJECTED', decidedById: u.id, decidedAt: new Date(), note: b.note?.trim() || null },
  });
  const by = mine.map(labelOf).join(', ');
  for (const a of mine) await audit(c.id, u.id, `${labelOf(a)} ${approved ? 'approved' : 'rejected'} ${code}`, { role: a.role, group: a.group, note: b.note ?? null });
  const fresh = await find(code);
  await enqueue({ to: [fresh.requester.email], ...decisionNotice(await mailCtx(fresh), by, approved, statusOf(fresh) === 'Cleared', b.note?.trim()) });
  return dto(fresh, await typeNames());
}

export async function implementation(u: SessionUser, code: string, result: 'landed' | 'rolled_back') {
  const c = await find(code);
  if (!canManage(u, c)) throw forbidden();
  if (statusOf(c) !== 'Cleared') throw conflict('Only a cleared change can be closed out');
  await db.ccb.update({ where: { id: c.id }, data: { implementation: result === 'landed' ? 'LANDED' : 'ROLLED_BACK' } });
  await audit(c.id, u.id, `${code} ${result === 'landed' ? 'rolled out successfully' : 'rolled back'}`);
  return dto(await find(code), await typeNames());
}

export async function comment(u: SessionUser, code: string, body: string) {
  const c = await find(code);
  await db.comment.create({ data: { ccbId: c.id, authorId: u.id, body } });
  await audit(c.id, u.id, `${u.name} commented on ${code}`);
  return get(code);
}

export async function remind(u: SessionUser, code: string, id: string) {
  const c = await find(code);
  if (!canManage(u, c)) throw forbidden();
  const a = c.approvals.find((x) => x.id === id && x.status === 'PENDING');
  if (!a) throw bad('That step is not waiting for anyone');
  const action = `Reminder sent to ${labelOf(a)}${a.name ? ` (${a.name})` : ''}`;
  const recent = await db.auditLog.findFirst({ where: { ccbId: c.id, action, createdAt: { gt: new Date(Date.now() - 3600_000) } } });
  if (recent) throw conflict('A reminder was already sent for this step in the last hour');
  const to = answerers(c, a).map((o) => o.email);
  if (!to.length) throw bad(`Nobody with an email is listed for ${labelOf(a)}`);
  await enqueue({ to, ...reminder(await mailCtx(c), a.id, u.name) });
  await audit(c.id, u.id, action);
  return { ok: true, sentTo: to.length };
}

// ---------- analysis by DevOps, DataOps and QA, added after the CCB is filed ----------
export async function saveAnalysis(u: SessionUser, code: string, b: z.infer<typeof S.analysis>) {
  const c = await find(code);
  if (!isOwner(u.email, b.team)) throw forbidden(`Only people listed for ${b.team} can add its analysis.`);
  const had = await db.analysis.findUnique({ where: { ccbId_team: { ccbId: c.id, team: b.team } } });
  await db.analysis.upsert({ where: { ccbId_team: { ccbId: c.id, team: b.team } }, update: { body: b.body, authorId: u.id }, create: { ccbId: c.id, team: b.team, body: b.body, authorId: u.id } });
  await audit(c.id, u.id, `${b.team} analysis ${had ? 'updated' : 'added'} by ${u.name}`);
  return get(code);
}

// ---------- calendar and dashboard ----------
export async function calendar(from: Date, to: Date, includePending: boolean) {
  const [ccbs, names, activityEvents] = await Promise.all([
    db.ccb.findMany({ where: { windowAt: { gte: from, lt: to } }, include }),
    typeNames(),
    calendarEvents(from, to),
  ]);
  const events: { kind: string; at: Date; code: string; title: string; sub: string }[] = [];
  for (const c of ccbs) {
    const s = statusOf(c);
    const sub = `${c.code} · ${names[c.type] ?? c.type} · ${s}`;
    if (s === 'Cleared' || s === 'Rolled out' || s === 'Rolled back') events.push({ kind: 'release', at: c.windowAt, code: c.code, title: c.title, sub });
    else if (includePending && s === 'Awaiting') events.push({ kind: 'pending', at: c.windowAt, code: c.code, title: c.title, sub });
  }
  events.push(...activityEvents);
  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export async function dashboard(u: SessionUser) {
  const [rows, names] = await Promise.all([db.ccb.findMany({ include, orderBy: { windowAt: 'asc' }, take: 300 }), typeNames()]);
  const all = rows.map((c) => ({ c, d: dto(c, names) }));
  // "Waiting on you" means a step you were picked for on that change is still pending.
  const mine = all.filter(({ c, d }) => d.status === 'Awaiting' && c.approvals.some((a) => a.status === 'PENDING' && mayAnswer(u.email, c, a)));
  const now = new Date();
  const open = all.filter(({ d }) => d.status === 'Awaiting' || d.status === 'Cleared');
  const next = open.find(({ c }) => c.windowAt >= now) ?? open[0] ?? null;
  const count = (s: string) => all.filter(({ d }) => d.status === s).length;
  return {
    kpis: { awaitingYou: mine.length, inFlight: count('Awaiting'), cleared: count('Cleared'), rejected: count('Rejected') },
    queue: mine.map(({ d }) => d), next: next?.d ?? null,
    upcoming: all.filter(({ c, d }) => d.status === 'Cleared' && c.windowAt >= now).slice(0, 4).map(({ d }) => d),
  };
}

// Org-wide home insights — not personalised to the signed-in user.
export async function insights() {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 86400_000);
  const [rows, names, activityRows, activityUpcoming, activityRecent, users, filedWeek] = await Promise.all([
    db.ccb.findMany({ include, orderBy: { windowAt: 'asc' }, take: 500 }),
    typeNames(),
    db.activity.findMany({
      where: { startsAt: { gte: now } },
      include: { createdBy: { select: { name: true, email: true } } },
      orderBy: { startsAt: 'asc' },
      take: 5,
    }),
    db.activity.count({ where: { startsAt: { gte: now } } }),
    db.activity.count({ where: { startsAt: { gte: weekAgo, lt: now } } }),
    db.user.count(),
    db.ccb.count({ where: { createdAt: { gte: weekAgo } } }),
  ]);
  const all = rows.map((c) => ({ c, d: dto(c, names) }));
  const count = (s: string) => all.filter(({ d }) => d.status === s).length;
  const upcomingChanges = all
    .filter(({ c, d }) => (d.status === 'Cleared' || d.status === 'Awaiting') && c.windowAt >= now)
    .slice(0, 5)
    .map(({ d }) => d);
  const recentFiled = [...all].sort((a, b) => b.c.createdAt.getTime() - a.c.createdAt.getTime()).slice(0, 5).map(({ d }) => d);
  const upcomingActivities = activityRows.map((a) => ({
    id: a.id, title: a.title, summary: a.summary, team: a.team,
    startsAt: a.startsAt, endsAt: a.endsAt, createdBy: a.createdBy,
  }));
  return {
    kpis: {
      total: all.length,
      awaiting: count('Awaiting'),
      cleared: count('Cleared'),
      rejected: count('Rejected'),
      rolledOut: count('Rolled out'),
      filedThisWeek: filedWeek,
      activitiesUpcoming: activityUpcoming,
      activitiesRecent: activityRecent,
      people: users,
    },
    upcomingChanges,
    upcomingActivities,
    recentFiled,
  };
}

// ---------- delete (power users and admins) ----------
export async function remove(u: SessionUser, code: string) {
  const c = await find(code);
  // The record of the deletion is kept: audit entries are not tied to the CCB, so they outlive it.
  await audit(null, u.id, `${code} (${c.title}) was deleted by ${u.name}`, { code, status: statusOf(c), requester: c.requester.email });
  await db.ccb.delete({ where: { id: c.id } });
  return { ok: true };
}
