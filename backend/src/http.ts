import type { Request, RequestHandler, Response } from 'express';
import { ZodError, ZodType, ZodTypeDef } from 'zod';

// An error the caller should see, with the HTTP status to use.
export class HttpError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}
export const bad = (m: string, extra?: Record<string, unknown>) => new HttpError(400, m, extra);
export const unauthorized = (m = 'Unauthorized') => new HttpError(401, m);
export const forbidden = (m = 'Forbidden') => new HttpError(403, m);
export const notFound = (m = 'Not found') => new HttpError(404, m);
export const conflict = (m: string) => new HttpError(409, m);

export function sendError(res: Response, e: unknown) {
  if (e instanceof HttpError) return void res.status(e.status).json({ message: e.message, ...e.extra });
  if (e instanceof ZodError) return void res.status(400).json({ message: e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join(', ') });
  console.error('Unhandled error', e);
  res.status(500).json({ message: 'Internal server error' });
}

// Wraps a route so thrown errors become JSON responses instead of crashing the request.
// Whatever the function returns is sent as JSON, unless it already answered (a redirect, for example).
export function handle(fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return async (req, res) => {
    try {
      const out = await fn(req, res);
      if (!res.headersSent) res.json(out ?? { ok: true });
    } catch (e) {
      sendError(res, e);
    }
  };
}

// Checks the JSON body against a schema. Unknown fields are dropped.
// The input type is left open so schemas with .default() give back their filled-in output type.
export function body<T>(req: Request, schema: ZodType<T, ZodTypeDef, unknown>): T {
  if (!req.body || typeof req.body !== 'object') throw bad('Request body must be JSON');
  return schema.parse(req.body);
}
