// The API service. It owns the database and all the rules; it has no screens.
// The frontend service forwards every /api request here.
import express from 'express';
import { cfg } from './config';
import { db } from './db';
import { sendError } from './http';
import { api } from './routes';
import { initApprovers } from './approvers';

const app = express();
app.disable('x-powered-by');
// The frontend sits in front of this service, so the client address comes from X-Forwarded-For.
app.set('trust proxy', 1); // one hop: the frontend service
app.use(express.json({ limit: '200kb' }));
app.use('/api', api);
app.use('/api', (_req, res) => void res.status(404).json({ message: 'Not found' }));
// Bad JSON from body-parser, and anything a route did not catch.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if ((err as { type?: string })?.type === 'entity.parse.failed') return void res.status(400).json({ message: 'Request body must be JSON' });
  if ((err as { type?: string })?.type === 'entity.too.large') return void res.status(413).json({ message: 'Request body is too large' });
  sendError(res, err);
});

// The approval matrix is loaded before the first request is served.
initApprovers().then(() => {
  const server = app.listen(cfg.port, '0.0.0.0', () => console.log(`Checkpoint API listening on :${cfg.port} (${cfg.prod ? 'production' : 'local'} mode)`));
  // Finish in-flight requests, then exit, so Kubernetes can replace the pod cleanly.
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => { server.close(() => db.$disconnect().finally(() => process.exit(0))); setTimeout(() => process.exit(0), 10_000).unref(); });
  }
}).catch((e) => { console.error('Could not start:', (e as Error).message); process.exit(1); });
