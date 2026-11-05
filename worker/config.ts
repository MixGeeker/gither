export interface AuthEnv {
  DB?: D1Database;
  BETTER_AUTH_URL?: string;
  BETTER_AUTH_SECRET?: string;
  AUTH_ENABLED?: string;
  AUTH_ALLOW_LOCALHOST?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
}

export function authConfiguration(env: AuthEnv) {
  let origin: string | undefined;
  try {
    const url = new URL(env.BETTER_AUTH_URL ?? '');
    const local = env.AUTH_ALLOW_LOCALHOST === 'true' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((url.protocol === 'https:' || (local && url.protocol === 'http:')) &&
        !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) origin = url.origin;
  } catch { /* Missing or invalid origin fails closed. */ }
  const secret = env.BETTER_AUTH_SECRET?.trim();
  const baseConfigured = Boolean(env.AUTH_ENABLED === 'true' && env.DB && origin && secret && secret.length >= 32);
  const google = baseConfigured && Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
  const github = baseConfigured && Boolean(env.GITHUB_CLIENT_ID?.trim() && env.GITHUB_CLIENT_SECRET?.trim());
  return { origin, configured: baseConfigured && (google || github), providers: { google, github } };
}

export function publicAuthStatus(env: AuthEnv) {
  const { configured, providers } = authConfiguration(env);
  return { configured, providers, emailPassword: false, ...(configured ? {} : { reason: 'AUTH_UNCONFIGURED' }) };
}
