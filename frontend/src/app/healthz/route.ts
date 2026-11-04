export const dynamic = 'force-dynamic';

// Liveness and readiness for the frontend pod. It does not touch the backend, so a backend
// outage does not make Kubernetes restart the screens.
export const GET = () => Response.json({ ok: true });
