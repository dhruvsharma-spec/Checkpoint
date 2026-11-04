// The frontend has no API of its own. Every /api request is forwarded to the backend service, so the
// browser still sees one address (cookies stay on it and the Google sign-in redirect keeps working).
// BACKEND_URL is read on each request, so the image is not tied to one cluster address.
export const dynamic = 'force-dynamic';

const backend = () => (process.env.BACKEND_URL ?? 'http://localhost:4000').replace(/\/$/, '');

// Headers that describe one hop of the connection, not the message. They must not be copied across.
const HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'host', 'content-length', 'content-encoding']);

async function forward(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const headers = new Headers();
  req.headers.forEach((v, k) => { if (!HOP.has(k.toLowerCase())) headers.set(k, v); });
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

  let res: Response;
  try {
    res = await fetch(backend() + url.pathname + url.search, {
      method: req.method, headers, body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: 'manual', cache: 'no-store', // the Google sign-in redirect must reach the browser, not be followed here
    });
  } catch {
    return Response.json({ message: 'The service is not reachable right now. Try again in a moment.' }, { status: 502 });
  }

  const out = new Headers();
  res.headers.forEach((v, k) => { if (!HOP.has(k.toLowerCase()) && k.toLowerCase() !== 'set-cookie') out.set(k, v); });
  for (const c of res.headers.getSetCookie()) out.append('set-cookie', c);
  return new Response(res.body, { status: res.status, headers: out });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
