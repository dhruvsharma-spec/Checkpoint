import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { parse } from 'yaml';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { COMMON_FIELDS, TEMPLATES, applies, type Risk } from '../src/templates';
import { labelFor } from '../src/approvers';
import { SAMPLES } from './samples';

const prisma = new PrismaClient();

// The people loaded at start come from deploy/k8s/users.yaml. If that file is missing or broken, this one
// person is created, so there is always someone who can sign in and fix it. Everyone else signs in with Google
// (or is added under Access Management) and is added to the list automatically.
const FIRST_ADMIN = { email: 'dhruv.sharma@lenskart.com', name: 'Dhruv Sharma', access: 'admin' as const };
const DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS ?? 'lenskart.com,lenskart.in').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
const fileSchema = z.object({ users: z.array(z.object({ name: z.string().trim().min(2).max(100), email: z.string().trim().email(), access: z.enum(['member', 'power', 'admin']).default('member') })).default([]) });

function listedPeople() {
  const file = [process.env.USERS_FILE, '/seed-users/users.yaml', path.resolve(process.cwd(), '../deploy/k8s/users.yaml')].find((f) => f && existsSync(f));
  if (!file) { console.log('no users.yaml found, so only the first admin is created'); return [FIRST_ADMIN]; }
  try {
    const people = fileSchema.parse(parse(readFileSync(file, 'utf8'))).users.map((u) => ({ ...u, email: u.email.toLowerCase() }));
    const ok = people.filter((u) => DOMAINS.includes(u.email.split('@')[1]));
    for (const u of people) if (!ok.includes(u)) console.log(`skipped ${u.email}: not a company email`);
    return ok.length ? ok : [FIRST_ADMIN];
  } catch (e) {
    console.error(`users.yaml could not be read (${(e as Error).message}), so only the first admin is created`);
    return [FIRST_ADMIN];
  }
}

// Earlier versions came with six made-up people and sample CCBs. They are removed here, together with the
// CCBs those people filed. Only these exact addresses are touched, and once they are gone this does nothing.
const OLD_DEMO_PEOPLE = ['you@lenskart.com', 'dev.lead@lenskart.com', 'qe.lead@lenskart.com', 'dba.lead@lenskart.com', 'eng.head@lenskart.com', 'netsec@lenskart.com'];

async function removeOldDemoPeople() {
  const people = await prisma.user.findMany({ where: { email: { in: OLD_DEMO_PEOPLE } }, select: { id: true } });
  if (!people.length) return;
  const ids = people.map((p) => p.id);
  const ccbs = await prisma.ccb.deleteMany({ where: { requesterId: { in: ids } } }); // approvals and comments go with them
  await prisma.comment.deleteMany({ where: { authorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`removed ${people.length} old sample people and ${ccbs.count} sample CCBs`);
}

// ---------------------------------------------------------------------------------------------------------------
// Sample CCBs (the list is in prisma/samples.ts): a varied set so the list, the calendar, the filters and the CCB page
// have something to show. They are OFF unless SEED_SAMPLES is exactly "true", so an environment that forgets the setting
// never gets demo data. They are filed by the first admin and loaded once (a note in the audit trail says so).
// scripts/remove-samples.ts removes them again; they are not loaded again after that.

const COMMON_DEFAULTS: Record<string, string> = { tested: 'Yes', reason: 'Planned work agreed with the owning team.', desc: 'Done in the change window, then checked.', impact: 'No customer impact expected.', riskNote: 'A mistake could affect the listed systems until it is undone.', qaPlan: 'NA', analysis: '', systems: 'See the description.', rollback: 'Undo the change.' };

// CCBs filed before people were picked asked whole roles, under older names. The roles are renamed (Development is now
// LK Tech, Platform is now LK Platform) and their labels rewritten, so those CCBs show and can still be answered by
// anyone listed for the role. Safe to run again.
async function upgradeApprovals() {
  await prisma.approval.updateMany({ where: { role: 'Development' }, data: { role: 'LK Tech' } });
  await prisma.approval.updateMany({ where: { role: 'Platform' }, data: { role: 'LK Platform' } });
  const old = await prisma.approval.findMany({ where: { email: '' }, include: { ccb: { select: { devTeam: true } } } });
  for (const a of old) {
    const group = a.role === 'LK Tech' ? a.group || a.ccb.devTeam : '';
    const label = labelFor(a.role, group);
    if (a.label !== label || a.group !== group) await prisma.approval.update({ where: { id: a.id }, data: { group, label } });
  }
}

async function loadSamples(adminId: string) {
  if (process.env.SEED_SAMPLES !== 'true') return;
  if (await prisma.auditLog.findFirst({ where: { action: 'Sample CCBs loaded' } })) return;
  const nextCode = async (series: string) => {
    const key = series === 'dt' ? 'dt' : 'ccb';
    const c = await prisma.counter.upsert({ where: { key }, update: { value: { increment: 1 } }, create: { key, value: key === 'dt' ? 15001 : 1 } });
    return key === 'dt' ? `DT-${c.value}` : `CCB-${String(c.value).padStart(4, '0')}`;
  };
  const day = 86_400_000;
  for (const sm of SAMPLES) {
    const tpl = TEMPLATES.find((t) => t.key === sm.template)!;
    // Every question and field gets an answer, so the CCB page and the emails show a complete change.
    const data: Record<string, string> = {};
    for (const q of tpl.spec.questions) data[q.k] = sm.answers?.[q.k] ?? q.opts[0].v;
    for (const f of [...tpl.spec.fields, ...COMMON_FIELDS]) {
      if (!applies(f, data)) continue;
      const given = sm.details?.[f.k] ?? COMMON_DEFAULTS[f.k];
      if (given) data[f.k] = given; else if (f.t === 'select') data[f.k] = f.opts![0]; else if (!f.opt) data[f.k] = `Sample ${f.l.toLowerCase()}`;
    }
    // Every sample asks the first admin, the only person with an email in the test lists.
    const rows = [...sm.service.map((g) => ({ role: 'LK Tech', group: g })), ...sm.asks.map((r) => ({ role: r, group: '' }))];
    const start = new Date(Date.now() + sm.startDays * day);
    const created = new Date(Date.now() - (sm.ageHours ?? 5) * 3_600_000);
    const code = await nextCode(tpl.series);
    const ccb = await prisma.ccb.create({
      data: {
        code, type: tpl.key, title: sm.title, environment: sm.env, risk: sm.risk, windowAt: start, windowEndAt: new Date(start.getTime() + sm.hours * 3_600_000),
        businessUnit: sm.bu, systemOwner: FIRST_ADMIN.email, ownerTeam: sm.service.join(', '), devTeam: sm.service[0], requesterId: adminId, data, createdAt: created,
        implementation: sm.outcome ?? 'NONE',
        approvals: { create: rows.map((r, i) => {
          const rejected = sm.rejected?.role === r.role, approved = sm.approved?.includes(r.role);
          return { role: r.role, group: r.group, email: FIRST_ADMIN.email, name: FIRST_ADMIN.name, stage: i + 1, label: labelFor(r.role, r.group), status: rejected ? 'REJECTED' : approved ? 'APPROVED' : 'PENDING', decidedById: rejected || approved ? adminId : null, decidedAt: rejected || approved ? new Date(created.getTime() + 3_600_000) : null, note: rejected ? sm.rejected!.note : null };
        }) },
      },
    });
    await prisma.auditLog.create({ data: { ccbId: ccb.id, actorId: adminId, action: `${code} filed. Asked: ${rows.map((r) => labelFor(r.role, r.group)).join(', ')}`, createdAt: created } });
    for (const r of rows) if (sm.approved?.includes(r.role) || sm.rejected?.role === r.role) await prisma.auditLog.create({ data: { ccbId: ccb.id, actorId: adminId, action: `${labelFor(r.role, r.group)} ${sm.rejected?.role === r.role ? 'rejected' : 'approved'} ${code}`, createdAt: new Date(created.getTime() + 3_600_000) } });
    if (sm.outcome) await prisma.auditLog.create({ data: { ccbId: ccb.id, actorId: adminId, action: `${code} ${sm.outcome === 'LANDED' ? 'rolled out successfully' : 'rolled back'}` } });
    if (sm.comment) await prisma.comment.create({ data: { ccbId: ccb.id, authorId: adminId, body: sm.comment } });
  }
  await prisma.auditLog.create({ data: { action: 'Sample CCBs loaded', detail: { count: SAMPLES.length } } });
  console.log(`${SAMPLES.length} sample CCBs loaded`);
}

async function main() {
  for (const [i, t] of TEMPLATES.entries()) {
    const row = { name: t.name, category: t.category, blurb: t.blurb, tone: t.tone, series: t.series, defaultTeam: t.defaultTeam, defaultRisk: t.defaultRisk, skipQa: !!t.skipQa, manual: !!t.manual, sort: i, spec: t.spec as any };
    await prisma.template.upsert({ where: { key: t.key }, update: row, create: { key: t.key, ...row } });
  }
  await prisma.template.deleteMany({ where: { key: { notIn: TEMPLATES.map((t) => t.key) } } });
  console.log('templates ready');

  // Access was read / write / admin; it is now member / power / admin. Read and write both become member.
  await prisma.user.updateMany({ where: { access: { in: ['read', 'write'] } }, data: { access: 'member' } });

  await removeOldDemoPeople();
  await upgradeApprovals();

  // Listed people are created if they are missing. Anyone already there is left as they are.
  let created = 0;
  for (const u of listedPeople()) {
    if (await prisma.user.findUnique({ where: { email: u.email } })) continue;
    await prisma.user.create({ data: { name: u.name, email: u.email, access: u.access } });
    created++;
  }
  console.log(`users ready (${created} created from users.yaml)`);

  const admin = await prisma.user.findUnique({ where: { email: FIRST_ADMIN.email } });
  if (admin) await loadSamples(admin.id);
}

main().finally(() => prisma.$disconnect());
