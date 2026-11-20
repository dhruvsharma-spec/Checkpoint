import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { parse, stringify } from 'yaml';
import { z } from 'zod';
import { cfg } from './config';
import { db } from './db';

// Everyone who can be asked about a CCB: the approval matrix. It is YAML text kept in the database (table Setting,
// id "approvers"), so every backend replica sees the same list. The first start copies it in from approvers.yaml
// (APPROVERS_FILE, or /seed/approvers.yaml, or deploy/k8s/approvers.yaml). An admin edits it from the UI. Each replica
// keeps a copy in memory and re-reads it every few seconds. If the stored text is broken the last good copy keeps
// being used and the problem is shown in the UI.
//
// There are three kinds of people on a CCB:
//   approvers     LK Tech (split into the teams that own services: POS, Juno, ...) and Infrastructure & Platform (stored as LK Platform)
//   sign-offs     Security and QA
//   executioners  DevOps and DataOps
// The requester picks the actual people from these lists, and each person picked is asked.

export const STEP_ROLES = ['LK Tech', 'LK Platform', 'Security', 'QA', 'DevOps', 'DataOps'] as const;
export type StepRole = (typeof STEP_ROLES)[number];
export const ROLE_ORDER: StepRole[] = [...STEP_ROLES];
// The role that is split into teams.
export const GROUPED = 'LK Tech';
export type Kind = 'Approver' | 'Sign-off' | 'Executioner';
const KIND: Record<string, Kind> = { 'LK Tech': 'Approver', 'LK Platform': 'Approver', Security: 'Sign-off', QA: 'Sign-off', DevOps: 'Executioner', DataOps: 'Executioner' };
// Older names, still found on CCBs filed before this change and in older copies of the file.
const LEGACY: Record<string, StepRole> = { Development: 'LK Tech', Platform: 'LK Platform' };
export const roleOf = (role: string): string => LEGACY[role] ?? role;
export const kindOf = (role: string): Kind => KIND[roleOf(role)] ?? 'Approver';
// Shown in the UI. The stored role key stays "LK Platform"; only the label changed.
export const displayRole = (role: string) => (roleOf(role) === 'LK Platform' ? 'Infrastructure & Platform' : roleOf(role));
// "LK Tech · POS approver", "Infrastructure & Platform approver", "Security sign-off", "DevOps executioner".
export const labelFor = (role: string, group?: string | null) => {
  const r = roleOf(role), k = kindOf(r);
  return `${displayRole(r)}${group ? ` · ${group}` : ''} ${k === 'Sign-off' ? 'sign-off' : k.toLowerCase()}`;
};

export type Owner = { name: string; email: string };
export type Group = { name: string; owners: Owner[] };
export type RoleEntry = { role: StepRole; kind: Kind; owners: Owner[]; groups?: Group[] };
export type Approvers = { source: string | null; error: string | null; writable: boolean; loadedAt: string | null; roles: RoleEntry[] };

// A person without an email is listed by name only: shown in the UI, never emailed, and cannot be picked.
const ownerSchema = z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().email().max(200).or(z.literal('')).default('') });
const fileSchema = z.object({
  approvers: z.record(z.object({
    description: z.string().optional(),
    owners: z.array(ownerSchema).default([]),
    groups: z.record(z.array(ownerSchema)).optional(),
  })),
});

const ID = 'approvers';
const seedFile = () => [cfg.approversFile, '/seed/approvers.yaml', path.resolve(process.cwd(), '../deploy/k8s/approvers.yaml')].filter(Boolean).find((f) => existsSync(f));

const blank = (role: StepRole): RoleEntry => ({ role, kind: KIND[role], owners: [], ...(role === GROUPED ? { groups: [] } : {}) });
const empty = (error: string | null): Approvers => ({ source: null, error, writable: false, loadedAt: null, roles: ROLE_ORDER.map(blank) });
const clean = (o: Owner): Owner => ({ name: o.name.trim(), email: (o.email ?? '').trim().toLowerCase() });
const out = (o: Owner) => (o.email ? { name: o.name, email: o.email } : { name: o.name });

// Reads matrix YAML. Throws with a readable message when it is not valid.
export function parseApprovers(text: string): RoleEntry[] {
  let parsed: z.infer<typeof fileSchema>;
  try { parsed = fileSchema.parse(parse(text)); }
  catch (e) { throw new Error(e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : (e as Error).message); }
  // Older names are read as their new ones; Engineering Head no longer exists and is skipped.
  const byRole: Record<string, (typeof parsed.approvers)[string]> = {};
  for (const [k, v] of Object.entries(parsed.approvers)) {
    if (k === 'Engineering Head') continue;
    const r = roleOf(k);
    if (!(STEP_ROLES as readonly string[]).includes(r)) throw new Error(`Unknown name: ${k}. Allowed: ${STEP_ROLES.join(', ')}.`);
    if (!byRole[r]) byRole[r] = v;
  }
  return ROLE_ORDER.map((role): RoleEntry => {
    const e = byRole[role];
    return {
      role, kind: KIND[role], owners: role === GROUPED ? [] : (e?.owners ?? []).map(clean),
      ...(role === GROUPED ? { groups: Object.entries(e?.groups ?? {}).map(([name, owners]) => ({ name, owners: owners.map(clean) })) } : {}),
    };
  });
}

let current: Approvers = empty('The approval matrix has not been loaded yet.');
let stamp = 0;
export const approvers = (): Approvers => current;

// Reads the stored matrix if it changed since the last read.
async function refresh() {
  const row = await db.setting.findUnique({ where: { id: ID } });
  if (!row) return false;
  if (row.updatedAt.getTime() === stamp) return true;
  stamp = row.updatedAt.getTime();
  try {
    current = { source: 'database', error: null, writable: true, loadedAt: new Date().toISOString(), roles: parseApprovers(row.value) };
  } catch (e) {
    console.error('The stored approval matrix is invalid:', (e as Error).message);
    current = { ...current, source: 'database', writable: true, error: `The stored approval matrix is invalid, so the last good copy is in use. ${(e as Error).message}` };
  }
  return true;
}

// Called once at start-up. Copies the seed file in the first time, then keeps the copy in memory fresh.
export async function initApprovers(pollMs = 10_000) {
  if (!(await refresh())) {
    const file = seedFile();
    if (file) {
      const text = readFileSync(file, 'utf8');
      parseApprovers(text); // refuse to store a broken seed
      await db.setting.upsert({ where: { id: ID }, update: {}, create: { id: ID, value: text } });
      console.log(`Approval matrix copied in from ${file}`);
      await refresh();
    } else current = empty('No approval matrix yet, and no approvers.yaml to start from.');
  }
  setInterval(() => void refresh().catch((e) => console.error('Approval matrix refresh failed:', (e as Error).message)), pollMs).unref();
}

// ---------- reading ----------
const entry = (role: string) => approvers().roles.find((r) => r.role === roleOf(role));
export const serviceTeams = () => entry(GROUPED)?.groups ?? [];

// The people listed for a role (for LK Tech, for one of its teams).
export function ownersFor(role: string, group?: string | null): Owner[] {
  if (roleOf(role) === GROUPED) return serviceTeams().find((g) => g.name === group)?.owners ?? [];
  return entry(role)?.owners ?? [];
}
// Only people with an email can be asked, so these are the ones that count for emailing and answering.
export const reachableFor = (role: string, group?: string | null): Owner[] => ownersFor(role, group).filter((o) => !!o.email);
export const isOwner = (email: string, role: string, group?: string | null) => reachableFor(role, group).some((o) => o.email === email.toLowerCase());

// Which lists this person is on, for display: "LK Tech · POS", "QA".
export function stepsOfEmail(email: string): string[] {
  const e = email.toLowerCase();
  const res: string[] = [];
  for (const r of approvers().roles) {
    if (r.role === GROUPED) for (const g of r.groups ?? []) { if (g.owners.some((o) => o.email === e)) res.push(`${GROUPED} · ${g.name}`); }
    else if (r.owners.some((o) => o.email === e)) res.push(r.role);
  }
  return res;
}

// ---------- writing (admins, from the UI) ----------
export type SaveRole = { role: StepRole; owners?: Owner[]; groups?: Group[] };
const HEADER = `# WHO IS ASKED ABOUT A CCB
#
# Edited from the UI (CCB, then Approval matrix) by an admin.
#
#   Approvers:     LK Tech (one list per team that owns a service)
#   Sign-offs:     Security, QA
#   Executioners:  DevOps, DataOps
#   Last:          Infrastructure & Platform (YAML key: LK Platform)
#
# The person filing a CCB picks the actual people from these lists. A name with no email is listed only:
# it is never emailed and cannot be picked.
#
# Stored in the database. To save what is live into this file:  ./scripts/minikube.sh approvers-export
# To replace what is live with this file:                       ./scripts/minikube.sh approvers-reset

`;
export function renderApprovers(next: SaveRole[], base: RoleEntry[] = current.roles): string {
  const body: Record<string, unknown> = {};
  for (const role of ROLE_ORDER) {
    const incoming = next.find((n) => n.role === role);
    const prev = base.find((r) => r.role === role);
    if (role === GROUPED) {
      const groups = incoming?.groups ?? prev?.groups ?? [];
      body[role] = { groups: Object.fromEntries(groups.map((g) => [g.name.trim(), g.owners.map(clean).map(out)])) };
    } else {
      body[role] = { owners: (incoming?.owners ?? prev?.owners ?? []).map(clean).map(out) };
    }
  }
  return HEADER + stringify({ approvers: body }, { lineWidth: 0 });
}

// Stores a new matrix. Every replica picks it up within a few seconds; this one at once.
export async function saveApprovers(next: SaveRole[]): Promise<void> {
  await storeApprovers(renderApprovers(next));
}
// Stores matrix YAML as given (used to load a file from the command line). It must be valid.
export async function storeApprovers(text: string): Promise<void> {
  parseApprovers(text);
  await db.setting.upsert({ where: { id: ID }, update: { value: text }, create: { id: ID, value: text } });
  stamp = 0;
  await refresh();
}

// A short, readable list of what changed, for the audit trail.
export function describeChange(before: Approvers, after: SaveRole[]): string[] {
  const res: string[] = [];
  const diff = (label: string, a: Owner[], b: Owner[]) => {
    const key = (o: Owner) => (o.email ? o.email.trim().toLowerCase() : `name:${o.name.trim().toLowerCase()}`);
    const A = new Set(a.map(key)), B = new Set(b.map(key));
    const added = b.filter((o) => !A.has(key(o))).map((o) => o.name);
    const removed = a.filter((o) => !B.has(key(o))).map((o) => o.name);
    if (added.length) res.push(`${label}: added ${added.join(', ')}`);
    if (removed.length) res.push(`${label}: removed ${removed.join(', ')}`);
  };
  for (const role of ROLE_ORDER) {
    const prev = before.roles.find((r) => r.role === role); const inc = after.find((n) => n.role === role);
    if (!prev || !inc) continue;
    if (role === GROUPED) {
      const names = new Set([...(prev.groups ?? []).map((g) => g.name), ...(inc.groups ?? []).map((g) => g.name)]);
      for (const n of names) diff(`${GROUPED} · ${n}`, prev.groups?.find((g) => g.name === n)?.owners ?? [], inc.groups?.find((g) => g.name === n)?.owners ?? []);
    } else diff(role, prev.owners, inc.owners ?? []);
  }
  return res;
}
