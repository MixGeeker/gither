import test from 'node:test';
import assert from 'node:assert/strict';
import { authConfiguration, publicAuthStatus } from '../.auth-dist/config.js';

const configured = {
  AUTH_ENABLED: 'true', DB: {}, BETTER_AUTH_URL: 'https://gither.example',
  BETTER_AUTH_SECRET: 'test-only-not-a-real-secret-at-least-32-characters',
  GOOGLE_CLIENT_ID: 'test-id', GOOGLE_CLIENT_SECRET: 'test-secret',
};

test('auth fails closed without any required configuration', () => {
  assert.deepEqual(publicAuthStatus({}), {
    configured: false, providers: { google: false, github: false }, emailPassword: false, reason: 'AUTH_UNCONFIGURED',
  });
  for (const key of ['AUTH_ENABLED', 'DB', 'BETTER_AUTH_URL', 'BETTER_AUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) {
    const env = { ...configured };
    delete env[key];
    assert.equal(authConfiguration(env).configured, false, key);
  }
});

test('provider availability is independent; public status never leaks configuration', () => {
  assert.deepEqual(publicAuthStatus(configured), {
    configured: true, providers: { google: true, github: false }, emailPassword: false,
  });
  assert.equal(JSON.stringify(publicAuthStatus(configured)).includes('test-'), false);
  assert.deepEqual(publicAuthStatus({ ...configured, GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 'secret' }).providers, { google: true, github: true });
});

test('only exact HTTPS origin or explicitly permitted loopback is accepted', () => {
  for (const url of ['http://gither.example', 'https://gither.example/path', 'https://gither.example?x=1', 'https://gither.example/#fragment', 'https://user:pass@gither.example', 'garbage']) {
    assert.equal(authConfiguration({ ...configured, BETTER_AUTH_URL: url }).configured, false, url);
  }
  assert.equal(authConfiguration({ ...configured, BETTER_AUTH_URL: 'http://localhost:8787' }).configured, false);
  assert.equal(authConfiguration({ ...configured, BETTER_AUTH_URL: 'http://localhost:8787', AUTH_ALLOW_LOCALHOST: 'true' }).configured, true);
  assert.equal(authConfiguration({ ...configured, BETTER_AUTH_URL: 'http://localhost.attacker.example', AUTH_ALLOW_LOCALHOST: 'true' }).configured, false);
});

test('weak/empty values and disabled flag cannot activate login', () => {
  for (const patch of [{ AUTH_ENABLED: 'false' }, { BETTER_AUTH_SECRET: 'short' }, { GOOGLE_CLIENT_ID: '  ' }, { GOOGLE_CLIENT_SECRET: '' }]) {
    assert.equal(authConfiguration({ ...configured, ...patch }).configured, false);
  }
});
