// Removes the sample CCBs (the ones listed in prisma/samples.ts) and nothing else. Run inside a backend pod:
//   npx tsx scripts/remove-samples.ts          list what would be removed, change nothing
//   npx tsx scripts/remove-samples.ts --yes    remove them (their approvals, analyses and comments go with them)
// A CCB is a sample only if both its type and its title match one on the list, so CCBs people filed are never touched.
// The audit trail is kept, as it is when a CCB is deleted in the app. If no CCB is left afterwards, the numbering starts
// again from the beginning.
import { db } from '../src/db';
import { SAMPLES } from '../prisma/samples';

(async () => {
  const apply = process.argv.includes('--yes');
  const found = await db.ccb.findMany({
    where: { OR: SAMPLES.map((s) => ({ type: s.template, title: s.title })) },
    select: { id: true, code: true, title: true, requester: { select: { email: true } } },
    orderBy: { code: 'asc' },
  });
  if (!found.length) { console.log('No sample CCBs found.'); return; }
  console.log(`${found.length} sample CCB${found.length === 1 ? '' : 's'} found:`);
  for (const c of found) console.log(`  ${c.code}  ${c.title}   (filed by ${c.requester.email})`);
  if (!apply) { console.log('\nNothing was changed. Run again with --yes to remove them.'); return; }

  await db.ccb.deleteMany({ where: { id: { in: found.map((c) => c.id) } } });
  await db.auditLog.create({ data: { action: 'Sample CCBs removed', detail: { count: found.length, codes: found.map((c) => c.code) } } });
  const left = await db.ccb.count();
  if (left === 0) { await db.counter.deleteMany({}); console.log('\nNo CCBs are left, so numbering starts again from the beginning.'); }
  console.log(`\nRemoved ${found.length} sample CCBs. ${left} CCB${left === 1 ? '' : 's'} left.`);
})().catch((e) => { console.error((e as Error).message); process.exitCode = 1; }).finally(() => db.$disconnect());
