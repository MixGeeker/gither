import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { getMigrations } from 'better-auth/db/migration';
import { authOptions } from '../.auth-dist/auth.js';
import { handleAuthRequest } from '../.auth-dist/index.js';

const origin = 'https://gither.example';
function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_auth.sql', import.meta.url), 'utf8'));
  const env = { DB: db, AUTH_ENABLED: 'true', BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: 'test-only-not-a-real-secret-at-least-32-characters',
    GOOGLE_CLIENT_ID: 'test-google-id', GOOGLE_CLIENT_SECRET: 'test-google-secret',
    GITHUB_CLIENT_ID: 'test-github-id', GITHUB_CLIENT_SECRET: 'test-github-secret' };
  return { db, env };
}
function post(path, body, requestOrigin = origin) {
  return new Request(origin + path, { method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1' }, body: JSON.stringify(body) });
}

test('unconfigured status is safe and auth endpoints fail explicitly', async () => {
  const status = await handleAuthRequest(new Request(origin + '/api/auth/status'), {});
  assert.equal(status.status, 200);
  assert.equal(status.headers.get('cache-control'), 'no-store');
  assert.equal((await status.json()).configured, false);
  const login = await handleAuthRequest(post('/api/auth/sign-in/social', { provider: 'google' }), {});
  assert.equal(login.status, 503);
  assert.equal((await login.json()).code, 'AUTH_UNCONFIGURED');
  assert.equal(login.headers.has('set-cookie'), false);
});

test('migration matches installed Better Auth schema and database rate limits', async () => {
  const { db, env } = fixture();
  try {
    const plan = await getMigrations(authOptions(env));
    assert.deepEqual(plan.toBeCreated, []);
    assert.deepEqual(plan.toBeAdded, []);
    assert.deepEqual(plan.toBeAddedIndexes, []);
    assert.deepEqual(plan.schemaProblems, []);
  } finally { db.close(); }
});

test('cross-origin, scope escalation and unavailable provider fail before OAuth', async () => {
  const { db, env } = fixture();
  try {
    for (const req of [post('/api/auth/sign-in/social', { provider: 'google' }, 'https://evil.example'), post('/api/auth/sign-in/social', { provider: 'google' }, '')]) {
      assert.equal((await handleAuthRequest(req, env)).status, 403);
    }
    for (const body of [{ provider: 'google', scopes: ['https://mail.google.com/'] }, { provider: 'google', idToken: { token: 'fake' } }, { provider: 'github', additionalParams: { scope: 'repo' } }]) {
      assert.equal((await handleAuthRequest(post('/api/auth/sign-in/social', body), env)).status, 400);
    }
    assert.equal((await handleAuthRequest(post('/api/auth/sign-in/social', { provider: 'unknown' }), env)).status, 503);
  } finally { db.close(); }
});

test('real OAuth initiation sets secure state and PKCE using only identity scopes, without contacting providers', async () => {
  const { db, env } = fixture();
  try {
    for (const provider of ['google', 'github']) {
      const response = await handleAuthRequest(post('/api/auth/sign-in/social', { provider, callbackURL: '/' }), env);
      assert.equal(response.status, 200);
      const body = await response.json();
      const url = new URL(body.url);
      assert.equal(url.searchParams.get('redirect_uri'), `${origin}/api/auth/callback/${provider}`);
      assert.ok(url.searchParams.get('state'));
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.ok(url.searchParams.get('code_challenge'));
      assert.deepEqual(url.searchParams.get('scope').split(' ').sort(), (provider === 'google' ? ['openid', 'email', 'profile'] : ['read:user', 'user:email']).sort());
      const cookie = response.headers.get('set-cookie');
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /Secure/i);
      assert.match(cookie, /SameSite=Lax/i);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
  } finally { db.close(); }
});

test('session endpoint does not invent a session; password signup stays disabled', async () => {
  const { db, env } = fixture();
  try {
    const session = await handleAuthRequest(new Request(origin + '/api/auth/get-session'), env);
    assert.equal(session.status, 200);
    assert.equal(await session.json(), null);
    const signup = await handleAuthRequest(post('/api/auth/sign-up/email', { name: 'Test', email: 'test@example.com', password: 'test-password-not-used' }), env);
    assert.notEqual(signup.status, 200);
    assert.equal(db.prepare('select count(*) as count from user').get().count, 0);
  } finally { db.close(); }
});

test('security options preserve encryption, explicit linking, CSRF, and revocation checks', () => {
  const { db, env } = fixture();
  try {
    const options = authOptions(env);
    assert.equal(options.account.encryptOAuthTokens, true);
    assert.equal(options.account.skipStateCookieCheck, false);
    assert.equal(options.account.accountLinking.disableImplicitLinking, true);
    assert.equal(options.account.accountLinking.allowUnlinkingAll, false);
    assert.equal(options.account.accountLinking.allowDifferentEmails, false);
    assert.equal(options.session.cookieCache.enabled, false);
    assert.equal(options.rateLimit.storage, 'database');
    assert.equal(options.advanced.disableOriginCheck, false);
    assert.equal(options.advanced.disableCSRFCheck, false);
    assert.deepEqual(options.trustedOrigins, [origin]);
  } finally { db.close(); }
});

test('callback without a matching OAuth state cannot create a user or session', async () => {
  const { db, env } = fixture();
  try {
    const response = await handleAuthRequest(new Request(origin + '/api/auth/callback/google?code=invalid-test-code&state=nonexistent-test-state'), env);
    assert.notEqual(response.status, 200);
    assert.equal(db.prepare('select count(*) as count from user').get().count, 0);
    assert.equal(db.prepare('select count(*) as count from session').get().count, 0);
  } finally { db.close(); }
});
