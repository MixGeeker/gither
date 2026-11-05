import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { authConfiguration, type AuthEnv } from './config.js';

/** Construct only after the explicit deployment/configuration gate passes. */
export function authOptions(env: AuthEnv): BetterAuthOptions {
  const { configured, origin, providers } = authConfiguration(env);
  if (!configured || !origin || !env.DB || !env.BETTER_AUTH_SECRET) throw new Error('AUTH_UNCONFIGURED');
  return {
    appName: 'Gither', baseURL: origin, basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: env.DB,
    trustedOrigins: [origin],
    plugins: [{ id: 'gither-account-identity', schema: { account: { fields: {},
      indexes: [{ fields: ['providerId', 'accountId'], unique: true }],
    } } }],
    emailAndPassword: { enabled: false },
    socialProviders: {
      ...(providers.google ? { google: {
        clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET!,
        disableDefaultScope: true, scope: ['openid', 'email', 'profile'],
      } } : {}),
      ...(providers.github ? { github: {
        clientId: env.GITHUB_CLIENT_ID!, clientSecret: env.GITHUB_CLIENT_SECRET!,
        disableDefaultScope: true, scope: ['read:user', 'user:email'],
      } } : {}),
    },
    account: {
      encryptOAuthTokens: true,
      skipStateCookieCheck: false,
      storeStateStrategy: 'database',
      storeAccountCookie: false,
      accountLinking: {
        enabled: true, disableImplicitLinking: true,
        allowDifferentEmails: false, allowUnlinkingAll: false,
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    verification: { storeInDatabase: true },
    rateLimit: { enabled: true, storage: 'database', window: 60, max: 60 },
    advanced: {
      useSecureCookies: origin.startsWith('https:'),
      disableCSRFCheck: false, disableOriginCheck: false,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', path: '/' },
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    // Avoid logging provider responses, tokens, credentials, or callback parameters.
    logger: { disabled: true },
  };
}

export function createAuth(env: AuthEnv) { return betterAuth(authOptions(env)); }
