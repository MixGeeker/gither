import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from 'better-auth/crypto';
import { createAuthService, AUTH_SCOPES } from '../.server-dist/auth.js';
import { authOptions } from '../.server-dist/auth-config.js';

const origin = 'https://gither.example';
const ownerInput = { email: 'Owner@example.test', name: 'Test owner', password: 'Fixture-only-unshared-password!72' };
async function fixture(t, extra = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const config = { db, origin, secret: randomBytes(48).toString('base64url'), ...extra };
  const service = await createAuthService(config);
  return { db, service, config };
}
function post(path, body, extraHeaders = {}, base = origin) {
  return new Request(base + path, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) });
}
function bearer(key) {
  return new Request(origin + '/api/pool', { headers: { authorization: `Bearer ${key}` } });
}
function keyInput(extra = {}) {
  return { name: 'Fixture key', audience: 'api', scopes: ['pool:read'], expiresAt: new Date(Date.now() + 86400000).toISOString(), ...extra };
}
async function login(service, extraHeaders = {}) {
  const response = await service.authHandler(post('/api/auth/sign-in/email', {
    email: ownerInput.email.toLowerCase(), password: ownerInput.password,
  }, extraHeaders));
  const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  return { response, cookie };
}
function addMember(db, id = 'member-fixture', email = 'member@example.test') {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO "user"(id,email,name,emailVerified,createdAt,updatedAt,role) VALUES (?,?,?,0,?,?,?)')
    .run(id, email, 'Fixture member', now, now, 'member');
  return id;
}

test('configuration fails closed and OAuth is disabled', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const base = { db, origin, secret: randomBytes(48).toString('base64url') };
    for (const secret of ['', 'short', 'a'.repeat(64), 'change-me-and-replace-this-example-secret-12345']) {
      assert.throws(() => authOptions({ ...base, secret }), /AUTH_SECRET/);
    }
    for (const value of ['http://example.test', 'https://gither.example/', 'https://gither.example/path', 'https://x:g@gither.example', 'https://gither.example?x=1', 'http://localhost', 'http://127.0.0.2']) {
      assert.throws(() => authOptions({ ...base, origin: value }));
    }
    for (const value of ['http://localhost:4173', 'http://127.0.0.1:4173', 'http://[::1]:4173']) {
      assert.equal(authOptions({ ...base, origin: value, allowLocalhost: true }).advanced.useSecureCookies, false);
    }
    assert.throws(() => authOptions({ ...base, origin: 'http://localhost.attacker.test', allowLocalhost: true }));
    assert.deepEqual(authOptions(base).socialProviders, {});
    assert.equal(authOptions(base).emailAndPassword.disableSignUp, true);
    assert.equal(authOptions(base).user.additionalFields.role.input, false);
  } finally { db.close(); }
});

test('startup creates schema only; owner bootstrap is atomic, one-time, and unverified', async t => {
  const { db, service } = await fixture(t);
  assert.equal(service.hasOwner(), false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM "user"').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM "account"').get().n, 0);
  const outcomes = await Promise.allSettled([service.createOwner(ownerInput), service.createOwner({ ...ownerInput, email: 'other@example.test' })]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(outcomes.find(result => result.status === 'rejected').reason.message, /OWNER_ALREADY_INITIALIZED/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM "user"').get().n, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM account').get().n, 1);
  assert.equal(db.prepare('SELECT emailVerified FROM "user"').get().emailVerified, 0);
  assert.notEqual(db.prepare('SELECT password FROM account').get().password, ownerInput.password);
  assert.equal(service.hasOwner(), true);
  await assert.rejects(service.createOwner(ownerInput), /OWNER_ALREADY_INITIALIZED/);
});

test('offline password recovery invalidates every previous browser session and API/MCP key', async t => {
  const { db, service } = await fixture(t);
  const owner = await service.createOwner(ownerInput);
  const { cookie } = await login(service);
  const api = await service.createKey(owner.id, keyInput());
  const mcp = await service.createKey(owner.id, keyInput({ audience: 'mcp' }));
  const newPassword = 'Fixture-recovery-password!386';
  await assert.rejects(service.resetOwnerPassword({ email: ownerInput.email, password: 'short' }), /INVALID_OWNER_INPUT/);
  await assert.rejects(service.resetOwnerPassword({ email: 'other@example.test', password: newPassword }), /OWNER_NOT_FOUND/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM session').get().n, 1);
  const recovered = await service.resetOwnerPassword({ email: ownerInput.email, password: newPassword });
  assert.deepEqual(recovered, owner);
  assert.equal(db.prepare('SELECT count(*) AS n FROM session').get().n, 0);
  assert.equal(await service.session(new Request(origin + '/api/profile', { headers: { cookie } })), null);
  assert.equal(await service.verifyKey(bearer(api.key), 'api', []), null);
  assert.equal(await service.verifyKey(bearer(mcp.key), 'mcp', []), null);
  assert.equal((await login(service)).response.status, 401);
  const fresh = await service.authHandler(post('/api/auth/sign-in/email', { email: ownerInput.email, password: newPassword }));
  assert.equal(fresh.status, 200);
  await assert.rejects(service.createOwner(ownerInput), /OWNER_ALREADY_INITIALIZED/);
});

test('an in-flight old-password login cannot restore a session after offline recovery', async t => {
  const { db, service } = await fixture(t);
  const owner = await service.createOwner(ownerInput);
  const nextHash = await hashPassword('Fixture-concurrent-recovery!85');
  const pendingLogin = login(service);
  // The request captures its credential before asynchronous password hashing.
  // Simulate the atomic offline recovery commit during that hashing operation.
  await new Promise(resolve => setTimeout(resolve, 20));
  db.prepare('UPDATE account SET password = ? WHERE userId = ?').run(nextHash, owner.id);
  db.prepare('DELETE FROM session WHERE userId = ?').run(owner.id);
  const { response, cookie } = await pendingLogin;
  assert.equal(response.status, 401);
  assert.equal(cookie, '');
  assert.equal(db.prepare('SELECT count(*) AS n FROM session').get().n, 0);
});

test('invalid owner input and transactional failure leave no partial owner', async t => {
  const { db, service } = await fixture(t);
  for (const patch of [{ password: '' }, { password: 'short' }, { password: 'a'.repeat(129) }, { email: 'not-email' }, { email: 'two..dots@example.test' }, { name: '' }]) {
    await assert.rejects(service.createOwner({ ...ownerInput, ...patch }), /INVALID_OWNER_INPUT/);
  }
  addMember(db, 'existing', ownerInput.email.toLowerCase());
  await assert.rejects(service.createOwner(ownerInput));
  assert.equal(db.prepare('SELECT count(*) AS n FROM gither_owner_bootstrap').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM account').get().n, 0);
  const user = await service.createOwner({ ...ownerInput, email: 'distinct@example.test' });
  assert.equal(user.role, 'owner');
});

test('password login issues secure HttpOnly SameSite session and no raw JSON token', async t => {
  const { db, service } = await fixture(t);
  const owner = await service.createOwner(ownerInput);
  const wrong = await service.authHandler(post('/api/auth/sign-in/email', { email: ownerInput.email, password: 'incorrect-password-value' }));
  assert.equal(wrong.status, 401);
  const { response, cookie } = await login(service);
  assert.equal(response.status, 200, await response.clone().text());
  assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(response.headers.get('set-cookie'), /SameSite=Lax/i);
  assert.match(response.headers.get('set-cookie'), /Secure/i);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal('token' in await response.json(), false);
  const request = new Request(origin + '/api/profile', { headers: { cookie } });
  assert.deepEqual(await service.session(request), owner);
  assert.equal(await service.session(new Request(origin + '/api/profile')), null);
  assert.equal(await service.session(new Request(origin + '/api/profile', { headers: { cookie, authorization: 'Bearer spoof' } })), null);
  assert.equal(await service.session(new Request(origin + '/api/profile', { headers: { cookie: cookie + 'tamper' } })), null);
  const get = await service.authHandler(new Request(origin + '/api/auth/get-session', { headers: { cookie } }));
  assert.equal(get.status, 200);
  const getBody = await get.json();
  assert.equal('token' in getBody.session, false);
  assert.equal(getBody.user.emailVerified, false);
  db.prepare('UPDATE session SET expiresAt = ?').run(new Date(Date.now() - 1000).toISOString());
  assert.equal(await service.session(request), null);
});

test('local HTTP requires explicit loopback and keeps HttpOnly and SameSite', async t => {
  const local = 'http://127.0.0.1:4173';
  const { service } = await fixture(t, { origin: local, allowLocalhost: true });
  await service.createOwner(ownerInput);
  const response = await service.authHandler(post('/api/auth/sign-in/email', { email: ownerInput.email, password: ownerInput.password }, {}, local));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(response.headers.get('set-cookie'), /SameSite=Lax/i);
  assert.doesNotMatch(response.headers.get('set-cookie'), /; Secure/i);
});

test('sign-out revokes the browser session', async t => {
  const { service } = await fixture(t);
  await service.createOwner(ownerInput);
  const { cookie } = await login(service);
  const response = await service.authHandler(post('/api/auth/sign-out', {}, { cookie }));
  assert.equal(response.status, 200);
  assert.equal(await service.session(new Request(origin + '/api/profile', { headers: { cookie } })), null);
});

test('signup, OAuth, recovery, role updates, and all other auth routes are disabled', async t => {
  const { db, service } = await fixture(t);
  const owner = await service.createOwner(ownerInput);
  for (const path of ['sign-up/email', 'sign-in/social', 'callback/google', 'callback/github', 'request-password-reset', 'reset-password', 'send-verification-email', 'verify-email', 'update-user', 'admin/create-user', 'change-email', 'change-password', 'delete-user']) {
    const response = await service.authHandler(post('/api/auth/' + path, { ...ownerInput, role: 'owner' }));
    assert.equal(response.status, 404, path);
    assert.equal(response.headers.has('set-cookie'), false);
  }
  const forged = await service.authHandler(post('/api/auth/sign-in/email', { email: ownerInput.email, password: ownerInput.password, role: 'owner' }));
  assert.equal(forged.status, 400);
  assert.equal(db.prepare('SELECT count(*) AS n FROM "user"').get().n, 1);
  assert.throws(() => db.prepare('UPDATE "user" SET role = ? WHERE id = ?').run('member', owner.id), /Role changes require/);
});

test('auth rejects cross-origin, missing origin, wrong method, callbacks, and oversized body', async t => {
  const { service } = await fixture(t);
  const body = { email: ownerInput.email, password: ownerInput.password };
  for (const value of ['https://attacker.test', 'null', 'https://gither.example.attacker.test']) {
    assert.equal((await service.authHandler(post('/api/auth/sign-in/email', body, { origin: value }))).status, 403);
  }
  const noOrigin = post('/api/auth/sign-in/email', body);
  noOrigin.headers.delete('origin');
  assert.equal((await service.authHandler(noOrigin)).status, 403);
  assert.equal((await service.authHandler(post('/api/auth/sign-in/email', body, { 'sec-fetch-site': 'cross-site' }))).status, 403);
  assert.equal((await service.authHandler(new Request(origin + '/api/auth/sign-in/email'))).status, 405);
  assert.equal((await service.authHandler(post('/api/auth/sign-in/email?callbackURL=https://attacker.test', body))).status, 400);
  assert.equal((await service.authHandler(post('/api/auth/sign-in/email', { ...body, callbackURL: 'https://attacker.test' }))).status, 400);
  assert.equal((await service.authHandler(post('/api/auth/sign-in/email', { ...body, padding: 'x'.repeat(5000) }))).status, 400);
  assert.equal((await service.authHandler(post('/api/auth/sign-in/email', body, { 'content-type': 'text/plain' }))).status, 400);
});

test('login throttles account attempts even without a trusted network address', async t => {
  const { service } = await fixture(t);
  for (let attempt = 0; attempt < 10; attempt++) {
    const result = await service.authHandler(post('/api/auth/sign-in/email', { email: 'absent@example.test', password: 'fixture-not-a-password' }));
    assert.equal(result.status, 401);
  }
  const limited = await service.authHandler(post('/api/auth/sign-in/email', { email: 'ABSENT@example.test', password: 'fixture-not-a-password' }));
  assert.equal(limited.status, 429);
  assert.ok(limited.headers.has('retry-after'));
});

test('key management reauthentication requires a real same-origin owner session and password', async t => {
  const { service, db } = await fixture(t);
  const owner = await service.createOwner(ownerInput);
  const { cookie } = await login(service);
  const request = () => post('/api/keys', {}, { cookie });
  assert.equal(await service.reauthenticate(request(), ownerInput.password), true);
  assert.equal(await service.reauthenticate(request(), 'wrong-password'), false);
  assert.equal(await service.reauthenticate(post('/api/keys', {}), ownerInput.password), false);
  assert.equal(await service.reauthenticate(post('/api/keys', {}, { cookie, origin: 'https://attacker.test' }), ownerInput.password), false);
  const key = await service.createKey(owner.id, keyInput());
  assert.equal(await service.reauthenticate(post('/api/keys', {}, { cookie, authorization: `Bearer ${key.key}` }), ownerInput.password), false);
  assert.equal(db.prepare('SELECT count(*) AS n FROM session').get().n, 1);
  for (let n = 0; n < 7; n++) await service.reauthenticate(request(), 'wrong-password');
  assert.equal(await service.reauthenticate(request(), ownerInput.password), false);
});

test('API and MCP keys are high entropy, hash-only, audience-bound, scoped, and tracked', async t => {
  const { db, service } = await fixture(t);
  const owner = await service.createOwner(ownerInput);
  const api = await service.createKey(owner.id, keyInput());
  const mcp = await service.createKey(owner.id, keyInput({ audience: 'mcp', scopes: ['catalog:read', 'collection:claim'] }));
  assert.match(api.key, /^gthr_api_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  assert.match(mcp.key, /^gthr_mcp_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
  const persisted = JSON.stringify(db.prepare('SELECT * FROM gither_keys').all());
  assert.equal(persisted.includes(api.key), false);
  assert.equal(persisted.includes(api.key.split('.')[1]), false);
  assert.match(db.prepare('SELECT token_hash FROM gither_keys WHERE id = ?').get(api.id).token_hash, /^[a-f0-9]{64}$/);
  const principal = await service.verifyKey(bearer(api.key), 'api', ['pool:read']);
  assert.equal(principal.userId, owner.id);
  assert.equal(principal.keyId, api.id);
  assert.equal(await service.verifyKey(bearer(api.key), 'mcp', ['pool:read']), null);
  assert.equal(await service.verifyKey(bearer(mcp.key), 'api', ['catalog:read']), null);
  assert.equal(await service.verifyKey(bearer(api.key), 'api', ['pool:write']), null);
  assert.equal(await service.verifyKey(bearer(api.key), 'api', ['reviews:write']), null);
  assert.equal(await service.verifyKey(bearer(api.key), 'api', ['keys:write']), null);
  assert.equal(await service.verifyKey(bearer(api.key.slice(0, -1) + '!'), 'api', ['pool:read']), null);
  assert.equal(await service.verifyKey(new Request(origin + '/api/pool?api_key=' + api.key), 'api', []), null);
  assert.equal(await service.verifyKey(new Request(origin + '/api/pool', { headers: { 'x-api-key': api.key } }), 'api', []), null);
  const listed = await service.listKeys(owner.id);
  assert.equal(listed.length, 2);
  assert.ok(listed.find(row => row.id === api.id).lastUsedAt);
  assert.equal('key' in listed[0], false);
  assert.equal('token_hash' in listed[0], false);
  assert.ok(AUTH_SCOPES.includes('profile:read'));
  assert.ok(AUTH_SCOPES.includes('collection:claim'));
  assert.equal(AUTH_SCOPES.includes('profile:write'), false);
});

test('expired, revoked, unknown, or cross-owner keys cannot authorize or be managed', async t => {
  const { db, service } = await fixture(t);
  const owner = await service.createOwner(ownerInput);
  const revoked = await service.createKey(owner.id, keyInput());
  assert.equal(await service.revokeKey(owner.id, revoked.id), true);
  assert.equal(await service.verifyKey(bearer(revoked.key), 'api', ['pool:read']), null);
  assert.ok((await service.listKeys(owner.id))[0].revokedAt);
  const expired = await service.createKey(owner.id, keyInput());
  db.prepare('UPDATE gither_keys SET created_at = ?, expires_at = ? WHERE id = ?').run(Date.now() - 2000, Date.now() - 1000, expired.id);
  assert.equal(await service.verifyKey(bearer(expired.key), 'api', ['pool:read']), null);
  const member = addMember(db);
  await assert.rejects(service.createKey(member, keyInput()), /OWNER_SESSION_REQUIRED/);
  await assert.rejects(service.listKeys(member), /OWNER_SESSION_REQUIRED/);
  await assert.rejects(service.revokeKey(member, revoked.id), /OWNER_SESSION_REQUIRED/);
  const foreign = await service.createKey(owner.id, keyInput());
  db.prepare('UPDATE gither_keys SET user_id = ? WHERE id = ?').run(member, foreign.id);
  assert.equal(await service.revokeKey(owner.id, foreign.id), false);
  assert.equal((await service.listKeys(owner.id)).some(row => row.id === foreign.id), false);
  assert.equal(await service.verifyKey(bearer(foreign.key), 'api', []), null);
  assert.equal(await service.revokeKey(owner.id, randomBytes(16).toString('base64url')), false);
  assert.equal(await service.verifyKey(bearer(`gthr_api_${randomBytes(16).toString('base64url')}.${randomBytes(32).toString('base64url')}`), 'api', []), null);
});

test('key inputs enforce scopes, audience, expiry, name, and active-key limits', async t => {
  const { service } = await fixture(t);
  const owner = await service.createOwner(ownerInput);
  for (const patch of [
    { scopes: [] }, { scopes: ['pool:read', 'pool:read'] }, { scopes: ['reviews:write'] },
    { scopes: ['keys:write'] }, { audience: 'browser' }, { name: '' }, { name: 'a'.repeat(81) },
    { expiresAt: '' }, { expiresAt: 'invalid' }, { expiresAt: new Date(Date.now() - 1000).toISOString() },
    { expiresAt: new Date(Date.now() + 366 * 86400000).toISOString() },
  ]) await assert.rejects(service.createKey(owner.id, keyInput(patch)), /INVALID_KEY_INPUT/);
  const results = await Promise.allSettled(Array.from({ length: 21 }, () => service.createKey(owner.id, keyInput())));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 20);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /ACTIVE_KEY_LIMIT_REACHED/);
  const first = (await service.listKeys(owner.id))[0];
  await service.revokeKey(owner.id, first.id);
  assert.ok((await service.createKey(owner.id, keyInput())).key);
});
