import * as nodemailer from 'nodemailer';
import { OutboxStatus } from '@prisma/client';
import { db } from './db';
import { cfg } from './config';

export type Mail = { to: string[]; subject: string; html: string; text: string; ics?: string };

// Called by the app. It only writes a row, so it is fast and cannot fail because the mail
// server is down. The worker does the actual sending.
export async function enqueue(m: Mail) {
  const to = Array.from(new Set(m.to.filter(Boolean)));
  if (!to.length) return;
  await db.outbox.create({ data: { to, subject: m.subject, html: m.html, text: m.text, ics: m.ics ?? null } });
}

let tx: nodemailer.Transporter | undefined;
const transport = () => (tx ??= nodemailer.createTransport({
  host: cfg.smtp.host, port: cfg.smtp.port, secure: false, requireTLS: cfg.smtp.requireTls,
  auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.pass } : undefined,
}));

// Backoff in minutes after attempt 1, 2, 3 ... : 1, 5, 30, 120, 720
const delayMin = (attempt: number) => [1, 5, 30, 120, 720][Math.min(attempt - 1, 4)];

// Claims a batch of due emails atomically (safe with several workers), sends each, and records
// the result. Returns how many were sent.
export async function processOutbox(batch = 10): Promise<{ sent: number; failed: number }> {
  // Lock a batch of due rows (rows another worker holds are skipped), push their next try 5 minutes out so a crash
  // mid-send retries later, and count the attempt. MySQL 8 has SKIP LOCKED but no RETURNING, so this is two steps.
  const rows = await db.$transaction(async (t) => {
    const due = await t.$queryRaw<{ id: string }[]>`
      SELECT id FROM Outbox WHERE status = 'PENDING' AND nextAttemptAt <= NOW(3)
      ORDER BY createdAt LIMIT ${batch} FOR UPDATE SKIP LOCKED`;
    if (!due.length) return [];
    const ids = due.map((d) => d.id);
    await t.outbox.updateMany({ where: { id: { in: ids } }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 5 * 60_000) } });
    return t.outbox.findMany({ where: { id: { in: ids } }, select: { id: true, to: true, subject: true, html: true, text: true, ics: true, attempts: true } });
  });
  let sent = 0, failed = 0;
  for (const r of rows) {
    try {
      await transport().sendMail({ from: cfg.smtp.from, to: r.to as string[], subject: r.subject, html: r.html, text: r.text, icalEvent: r.ics ? { method: 'REQUEST', content: r.ics } : undefined });
      await db.outbox.update({ where: { id: r.id }, data: { status: OutboxStatus.SENT, sentAt: new Date(), lastError: null } });
      sent++;
    } catch (e) {
      failed++;
      const last = r.attempts >= cfg.outbox.maxAttempts;
      await db.outbox.update({ where: { id: r.id }, data: { status: last ? OutboxStatus.FAILED : OutboxStatus.PENDING, nextAttemptAt: new Date(Date.now() + delayMin(r.attempts) * 60_000), lastError: String((e as Error).message).slice(0, 500) } });
    }
  }
  return { sent, failed };
}
