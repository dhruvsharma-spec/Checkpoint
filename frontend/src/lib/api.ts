export class ApiError extends Error {
  constructor(public status: number, message: string, public missing?: string[]) { super(message); }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const r = await fetch('/api' + path, {
    method: init.method ?? (init.body ? 'POST' : 'GET'),
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
    credentials: 'include',
    cache: 'no-store',
  });
  let json: any = null;
  try { json = await r.json(); } catch { /* empty body */ }
  if (!r.ok) {
    const msg = Array.isArray(json?.message) ? json.message.join(', ') : json?.message ?? r.statusText;
    throw new ApiError(r.status, String(msg), json?.missing);
  }
  return json as T;
}
