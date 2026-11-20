// Organisation-level activities that do not need a CCB. Logged for awareness; they also appear on the calendar.
import { z } from 'zod';
import type { SessionUser } from './auth';
import { db } from './db';
import { bad, notFound } from './http';
import * as S from './schemas';

const include = { createdBy: { select: { name: true, email: true } } } as const;

function dto(a: {
  id: string; title: string; summary: string; detail: string; team: string;
  startsAt: Date; endsAt: Date; createdAt: Date; updatedAt: Date;
  createdBy: { name: string; email: string };
}) {
  return {
    id: a.id, title: a.title, summary: a.summary, detail: a.detail, team: a.team,
    startsAt: a.startsAt, endsAt: a.endsAt, createdAt: a.createdAt, updatedAt: a.updatedAt,
    createdBy: a.createdBy,
  };
}

function assertWindow(startsAt: Date, endsAt: Date) {
  if (endsAt <= startsAt) throw bad('End time must be after the start.');
  // Refuse a start more than a minute in the past (clock skew).
  if (startsAt.getTime() < Date.now() - 60_000) throw bad('Pick a start time that is now or in the future.');
}

export async function list() {
  const now = new Date();
  const pastFrom = new Date(now.getTime() - 14 * 86400_000);
  const upcomingTo = new Date(now.getTime() + 60 * 86400_000);
  const rows = await db.activity.findMany({
    where: { startsAt: { gte: pastFrom, lt: upcomingTo } },
    include, orderBy: { startsAt: 'asc' }, take: 200,
  });
  const upcoming = rows.filter((a) => a.startsAt >= now).map(dto);
  const recent = rows.filter((a) => a.startsAt < now).reverse().map(dto);
  return {
    upcoming, recent,
    teams: S.ACTIVITY_TEAM_CHOICES,
    insight: {
      upcomingCount: upcoming.length,
      recentCount: recent.length,
      next: upcoming[0] ?? null,
      last: recent[0] ?? null,
    },
  };
}

export async function get(id: string) {
  const a = await db.activity.findUnique({ where: { id }, include });
  if (!a) throw notFound('That activity does not exist');
  return dto(a);
}

export async function create(u: SessionUser, b: z.infer<typeof S.createActivity>) {
  const startsAt = new Date(b.startsAt);
  const endsAt = new Date(b.endsAt);
  assertWindow(startsAt, endsAt);
  const a = await db.activity.create({
    data: {
      title: b.title, summary: b.summary, detail: b.detail ?? '', team: b.team,
      startsAt, endsAt, createdById: u.id,
    },
    include,
  });
  await db.auditLog.create({ data: { actorId: u.id, action: `Activity logged: ${a.title}`, detail: { id: a.id, team: a.team } } });
  return dto(a);
}

export async function update(u: SessionUser, id: string, b: z.infer<typeof S.updateActivity>) {
  const existing = await db.activity.findUnique({ where: { id } });
  if (!existing) throw notFound('That activity does not exist');
  const startsAt = b.startsAt ? new Date(b.startsAt) : existing.startsAt;
  const endsAt = b.endsAt ? new Date(b.endsAt) : existing.endsAt;
  if (b.startsAt || b.endsAt) {
    if (endsAt <= startsAt) throw bad('End time must be after the start.');
    if (b.startsAt) assertWindow(startsAt, endsAt);
  }
  const a = await db.activity.update({
    where: { id },
    data: {
      ...(b.title !== undefined ? { title: b.title } : {}),
      ...(b.summary !== undefined ? { summary: b.summary } : {}),
      ...(b.detail !== undefined ? { detail: b.detail } : {}),
      ...(b.team !== undefined ? { team: b.team } : {}),
      startsAt, endsAt,
    },
    include,
  });
  await db.auditLog.create({ data: { actorId: u.id, action: `Activity updated: ${a.title}`, detail: { id: a.id } } });
  return dto(a);
}

export async function remove(u: SessionUser, id: string) {
  const existing = await db.activity.findUnique({ where: { id } });
  if (!existing) throw notFound('That activity does not exist');
  await db.activity.delete({ where: { id } });
  await db.auditLog.create({ data: { actorId: u.id, action: `Activity deleted: ${existing.title}`, detail: { id } } });
  return { ok: true };
}

export async function calendarEvents(from: Date, to: Date) {
  const rows = await db.activity.findMany({
    where: { startsAt: { gte: from, lt: to } },
    include, orderBy: { startsAt: 'asc' }, take: 500,
  });
  return rows.map((a) => ({
    kind: 'activity' as const,
    at: a.startsAt,
    code: a.id,
    title: a.title,
    sub: [a.team, a.summary].filter(Boolean).join(' · ') || `Logged by ${a.createdBy.name}`,
  }));
}
