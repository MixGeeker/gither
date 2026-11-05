// Local-only smoke test against Wrangler's installed workerd/Miniflare runtime.
// Run `npm run auth:build` first. No network provider calls or cloud resources.
import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { readFileSync } from 'node:fs';

// Wrangler 4.158.0 bundles Miniflare 5 beta; use its supported legacy converter.
const mf = new Miniflare(convertV4MiniflareOptions({
  name: 'gither-auth', modules: true, scriptPath: '.auth-dist/bundle/index.js',
  compatibilityDate: '2026-11-05', compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'], bindings: {
    AUTH_ENABLED: 'true', BETTER_AUTH_URL: 'https://gither.example',
    BETTER_AUTH_SECRET: 'test-only-not-a-real-secret-at-least-32-characters',
    GOOGLE_CLIENT_ID: 'test-google-id', GOOGLE_CLIENT_SECRET: 'test-google-secret',
    GITHUB_CLIENT_ID: 'test-github-id', GITHUB_CLIENT_SECRET: 'test-github-secret',
  },
}));
try {
  const db = await mf.getD1Database('DB');
  await db.exec(readFileSync('migrations/0001_auth.sql', 'utf8').replace(/^--.*$/gm, '').replace(/\n/g, ' '));
  const status = await mf.dispatchFetch('https://gither.example/api/auth/status');
  assert.equal(status.status, 200);
  assert.equal((await status.json()).configured, true);
  const session = await mf.dispatchFetch('https://gither.example/api/auth/get-session');
  assert.equal(session.status, 200);
  assert.equal(await session.json(), null);
  for (const provider of ['google', 'github']) {
    const login = await mf.dispatchFetch('https://gither.example/api/auth/sign-in/social', {
      method: 'POST', headers: { origin: 'https://gither.example', 'Content-Type': 'application/json', 'cf-connecting-ip': '192.0.2.1' },
      body: JSON.stringify({ provider, callbackURL: '/' }),
    });
    assert.equal(login.status, 200);
    const body = await login.json();
    assert.equal(new URL(body.url).searchParams.get('code_challenge_method'), 'S256');
    assert.match(login.headers.get('set-cookie'), /HttpOnly/i);
  }
  const stateRows = await db.prepare('SELECT count(*) as count FROM verification').first();
  assert.equal(stateRows.count, 2);
  console.log('Local workerd + D1: migrated schema, status, absent session, Google/GitHub PKCE initiation, persisted state passed.');
} finally { await mf.dispose(); }
