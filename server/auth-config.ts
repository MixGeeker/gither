import type { DatabaseSync } from 'node:sqlite';
import type { BetterAuthOptions } from 'better-auth';

export interface AuthConfiguration {
  db: DatabaseSync;
  origin: string;
  secret: string;
  /** Development only. HTTP still requires an exact loopback hostname. */
  allowLocalhost?: boolean;
}

export function authOptions(config: AuthConfiguration): BetterAuthOptions {
  if (!config.db || typeof config.db.prepare !== 'function') throw new Error('AUTH_DATABASE_REQUIRED');
  let origin: URL;
  try { origin = new URL(config.origin); } catch { throw new Error('AUTH_ORIGIN_INVALID'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.origin !== config.origin || origin.username || origin.password ||
      (origin.protocol !== 'https:' && !(config.allowLocalhost === true && loopback && origin.protocol === 'http:'))) {
    throw new Error('AUTH_ORIGIN_MUST_BE_EXACT_HTTPS_OR_EXPLICIT_LOOPBACK');
  }
  // This catches missing/default configuration, not entropy. Generate the secret
  // with a CSPRNG (e.g. 32 random bytes) and keep it outside source control.
  if (typeof config.secret !== 'string' || config.secret.length < 32 || config.secret.length > 1024 ||
      config.secret.trim() !== config.secret || new Set(config.secret).size < 12 ||
      /^(?:change[-_ ]?me|replace[-_ ]?me|your[-_ ]?secret|better-auth-secret|example|placeholder)/i.test(config.secret)) {
    throw new Error('AUTH_SECRET_MUST_BE_RANDOM_AND_AT_LEAST_32_CHARACTERS');
  }
  return {
    appName: 'Gither',
    database: config.db,
    baseURL: config.origin,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: [config.origin],
    socialProviders: {},
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      // Owner bootstrap proves control of the deployment, NOT the email inbox.
      // No verification flag is fabricated, and no email/recovery flow is exposed.
      requireEmailVerification: false,
    },
    account: { accountLinking: { enabled: false } },
    user: {
      additionalFields: {
        role: { type: 'string', required: true, defaultValue: 'member', input: false },
      },
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    // The HTTP server must overwrite this header from the actual socket or a
    // specifically trusted proxy. The separate account/global throttle below
    // also works when there is no client IP, and never trusts forwarded headers.
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: { '/sign-in/email': { window: 60, max: 10 } },
    },
    advanced: {
      useSecureCookies: origin.protocol === 'https:',
      cookiePrefix: 'gither',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: origin.protocol === 'https:', path: '/' },
      ipAddress: { ipAddressHeaders: ['x-gither-client-ip'] },
      disableCSRFCheck: false,
      disableOriginCheck: false,
    },
    logger: { disabled: true },
  };
}
