// Background worker. Runs from the same image as the API with a different command:
//   npx tsx worker/index.ts
// Today it sends queued emails. Reminders and other scheduled jobs belong here too.
import { processOutbox } from '../src/mail';
import { cfg } from '../src/config';
import { db } from '../src/db';

let stopping = false;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`Worker started. Checking the outbox every ${cfg.outbox.pollMs} ms.`);
  while (!stopping) {
    try {
      const { sent, failed } = await processOutbox();
      if (sent || failed) console.log(`Outbox: sent ${sent}, failed ${failed}`);
    } catch (e) {
      console.error('Outbox run failed:', (e as Error).message);
    }
    await sleep(cfg.outbox.pollMs);
  }
  await db.$disconnect();
  console.log('Worker stopped.');
}

// Finish the current batch, then exit, so Kubernetes can replace the pod cleanly.
for (const sig of ['SIGTERM', 'SIGINT'] as const) process.on(sig, () => { stopping = true; });
main();
