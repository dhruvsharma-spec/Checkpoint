import { existsSync, readFileSync, statSync } from 'fs';
import path from 'path';
import { parse } from 'yaml';
import { z } from 'zod';

// The database servers the Database CCB offers in its drop-downs. They live in two YAML files kept next to the
// other deploy files: mysql-inventory.yaml and mongodb-inventory.yaml. They are read-only here and re-read when
// the file changes; if one is broken, the last good copy is used and the problem is reported with the data.

export const MYSQL_ROLES = ['Master', 'Slave', 'Proxy', 'Standalone', 'Other'] as const;

const opt = z.string().optional();
const mysqlSchema = z.object({
  groups: z.array(z.object({
    name: z.string().min(1),
    servers: z.array(z.object({ ip: z.string().min(1), role: z.enum(MYSQL_ROLES), label: opt, dns: opt, instance: opt, version: opt, slave_of: opt, app_owner: opt, poc: opt })).default([]),
  })).default([]),
});
const mongoSchema = z.object({
  clusters: z.array(z.object({
    name: z.string().min(1), type: z.string().default(''), managed_by: opt,
    servers: z.array(z.object({ ip: z.string().min(1), role: z.string().default('Member') })).default([]),
  })).default([]),
});

export type MysqlInventory = { groups: { name: string; servers: { ip: string; role: string; label: string; dns: string; instance: string; version: string; slaveOf: string }[] }[] };
export type MongoInventory = { clusters: { name: string; type: string; managedBy: string; servers: { ip: string; role: string }[] }[] };

const dirs = () => [process.env.INVENTORY_DIR, '/inventory', path.resolve(process.cwd(), '../deploy/k8s')].filter(Boolean) as string[];

const cache = new Map<string, { mtime: number; value: unknown }>();
// Reads one inventory file. Returns the data (or the last good copy) and an error message if it could not be read.
function load<T>(name: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, empty: T): { data: T; error: string | null } {
  const file = dirs().map((d) => path.join(d, name)).find((f) => existsSync(f));
  if (!file) return { data: empty, error: `${name} was not found` };
  const mtime = statSync(file).mtimeMs;
  const hit = cache.get(name);
  if (hit && hit.mtime === mtime) return { data: hit.value as T, error: null };
  try {
    const data = schema.parse(parse(readFileSync(file, 'utf8')));
    cache.set(name, { mtime, value: data });
    return { data, error: null };
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : (e as Error).message;
    console.error(`${name} is invalid:`, msg);
    return { data: (hit?.value as T) ?? empty, error: `${name} is invalid${hit ? ', so the last good copy is in use' : ''}: ${msg}` };
  }
}

export function inventory() {
  const my = load('mysql-inventory.yaml', mysqlSchema, { groups: [] });
  const mo = load('mongodb-inventory.yaml', mongoSchema, { clusters: [] });
  const mysql: MysqlInventory = {
    groups: my.data.groups.map((g) => ({ name: g.name, servers: g.servers.map((s) => ({ ip: s.ip.trim(), role: s.role, label: s.label ?? '', dns: s.dns ?? '', instance: s.instance ?? '', version: s.version ?? '', slaveOf: s.slave_of ?? '' })) })),
  };
  const mongodb: MongoInventory = {
    clusters: mo.data.clusters.map((c) => ({ name: c.name, type: c.type, managedBy: c.managed_by ?? '', servers: c.servers.map((s) => ({ ip: s.ip.trim(), role: s.role })) })),
  };
  return { mysql, mongodb, errors: [my.error, mo.error].filter(Boolean) as string[] };
}
