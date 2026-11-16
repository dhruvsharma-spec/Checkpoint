// Sign-in through the company's OpenID Connect provider (OIDC). This is the generic path: it reads the provider's
// discovery document, so the only things it needs are an issuer URL and a client id and secret. Google keeps its own
// small path in auth.ts because it is already there and works; both end in the same signInIdentity().
//
// Flow: /auth/oidc makes a state and a PKCE verifier, keeps both in a short-lived signed cookie, and redirects to the
// provider. The provider sends the browser back to /auth/oidc/callback with a code, which is exchanged for an ID token.
import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import { cfg } from './config';
import { SessionUser, signInIdentity } from './auth';
import { bad, unauthorized } from './http';

export const OIDC_COOKIE = 'cp_oidc';
const key = () => new TextEncoder().encode(cfg.sessionSecret);
const b64url = (b: Buffer) => b.toString('base64url');

export const oidcConfigured = () => !!(cfg.oidc.issuer && cfg.oidc.clientId && cfg.oidc.clientSecret);

type Discovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri?: string; userinfo_endpoint?: string };
let cached: { at: number; d: Discovery } | undefined;

export async function discovery(): Promise<Discovery> {
  if (cached && Date.now() - cached.at < 3_600_000) return cached.d;
  const url = cfg.oidc.discoveryUrl || `${cfg.oidc.issuer}/.well-known/openid-configuration`;
  let d: Discovery;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(String(r.status));
    d = (await r.json()) as Discovery;
  } catch {
    // The button exists but the provider cannot be reached: say so rather than sending the browser somewhere broken.
    throw bad('The sign-in provider could not be reached. Check OIDC_ISSUER or OIDC_DISCOVERY_URL.');
  }
  if (!d.authorization_endpoint || !d.token_endpoint) throw bad('The sign-in provider discovery document is missing its endpoints.');
  cached = { at: Date.now(), d };
  return d;
}

// Step 1: build the URL to send the browser to, plus the cookie that proves the callback belongs to this attempt.
export async function begin(next: string): Promise<{ url: string; cookie: string }> {
  const d = await discovery();
  const state = randomBytes(16).toString('hex');
  const verifier = b64url(randomBytes(32));
  // A nonce goes with the request and must come back inside the ID token, so a token captured from another session
  // cannot be replayed here.
  const nonce = b64url(randomBytes(16));
  const u = new URL(d.authorization_endpoint);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.oidc.clientId);
  u.searchParams.set('redirect_uri', cfg.oidc.redirectUri);
  u.searchParams.set('scope', cfg.oidc.scopes);
  u.searchParams.set('state', state);
  u.searchParams.set('nonce', nonce);
  if (cfg.oidc.pkce) {
    u.searchParams.set('code_challenge', b64url(createHash('sha256').update(verifier).digest()));
    u.searchParams.set('code_challenge_method', 'S256');
  }
  const cookie = await new SignJWT({ st: state, vf: verifier, nc: nonce, nx: next })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(key());
  return { url: u.toString(), cookie };
}

const pick = (claims: Record<string, unknown>, path: string) =>
  path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Record<string, unknown>)[k] : undefined), claims);

// Step 2: check the state, swap the code for tokens, verify the ID token, and sign the person in.
export async function finish(code: string, state: string, cookie: string): Promise<{ user: SessionUser; next: string }> {
  let saved: { st?: string; vf?: string; nc?: string; nx?: string };
  try {
    saved = (await jwtVerify(cookie, key(), { algorithms: ['HS256'] })).payload as typeof saved;
  } catch {
    throw bad('The sign-in session expired. Please try again.');
  }
  if (!state || state !== saved.st) throw bad('The sign-in response did not match this session. Please try again.');

  const d = await discovery();
  const form = new URLSearchParams({
    grant_type: 'authorization_code', code, redirect_uri: cfg.oidc.redirectUri,
    client_id: cfg.oidc.clientId, client_secret: cfg.oidc.clientSecret,
  });
  if (cfg.oidc.pkce && saved.vf) form.set('code_verifier', saved.vf);
  const exchange = (auth?: string) =>
    fetch(d.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...(auth ? { authorization: auth } : {}) },
      body: auth ? new URLSearchParams({ ...Object.fromEntries(form), client_secret: '' }) : form,
      signal: AbortSignal.timeout(10_000),
    });

  // IdPs disagree on how the client authenticates: most take the secret in the body, some only accept HTTP Basic.
  let r = await exchange();
  if (r.status === 401) r = await exchange('Basic ' + Buffer.from(`${encodeURIComponent(cfg.oidc.clientId)}:${encodeURIComponent(cfg.oidc.clientSecret)}`).toString('base64'));
  if (!r.ok) {
    // The provider's own reason (invalid_client, redirect_uri mismatch, ...) is what makes this fixable.
    const why = (await r.text().catch(() => '')).split(cfg.oidc.clientSecret).join('***').replace(/\s+/g, ' ').slice(0, 300);
    console.warn(`OIDC: the token endpoint answered ${r.status}: ${why}`);
    throw unauthorized(`Sign-in was refused by the provider (${r.status}).`);
  }
  const tokens = (await r.json()) as { id_token?: string; access_token?: string };

  let claims: Record<string, unknown>;
  if (tokens.id_token && d.jwks_uri) {
    const { payload } = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(d.jwks_uri)), {
      issuer: d.issuer || cfg.oidc.issuer, audience: cfg.oidc.clientId, clockTolerance: 60,
    });
    claims = payload as Record<string, unknown>;
    // Only checked when the provider echoes it: a provider that ignores nonce is not refused, one that returns a
    // different value is.
    if (saved.nc && claims.nonce !== undefined && claims.nonce !== saved.nc) throw unauthorized('The sign-in response did not belong to this session.');
  } else if (tokens.access_token && d.userinfo_endpoint) {
    // A provider without an ID token: the userinfo endpoint is the identity, trusted because it is the same issuer.
    const u = await fetch(d.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10_000) });
    if (!u.ok) throw unauthorized('The provider did not return an identity.');
    claims = (await u.json()) as Record<string, unknown>;
  } else {
    throw unauthorized('The provider did not return an identity.');
  }

  const email = String(pick(claims, cfg.oidc.emailClaim) ?? '').trim();
  if (!email) throw unauthorized(`The provider response has no ${cfg.oidc.emailClaim} claim.`);
  // Only an explicit "false" is refused: plenty of in-house IdPs omit email_verified entirely.
  if (cfg.oidc.requireVerified && pick(claims, 'email_verified') === false) throw unauthorized('This account email is not verified.');
  const name = String(pick(claims, cfg.oidc.nameClaim) ?? pick(claims, 'preferred_username') ?? '');
  return { user: await signInIdentity(email, name), next: saved.nx ?? '' };
}
