// All settings come from environment variables. Nothing else in the code reads process.env.
const env = process.env;

// APP_ENV=local turns on developer conveniences (dev sign-in buttons, plain-http cookies).
// Anything else, including leaving it unset, behaves as production.
const prod = env.APP_ENV !== 'local';
const webUrl = (env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const list = (v: string | undefined, d = '') => (v ?? d).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

export const cfg = {
  prod,
  port: Number(env.PORT ?? 4000),
  // The YAML that says who approves each step. Empty means: /config/approvers.yaml, then deploy/k8s/approvers.yaml.
  approversFile: env.APPROVERS_FILE ?? '',
  // Which kinds of CCB can be filed. Only General for now; a comma-separated list of type keys, or "all", turns more on.
  // CCBs of other types that already exist stay visible.
  enabledTypes: (env.ENABLED_CCB_TYPES || 'general').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  // The address people open in the browser (the frontend). Emails link here and Google redirects back here.
  webUrl,
  sessionSecret: env.SESSION_SECRET ?? 'dev-only-secret-change-me',
  sessionHours: Number(env.SESSION_HOURS ?? 8),
  allowedDomains: list(env.ALLOWED_EMAIL_DOMAINS, 'lenskart.com,lenskart.in'),
  bootstrapAdmins: list(env.BOOTSTRAP_ADMINS),
  google: {
    clientId: env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: env.GOOGLE_CLIENT_SECRET ?? '',
    redirectUri: env.GOOGLE_REDIRECT_URI || `${webUrl}/api/auth/google/callback`,
  },
  // Sign-in through an OpenID Connect provider (the company IdP). Everything is optional: with no issuer and no client
  // id, the login page simply shows no such button.
  oidc: {
    issuer: (env.OIDC_ISSUER ?? '').replace(/\/$/, ''),
    // Some IdPs keep the discovery document somewhere else; this overrides issuer + /.well-known/openid-configuration.
    discoveryUrl: env.OIDC_DISCOVERY_URL ?? '',
    clientId: env.OIDC_CLIENT_ID ?? '',
    clientSecret: env.OIDC_CLIENT_SECRET ?? '',
    scopes: env.OIDC_SCOPES || 'openid email profile',
    redirectUri: env.OIDC_REDIRECT_URI || `${webUrl}/api/auth/oidc/callback`,
    // What the login button says, and which claim holds the address and the display name.
    label: env.OIDC_LABEL || 'Company SSO',
    emailClaim: env.OIDC_EMAIL_CLAIM || 'email',
    nameClaim: env.OIDC_NAME_CLAIM || 'name',
    // Many in-house IdPs do not send email_verified. Turn this off only if the IdP itself is trusted to hold the address.
    requireVerified: (env.OIDC_REQUIRE_VERIFIED ?? 'true') === 'true',
    pkce: (env.OIDC_PKCE ?? 'true') === 'true',
  },
  // Cookies are Secure in production. COOKIE_SECURE=false is only for plain-http setups.
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : prod,
  devLogin: !prod && (env.DEV_LOGIN ?? 'true') === 'true',
  // Mail: local uses Mailpit (no login, no TLS). Production points at SES's SMTP endpoint,
  // for example email-smtp.<region>.amazonaws.com:587 with SMTP credentials and SMTP_TLS=true.
  smtp: {
    host: env.SMTP_HOST ?? 'localhost',
    port: Number(env.SMTP_PORT ?? 1025),
    user: env.SMTP_USER || undefined,
    pass: env.SMTP_PASS || undefined,
    requireTls: (env.SMTP_TLS ?? 'false') === 'true',
    from: env.MAIL_FROM ?? 'Checkpoint <checkpoint@lenskart.com>',
  },
  outbox: { maxAttempts: Number(env.OUTBOX_MAX_ATTEMPTS ?? 6), pollMs: Number(env.OUTBOX_POLL_MS ?? 3000) },
};

if (cfg.prod && cfg.sessionSecret === 'dev-only-secret-change-me') {
  throw new Error('SESSION_SECRET must be set when APP_ENV is not "local".');
}
