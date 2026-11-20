import { z } from 'zod';
import { BUSINESS_UNITS, ENVIRONMENTS } from './templates';
import { STEP_ROLES } from './approvers';

const risk = z.enum(['Low', 'Medium', 'High']);
const when = z.string().datetime({ offset: true });
const person = z.string().trim().toLowerCase().email().max(200);
const picked = z.array(person).max(20).default([]);

export const createCcb = z.object({
  template: z.string().min(1).max(40),
  title: z.string().trim().min(3).max(200),
  environment: z.enum(ENVIRONMENTS),
  risk,
  businessUnit: z.enum(BUSINESS_UNITS),
  systemOwner: z.string().trim().email().max(200),
  windowAt: when,
  windowEndAt: when,
  // The teams the service belongs to, each with the approvers picked from that team. At least one.
  // other: a team that is not on the list, typed by hand, with exactly one approver (their email).
  service: z.array(z.object({ team: z.string().trim().min(1).max(60), approvers: z.array(person).min(1).max(20), other: z.boolean().optional() })).min(1).max(10),
  // Everyone else picked, list by list. Each list is optional.
  people: z.object({ 'LK Platform': picked, Security: picked, QA: picked, DevOps: picked, DataOps: picked }).default({}),
  data: z.record(z.string()),
});
// id names one step (an approval) when a person has more than one on the same CCB.
export const decision = z.object({ decision: z.enum(['approve', 'reject']), id: z.string().max(40).optional(), note: z.string().max(1000).optional() });
export const implementation = z.object({ result: z.enum(['landed', 'rolled_back']) });
export const comment = z.object({ body: z.string().trim().min(1).max(2000) });
export const remind = z.object({ id: z.string().max(40) });
// What DevOps, DataOps or QA found, added on the CCB after it is filed.
export const ANALYSIS_TEAMS = ['DevOps', 'DataOps', 'QA'] as const;
export const analysis = z.object({ team: z.enum(ANALYSIS_TEAMS), body: z.string().trim().min(3).max(5000) });
export const devLogin = z.object({ email: z.string().email() });
// What a person may do: member (file and manage CCBs), power (also delete CCBs), admin (also manage access).
export const ACCESS = ['member', 'power', 'admin'] as const;
export const access = z.object({ access: z.enum(ACCESS) });
export const addUser = z.object({ email: z.string().trim().email().max(200), name: z.string().trim().min(2).max(100), access: z.enum(ACCESS) });
// Saving the approvers list from the UI. The list for each role replaces the old one.
const owner = z.object({ name: z.string().trim().min(1).max(100), email: z.string().trim().email().max(200).or(z.literal('')).default('') });
export const saveApprovers = z.object({
  roles: z.array(z.object({
    role: z.enum(STEP_ROLES),
    owners: z.array(owner).max(50).optional(),
    groups: z.array(z.object({ name: z.string().trim().min(1).max(60), owners: z.array(owner).max(50) })).max(30).optional(),
  })).max(STEP_ROLES.length),
});

// Organisation-level activity (no CCB). Details and end time are required; past start is refused.
// UI chips are DevOps / DataOps / Security / Other; "Other" stores a typed team name.
export const ACTIVITY_TEAM_CHOICES = ['DevOps', 'DataOps', 'Security', 'Other'] as const;
export const createActivity = z.object({
  title: z.string().trim().min(3).max(200),
  summary: z.string().trim().min(3).max(500), // "Details" in the UI
  detail: z.string().trim().max(5000).optional().default(''),
  team: z.string().trim().min(2).max(60),
  startsAt: when,
  endsAt: when,
});
export const updateActivity = z.object({
  title: z.string().trim().min(3).max(200).optional(),
  summary: z.string().trim().min(3).max(500).optional(),
  detail: z.string().trim().max(5000).optional(),
  team: z.string().trim().min(2).max(60).optional(),
  startsAt: when.optional(),
  endsAt: when.optional(),
});
