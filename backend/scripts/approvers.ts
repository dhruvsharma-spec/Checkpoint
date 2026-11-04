// The approval matrix from the command line, inside a backend pod:
//   npx tsx scripts/approvers.ts export            print what is live (YAML)
//   npx tsx scripts/approvers.ts import < file     replace what is live with the YAML on stdin (it must be valid)
import { db } from '../src/db';
import { initApprovers, storeApprovers } from '../src/approvers';

(async () => {
  const cmd = process.argv[2];
  if (cmd === 'export') {
    const row = await db.setting.findUnique({ where: { id: 'approvers' } });
    if (!row) { await initApprovers(60_000); }
    process.stdout.write((await db.setting.findUnique({ where: { id: 'approvers' } }))?.value ?? '');
  } else if (cmd === 'import') {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    await storeApprovers(Buffer.concat(chunks).toString('utf8'));
    console.error('The approval matrix was replaced. Every backend picks it up within a few seconds.');
  } else { console.error('Usage: approvers.ts export | import < file'); process.exitCode = 2; }
  await db.$disconnect();
  process.exit();
})().catch((e) => { console.error((e as Error).message); process.exit(1); });
