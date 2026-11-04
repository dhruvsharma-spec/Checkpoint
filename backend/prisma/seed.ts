import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { parse } from 'yaml';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { COMMON_FIELDS, TEMPLATES, applies, type Risk } from '../src/templates';
import { labelFor } from '../src/approvers';

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
// Sample CCBs: a varied set so the list, the calendar, the filters and the CCB page have something to show. They are
// filed by the first admin, loaded once (a note in the audit trail says so), and only when SEED_SAMPLES is not "false".
// Delete them from the app like any other CCB; they are not loaded again.
type Sample = {
  template: string; title: string; env: 'Production' | 'Preprod' | 'Staging'; risk: Risk; service: string[]; asks: string[]; bu: string;
  startDays: number; hours: number; answers?: Record<string, string>; details?: Record<string, string>;
  approved?: string[]; rejected?: { role: string; note: string }; outcome?: 'LANDED' | 'ROLLED_BACK'; ageHours?: number; comment?: string;
};
const SAMPLES: Sample[] = [
  { template: 'cloudflare', title: 'Remove DNS records for retired campaign domains', env: 'Production', risk: 'High', service: ['POS'], asks: ['DevOps', 'Security', 'LK Platform'], bu: 'Lenskart (India/International)', startDays: 2, hours: 2, ageHours: 20,
    answers: { action: 'Delete DNS record' }, details: { zone: 'lenskart-sale.com', record: 'A  promo.lenskart-sale.com  203.0.113.20  proxied', reason: 'The campaign ended in August and the domains are being retired.', desc: 'Delete the A and CNAME records for the five campaign hostnames, then remove the zone from Cloudflare.', impact: 'Old campaign links stop resolving.', rollback: 'Re-add the records from the exported zone file (about 10 minutes).' }, approved: ['DevOps'], comment: 'Zone export is attached to the ticket.' },
  { template: 'database', title: 'Add a composite index on order_items', env: 'Production', risk: 'Medium', service: ['POS'], asks: ['DataOps', 'QA'], bu: 'Lenskart (India/International)', startDays: 1, hours: 1, ageHours: 30,
    answers: { engine: 'MySQL / Aurora', action: 'Add or change an index' }, details: { servers: '172.31.14.158 — SCM/WEB CORE, Master', db: 'orders.order_items', command: 'ALTER TABLE order_items ADD INDEX idx_order_created (order_id, created_at);', tableSize: '48 GB', estTime: '25 minutes', mode: 'PT-OSC / online', dba: 'On-call DBA', precaution: 'Pause the build if replication lag grows past 30 seconds.', reason: 'Order history lookups are slow on a growing table.', desc: 'Online index build in the low-traffic window.', rollback: 'Drop the new index.' }, approved: ['LK Tech', 'QA'] },
  { template: 'release', title: 'POS billing screen redesign, version 3.2', env: 'Preprod', risk: 'Medium', service: ['POS'], asks: ['QA', 'DevOps'], bu: 'Lenskart (India/International)', startDays: 3, hours: 1, ageHours: 52,
    answers: { kind: 'New feature release', strategy: 'Canary or gradual %' }, details: { service: 'pos-billing', version: 'v3.1.4 → v3.2.0', flags: 'billing_v3_screen', reason: 'Faster billing at the counter, with the new tax summary.', desc: 'Roll out to 10 percent of stores, watch for an hour, then everyone.', rollback: 'Switch the flag off, then redeploy v3.1.4.' }, approved: ['LK Tech', 'QA', 'DevOps'] },
  { template: 'kubernetes', title: 'Upgrade the Juno cluster to 1.36', env: 'Production', risk: 'High', service: ['Juno'], asks: ['DevOps', 'Security', 'LK Platform'], bu: 'Lenskart (India/International)', startDays: 5, hours: 4, ageHours: 75,
    answers: { action: 'Upgrade the cluster version' }, details: { cluster: 'juno-prod-1-30', namespace: 'all', objects: 'control plane and 6 node groups', reason: 'The current version leaves support next quarter.', desc: 'Upgrade the control plane, then replace node groups one zone at a time.', rollback: 'Shift traffic back to the old node groups.' }, approved: ['LK Tech'], rejected: { role: 'LK Platform', note: 'No rollback rehearsal on staging yet. Run it there first and file again.' } },
  { template: 'scaling', title: 'Pre-scale checkout for the festive sale', env: 'Production', risk: 'Low', service: ['CES'], asks: ['DevOps'], bu: 'Lenskart (India/International)', startDays: -3, hours: 3, ageHours: 140,
    answers: { direction: 'Pre-scale for an event or sale', what: 'Replica / pod count', duration: 'Temporary, for an event or peak' }, details: { application: 'checkout-service', cluster: 'puno-prod / checkout', current: '6 pods', target: '18 pods', reason: 'Expected traffic is three times the usual evening peak.', rollback: 'Scale back down after the sale.' }, approved: ['DevOps', 'LK Tech'], outcome: 'LANDED' },
  { template: 'downtime', title: 'MongoDB Juno cluster maintenance window', env: 'Production', risk: 'High', service: ['Juno'], asks: ['DevOps', 'DataOps', 'LK Platform'], bu: 'Lenskart (India/International)', startDays: 4, hours: 1, ageHours: 6,
    answers: { category: 'Database', length: '15 to 60 minutes' }, details: { servers: '172.31.6.238 — Juno Prod, Shard 1 Primary\n172.31.5.173 — Juno Prod, Shard 2 Primary', services: 'Juno order service, stores API', customer: 'Order lookups pause for up to an hour at night.', comms: 'Stores are told by email the day before, and in the stores channel an hour before.', reason: 'Primary step-down and version patching.', desc: 'Step down each shard primary, patch, and step back up.', rollback: 'Step the old primary back up.' } },
  { template: 'security', title: 'Rotate TLS certificates for the stores API', env: 'Production', risk: 'Medium', service: ['POS'], asks: ['Security', 'DevOps'], bu: 'Lenskart (India/International)', startDays: 1, hours: 1, ageHours: 100,
    answers: { area: 'Certificate rotation' }, details: { target: 'aws prod / acm', principal: 'stores-api.lenskart.com', detail: 'Replace the certificate that expires on the 30th, with a 90 day one.', reason: 'The current certificate expires soon.', rollback: 'Re-attach the previous certificate.' }, approved: ['Security', 'DevOps'] },
  { template: 'kafka', title: 'Increase partitions on orders-events to 24', env: 'Production', risk: 'Medium', service: ['SCM/NEXS'], asks: ['DevOps', 'LK Platform'], bu: 'Lenskart (India/International)', startDays: -6, hours: 1, ageHours: 200,
    answers: { engine: 'Kafka', action: 'Increase partitions' }, details: { cluster: 'kafka-prod-1', topic: 'orders-events', partitions: '12 → 24', consumers: 'order-sync, notifications, reporting', reason: 'Consumers are lagging at peak.', rollback: 'Partitions cannot be removed; the consumers would be scaled instead.' }, approved: ['DevOps', 'LK Tech', 'LK Platform'], outcome: 'ROLLED_BACK', comment: 'Rolled back: key ordering broke for one consumer. We will retry with a new topic.' },
  { template: 'general', title: 'Replace the firmware on store label printers', env: 'Staging', risk: 'Low', service: ['POS'], asks: ['DevOps', 'QA'], bu: 'Owndays', startDays: 6, hours: 2, ageHours: 12,
    details: { project: 'Label printer firmware 4.2', reason: 'A bug fix for blurry barcodes.', desc: 'Update the firmware on the ten staging printers, then test scanning.', impact: 'Printing is paused for the test stores only.', rollback: 'Flash the previous firmware file.' }, approved: ['DevOps'] },
  { template: 'access', title: 'Temporary production database access for the audit', env: 'Production', risk: 'High', service: ['POS'], asks: ['Security', 'DataOps', 'LK Platform'], bu: 'Lenskart (India/International)', startDays: 2, hours: 72, ageHours: 3,
    answers: { action: 'Temporary elevated access', level: 'Read-only' }, details: { who: 'External audit team (3 people)', system: 'reporting replicas', until: 'End of the audit week', reason: 'Year-end audit needs to read finance tables.', rollback: 'Remove the accounts at the end date.' } },
  { template: 'resize', title: 'Resize the reporting RDS instance', env: 'Production', risk: 'Medium', service: ['POS'], asks: ['DataOps', 'DevOps'], bu: 'Ajna Lens', startDays: 7, hours: 1, ageHours: 40,
    answers: { provider: 'AWS RDS or managed database', direction: 'Resize up', downtime: 'Under 5 minutes' }, details: { servers: '10.175.0.32 — SCM/WEB CORE, Slave', currentType: 'db.r5.xlarge', targetType: 'db.r5.2xlarge', reason: 'Reports are slow at month end.', rollback: 'Resize back; about 10 minutes.' }, approved: ['DataOps'] },
  { template: 'nginx', title: 'Add a rate limit to the checkout host', env: 'Staging', risk: 'Medium', service: ['Puno'], asks: ['DevOps', 'Security'], bu: 'Ajna Lens', startDays: 2, hours: 1, ageHours: 8,
    answers: { area: 'Rate limits', apply: 'Reload (no downtime)' }, details: { hosts: 'checkout.staging.internal', diff: 'limit_req_zone $binary_remote_addr zone=checkout:10m rate=20r/s;', test: 'nginx -t, then a load test from the staging runner', reason: 'Protect checkout from bursts.', rollback: 'Remove the limit_req lines and reload.' } },
  { template: 'monitoring', title: 'Mute noisy disk alerts during the storage migration', env: 'Production', risk: 'Low', service: ['POS'], asks: ['DevOps'], bu: 'Ajna Lens', startDays: 1, hours: 6, ageHours: 60,
    answers: { action: 'Silence or mute an alert' }, details: { tool: 'Grafana', scope: 'nexs hosts', detail: 'Mute the disk-usage warning for six hours, with an end time set.', reason: 'The migration fills disks briefly and pages the on-call.', rollback: 'Un-mute the alert.' }, approved: ['DevOps'] },
];

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
  if (process.env.SEED_SAMPLES === 'false') return;
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
