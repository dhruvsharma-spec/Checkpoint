import { PrismaClient } from '@prisma/client';

// One client per process, talking to MySQL. The global keeps it alive across hot reloads in development.
// The connection pool size comes from DATABASE_URL (?connection_limit=10).
const g = globalThis as unknown as { __cpdb?: PrismaClient };
export const db: PrismaClient = g.__cpdb ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') g.__cpdb = db;
