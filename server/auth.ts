import { createHash, randomBytes } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { hashPassword, verifyPassword } from 'better-auth/crypto';
import { authOptions } from './auth-config.js';
import type { AuthConfiguration } from './auth-config.js';
import { migrateAuth } from './auth-migrations.js';
import { createKeyStore } from './key-store.js';

export type { AuthConfiguration } from './auth-config.js';
export { AUTH_SCOPES } from './key-store.js';
export type { AuthScope, KeyAudience, KeyMetadata, KeyPrincipal, CreateKeyInput } from './key-store.js';
export interface SessionUser { id: string; email: string; name: string; role: 'owner' | 'member' }
export interface OwnerInput { email: string; name: string; password: string }
export interface ResetOwnerPasswordInput { email: string; password: string }
const BODY_LIMIT = 4096;
const LOGIN_WINDOW = 15 * 60 * 1000;
// Match the email shape accepted by the installed Better Auth/Zod sign-in
// validator, so trusted CLI bootstrap cannot create an unusable login address.
const EMAIL_PATTERN = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
const allowedRoutes = new Map([
  ['/api/auth/sign-in/email', 'POST'],
  ['/api/auth/sign-out', 'POST'],
  ['/api/auth/get-session', 'GET'],
]);

function failure(code: string, status: number): Response {
  return Response.json({ code }, { status, headers: { 'cache-control': 'no-store' } });
}
async function boundedBody(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('content-type')?.match(/^application\/json(?:\s*;|$)/i)) return null;
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (!Number.isFinite(declared) || declared > BODY_LIMIT || declared < 0) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > BODY_LIMIT) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch { return null; } finally { reader.releaseLock(); }
}

export async function createAuthService(config: AuthConfiguration) {
  const options = authOptions(config);
  await migrateAuth(config.db, options);
  const auth = betterAuth(options);
  const db = config.db;

  function originAllowed(request: Request, requireOrigin = false): boolean {
    return new URL(request.url).origin === config.origin &&
      (!requireOrigin && !request.headers.has('origin') || request.headers.get('origin') === config.origin) &&
      request.headers.get('sec-fetch-site') !== 'cross-site';
  }
  function takeLoginAttempt(email: string): boolean {
    const now = Date.now();
    const windowStart = Math.floor(now / LOGIN_WINDOW) * LOGIN_WINDOW;
    const emailBucket = 'email:' + createHash('sha256').update(email.toLowerCase()).digest('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM gither_login_limits WHERE window_start < ?').run(windowStart);
      for (const [bucket, max] of [['global', 200], [emailBucket, 10]] as const) {
        const row = db.prepare('SELECT attempts FROM gither_login_limits WHERE bucket = ?').get(bucket) as { attempts: number } | undefined;
        if (row && row.attempts >= max) { db.exec('ROLLBACK'); return false; }
      }
      for (const bucket of ['global', emailBucket]) db.prepare(`INSERT INTO gither_login_limits(bucket,window_start,attempts)
        VALUES (?,?,1) ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1`).run(bucket, windowStart);
      db.exec('COMMIT');
      return true;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  async function session(request: Request): Promise<SessionUser | null> {
    if (!originAllowed(request) || request.headers.has('authorization')) return null;
    const result = await auth.api.getSession({ headers: request.headers, query: { disableRefresh: true } });
    if (!result?.user?.id) return null;
    // Never authorize using a role supplied by the client or a cached cookie.
    const user = db.prepare('SELECT id,email,name,role FROM "user" WHERE id = ?').get(result.user.id) as SessionUser | undefined;
    return user && ['owner', 'member'].includes(user.role) ? { ...user } : null;
  }

  /** Password check for a sensitive browser-session mutation. Never accepts a
   * key principal, never creates a session, and shares the persistent throttle. */
  async function reauthenticate(request: Request, password: string): Promise<boolean> {
    if (!['POST', 'DELETE', 'PATCH', 'PUT'].includes(request.method) || !originAllowed(request, true) ||
        typeof password !== 'string' || password.length < 1 || password.length > 128) return false;
    const user = await session(request);
    if (!user || user.role !== 'owner' || !takeLoginAttempt(user.email)) return false;
    const account = db.prepare('SELECT password FROM account WHERE userId = ? AND providerId = ?').get(user.id, 'credential') as { password: string | null } | undefined;
    if (!account?.password) return false;
    try {
      if (!await verifyPassword({ hash: account.password, password })) return false;
      // Recovery may race the asynchronous scrypt operation. An old password
      // and a session deleted while it ran must not authorize a later mutation.
      const current = db.prepare('SELECT password FROM account WHERE userId = ? AND providerId = ?')
        .get(user.id, 'credential') as { password: string | null } | undefined;
      return current?.password === account.password && (await session(request))?.id === user.id;
    } catch { return false; }
  }

  async function createOwner(input: OwnerInput): Promise<SessionUser> {
    if (!input || typeof input.email !== 'string' || input.email.length > 254 ||
        !EMAIL_PATTERN.test(input.email) ||
        typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128 ||
        typeof input.name !== 'string' || input.name.trim().length < 1 || input.name.trim().length > 80 ||
        /[\u0000-\u001f\u007f]/.test(input.name)) throw new Error('INVALID_OWNER_INPUT');
    // Hash before entering a synchronous transaction: no awaits occur while the
    // write lock is held, so concurrent bootstrap calls cannot create two owners.
    const passwordHash = await hashPassword(input.password);
    const id = randomBytes(16).toString('base64url');
    const accountId = randomBytes(16).toString('base64url');
    const user: SessionUser = { id, email: input.email.toLowerCase(), name: input.name.trim(), role: 'owner' };
    const now = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      if (db.prepare('SELECT 1 FROM "user" WHERE role = ? LIMIT 1').get('owner') ||
          db.prepare('SELECT 1 FROM gither_owner_bootstrap LIMIT 1').get()) throw new Error('OWNER_ALREADY_INITIALIZED');
      db.prepare('INSERT INTO "user"(id,email,name,emailVerified,createdAt,updatedAt,role) VALUES (?,?,?,0,?,?,?)')
        .run(user.id, user.email, user.name, now, now, user.role);
      db.prepare('INSERT INTO "account"(id,accountId,providerId,userId,password,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)')
        .run(accountId, id, 'credential', id, passwordHash, now, now);
      db.prepare('INSERT INTO gither_owner_bootstrap(singleton,user_id,created_at) VALUES (1,?,?)').run(id, Date.now());
      db.exec('COMMIT');
      return user;
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  function hasOwner(): boolean {
    return Boolean(db.prepare('SELECT 1 FROM "user" WHERE role = ? LIMIT 1').get('owner'));
  }

  /** Offline CLI recovery only. No HTTP route must expose this function. Local
   * deployment access is the trust boundary; all prior sessions/keys are revoked. */
  async function resetOwnerPassword(input: ResetOwnerPasswordInput): Promise<SessionUser> {
    if (!input || typeof input.email !== 'string' || input.email.length > 254 ||
        !EMAIL_PATTERN.test(input.email) ||
        typeof input.password !== 'string' || input.password.length < 12 || input.password.length > 128) {
      throw new Error('INVALID_OWNER_INPUT');
    }
    const passwordHash = await hashPassword(input.password);
    const now = Date.now();
    db.exec('BEGIN IMMEDIATE');
    try {
      const user = db.prepare('SELECT id,email,name,role FROM "user" WHERE email = ? AND role = ?')
        .get(input.email.toLowerCase(), 'owner') as SessionUser | undefined;
      if (!user) throw new Error('OWNER_NOT_FOUND');
      const result = db.prepare('UPDATE account SET password = ?, updatedAt = ? WHERE userId = ? AND providerId = ?')
        .run(passwordHash, new Date(now).toISOString(), user.id, 'credential');
      if (result.changes !== 1) throw new Error('OWNER_CREDENTIAL_INCONSISTENT');
      db.prepare('DELETE FROM session WHERE userId = ?').run(user.id);
      db.prepare('UPDATE gither_keys SET revoked_at = COALESCE(revoked_at, ?) WHERE user_id = ?').run(now, user.id);
      db.exec('COMMIT');
      return { ...user };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }

  async function authHandler(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = allowedRoutes.get(url.pathname);
    if (!method) return failure('AUTH_ROUTE_DISABLED', 404);
    if (request.method !== method) return failure('METHOD_NOT_ALLOWED', 405);
    if (!originAllowed(request, method === 'POST')) return failure('ORIGIN_NOT_ALLOWED', 403);
    if (url.search || request.headers.has('authorization')) return failure('INVALID_AUTH_REQUEST', 400);
    let forwarded = request;
    let loginCredential: { userId: string; password: string } | undefined;
    if (method === 'POST') {
      const body = await boundedBody(request);
      if (!body) return failure('INVALID_AUTH_BODY', 400);
      const permitted = url.pathname.endsWith('/sign-in/email') ? ['email', 'password', 'rememberMe'] : [];
      if (Object.keys(body).some(key => !permitted.includes(key))) return failure('INVALID_AUTH_BODY', 400);
      if (url.pathname.endsWith('/sign-in/email')) {
        if (typeof body.email !== 'string' || body.email.length > 254 ||
            typeof body.password !== 'string' || body.password.length > 128 ||
            (body.rememberMe !== undefined && typeof body.rememberMe !== 'boolean')) return failure('INVALID_AUTH_BODY', 400);
        if (!takeLoginAttempt(body.email)) return new Response(JSON.stringify({ code: 'LOGIN_RATE_LIMITED' }), {
          status: 429, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'retry-after': String(LOGIN_WINDOW / 1000) },
        });
        loginCredential = db.prepare(`SELECT a.userId, a.password FROM account a JOIN "user" u ON u.id = a.userId
          WHERE u.email = ? AND a.providerId = 'credential' AND a.accountId = u.id`)
          .get(body.email.toLowerCase()) as { userId: string; password: string } | undefined;
      }
      const headers = new Headers(request.headers);
      headers.delete('content-length');
      forwarded = new Request(request.url, { method, headers, body: JSON.stringify(body) });
    }
    const response = await auth.handler(forwarded);
    const headers = new Headers(response.headers);
    headers.set('cache-control', 'no-store');
    // Keep the session credential exclusively in its HttpOnly cookie. Better
    // Auth normally also returns it in sign-in/get-session JSON bodies.
    if (response.headers.get('content-type')?.includes('application/json')) {
      const payload: unknown = await response.json();
      if (payload && typeof payload === 'object') {
        const safe = payload as Record<string, unknown>;
        if (response.ok && url.pathname.endsWith('/sign-in/email')) {
          const current = loginCredential && db.prepare('SELECT password FROM account WHERE userId = ? AND providerId = ?')
            .get(loginCredential.userId, 'credential') as { password: string } | undefined;
          if (!loginCredential || current?.password !== loginCredential.password) {
            // An offline reset cannot be undone by an already-running login
            // that verified the old hash before reset deleted its sessions.
            if (typeof safe.token === 'string') db.prepare('DELETE FROM session WHERE token = ?').run(safe.token);
            return failure('CREDENTIALS_CHANGED_RETRY_LOGIN', 401);
          }
        }
        delete safe.token;
        if (safe.session && typeof safe.session === 'object') delete (safe.session as Record<string, unknown>).token;
      }
      headers.delete('content-length');
      return new Response(JSON.stringify(payload), { status: response.status, headers });
    }
    return new Response(response.body, { status: response.status, headers });
  }

  return { authHandler, session, createOwner, hasOwner, resetOwnerPassword, reauthenticate, ...createKeyStore(db) };
}
export type AuthService = Awaited<ReturnType<typeof createAuthService>>;
