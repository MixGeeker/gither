/**
 * Optional interoperability check with the official TypeScript MCP client.
 * Install the exact SDK separately, then run:
 * npm --prefix /tmp/gither-mcp-sdk-interop --cache /tmp/gither-mcp-sdk-cache install --ignore-scripts --no-audit --no-fund --save-exact @modelcontextprotocol/sdk@1.32.2
 * npm run server:build
 * MCP_SDK_DIR=/tmp/gither-mcp-sdk-interop/node_modules/@modelcontextprotocol/sdk node scripts/verify-mcp-sdk.mjs
 * No permanent user accounts, credentials or repository/network collection are created.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createApplication } from '../.server-dist/app.js';
import { createHttpServer } from '../.server-dist/http-server.js';
import { MCP_PROTOCOL_VERSION } from '../.server-dist/mcp.js';

const EXPECTED_SDK_VERSION = '1.32.2';
const sdkDir = process.env.MCP_SDK_DIR;
assert.ok(sdkDir, 'Set MCP_SDK_DIR to the separately installed official SDK package directory.');
const sdkRoot = resolve(sdkDir);
const sdkPackage = JSON.parse(await readFile(join(sdkRoot, 'package.json'), 'utf8'));
assert.equal(sdkPackage.name, '@modelcontextprotocol/sdk');
assert.equal(sdkPackage.version, EXPECTED_SDK_VERSION, 'This reproducible check pins the SDK version.');
const { Client } = await import(pathToFileURL(join(sdkRoot, 'dist/esm/client/index.js')).href);
const { StreamableHTTPClientTransport } = await import(pathToFileURL(join(sdkRoot, 'dist/esm/client/streamableHttp.js')).href);
const sdkTypes = await import(pathToFileURL(join(sdkRoot, 'dist/esm/types.js')).href);
assert.ok(sdkTypes.SUPPORTED_PROTOCOL_VERSIONS.includes(MCP_PROTOCOL_VERSION));

// Reserve an OS-selected loopback port before creating the exact-origin HTTP app.
// The bridge still enforces its real Host header; no custom fetch or Host override is used.
const reservation = createServer();
await new Promise((done, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', done); });
const port = reservation.address().port;
await new Promise(done => reservation.close(done));
const origin = `http://127.0.0.1:${port}`;
const db = new DatabaseSync(':memory:');
const app = await createApplication({ db, origin, allowLocalhost: true, secret: randomBytes(48).toString('base64url') });
const owner = await app.auth.createOwner({ email: 'sdk-fixture@example.test', name: 'Temporary SDK fixture', password: randomBytes(36).toString('base64url') });
app.pool.setRules(owner.id, { refillThreshold: 1, batchTarget: 2 });
const keyInput = (audience, scopes) => ({ name: 'Ephemeral SDK verification', audience, scopes, expiresAt: new Date(Date.now() + 60_000).toISOString() });
const fullKey = await app.auth.createKey(owner.id, keyInput('mcp', ['pool:read', 'profile:read', 'catalog:read', 'candidates:read', 'collection:claim', 'candidates:write']));
const limitedKey = await app.auth.createKey(owner.id, keyInput('mcp', ['pool:read']));
const apiKey = await app.auth.createKey(owner.id, keyInput('api', ['pool:read']));
const wire = [];
const bridge = createHttpServer({ origin, assetsDir: fileURLToPath(new URL('../dist', import.meta.url)), handler: async request => {
  let rpcMethod = null;
  if (request.method === 'POST' && new URL(request.url).pathname === '/mcp') {
    try { rpcMethod = (await request.clone().json()).method ?? null; } catch { /* The handler rejects malformed input. */ }
  }
  const response = await app.handler(request);
  // Record protocol observations only, never credentials, claim tokens or request bodies.
  wire.push({ httpMethod: request.method, rpcMethod, protocol: request.headers.get('mcp-protocol-version'), status: response.status });
  return response;
} });
const openClients = new Set();
const unexpectedErrors = [];
function makeClient(token) {
  const client = new Client({ name: 'gither-official-sdk-verification', version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL('/mcp', origin), {
    requestInit: { headers: token === undefined ? {} : { Authorization: `Bearer ${token}` } },
    reconnectionOptions: { maxRetries: 0 },
  });
  client.onerror = error => { if (error?.code !== 401) unexpectedErrors.push(error?.name ?? 'Unknown error'); };
  openClients.add(client);
  return { client, transport };
}
async function connect(token) {
  const connection = makeClient(token);
  await connection.client.connect(connection.transport, { timeout: 10_000 });
  assert.equal(connection.transport.protocolVersion, MCP_PROTOCOL_VERSION);
  return connection;
}
const checks = [];
try {
  await new Promise((done, reject) => { bridge.once('error', reject); bridge.listen(port, '127.0.0.1', done); });
  const main = await connect(fullKey.key);
  assert.equal(main.client.getServerVersion().name, 'gither-authenticated-collector');
  assert.ok(main.client.getServerCapabilities().resources);
  assert.ok(main.client.getServerCapabilities().prompts);
  checks.push('SDK initialize / initialized notification / negotiated protocol');

  const tools = (await main.client.listTools()).tools;
  assert.ok(tools.some(tool => tool.name === 'submit_candidates'));
  assert.equal(tools.find(tool => tool.name === 'submit_candidates').inputSchema.properties.candidates.maxItems, 60);
  assert.ok(!tools.some(tool => /save_decision|review_candidate|set_profile|set_rules/.test(tool.name)));
  checks.push('SDK listTools with schema validation and no human-authority tools');

  const resources = (await main.client.listResources()).resources;
  assert.ok(resources.some(resource => resource.uri === 'gither://onboarding'));
  const resource = await main.client.readResource({ uri: 'gither://onboarding' });
  assert.match(resource.contents[0].text, /UNTRUSTED DATA/);
  assert.deepEqual((await main.client.listResourceTemplates()).resourceTemplates, []);
  checks.push('SDK listResources / readResource / listResourceTemplates');

  const prompts = (await main.client.listPrompts()).prompts;
  assert.ok(prompts.some(prompt => prompt.name === 'gither_collector_onboarding'));
  const prompt = await main.client.getPrompt({ name: 'gither_collector_onboarding' });
  assert.equal(prompt.messages[0].content.text, resource.contents[0].text);
  checks.push('SDK listPrompts / getPrompt');

  const status = await main.client.callTool({ name: 'pool_status', arguments: {} });
  assert.equal(status.isError, false);
  assert.equal(status.structuredContent.activeJob.batchTarget, 2);
  assert.equal(status.structuredContent.availableCount, 0);
  const claim = (await main.client.callTool({ name: 'claim_collection_job', arguments: { idempotencyKey: 'sdk-fixture-claim' } })).structuredContent.claim;
  assert.ok(claim.claimToken);
  const bound = { jobId: claim.job.id, claimToken: claim.claimToken };
  const candidate = i => ({ repositoryUrl: `https://github.com/example/sdk-fixture-${i}`, title: `SDK fixture ${i}`, purpose: 'A synthetic interoperability test', description: 'A local test record, not a researched project.', capabilities: ['Exercises candidate serialization', 'Exercises pending human review'], useCase: 'Verify the MCP request and response contract using in-memory synthetic records.', tags: ['fixture'], evidence: [{ url: `https://github.com/example/sdk-fixture-${i}#readme`, claim: 'Synthetic test evidence; not fetched or verified.' }] });
  const submission = { ...bound, idempotencyKey: 'sdk-fixture-submission', candidates: [candidate(1), candidate(2)] };
  const submitted = await main.client.callTool({ name: 'submit_candidates', arguments: submission });
  assert.equal(submitted.isError, false);
  assert.equal(submitted.structuredContent.assessedCount, 2);
  assert.deepEqual((await main.client.callTool({ name: 'submit_candidates', arguments: submission })).structuredContent, submitted.structuredContent);
  const finished = await main.client.callTool({ name: 'finish_collection_job', arguments: { ...bound, outcome: 'completed', summary: 'Two synthetic test candidates submitted; no external research performed.' } });
  assert.equal(finished.isError, false);
  assert.equal(finished.structuredContent.status, 'completed');
  assert.equal(app.pool.getStatus(owner.id).availableCount, 0);
  assert.equal(app.pool.getStatus(owner.id).pendingCount, 2);
  checks.push('SDK callTool: status → claim → idempotent submission → completed collection, still pending human review');

  const limited = await connect(limitedKey.key);
  const denied = await limited.client.callTool({ name: 'discovery_profile', arguments: {} });
  assert.equal(denied.isError, true);
  assert.equal(JSON.parse(denied.content[0].text).code, 'INSUFFICIENT_SCOPE');
  const limitedStatus = await limited.client.callTool({ name: 'pool_status', arguments: {} });
  assert.equal(limitedStatus.isError, false);
  checks.push('Valid MCP key with wrong scope receives a structured tool error');

  for (const [label, token] of [['missing', undefined], ['wrong audience', apiKey.key], ['invalid', 'invalid-fixture-only-key']]) {
    const unauthorized = makeClient(token);
    await assert.rejects(unauthorized.client.connect(unauthorized.transport, { timeout: 10_000 }), error => error?.code === 401, label);
    await unauthorized.client.close();
    openClients.delete(unauthorized.client);
  }
  checks.push('Missing / invalid / API-audience credentials fail SDK initialization with HTTP 401');
  await app.auth.revokeKey(owner.id, fullKey.id);
  await assert.rejects(main.client.ping(), error => error?.code === 401);
  checks.push('Revoked MCP key fails subsequent SDK requests with HTTP 401');

  assert.ok(wire.some(event => event.rpcMethod === 'notifications/initialized' && event.status === 202));
  assert.ok(wire.some(event => event.httpMethod === 'GET' && event.status === 405), 'SDK optional GET stream is explicitly unsupported and handled.');
  assert.ok(wire.filter(event => event.rpcMethod && event.rpcMethod !== 'initialize' && event.status < 400).every(event => event.protocol === MCP_PROTOCOL_VERSION));
  assert.deepEqual(unexpectedErrors, []);
  checks.push('Real Node HTTP bridge: SDK protocol header, accepted initialized notification and tolerated GET 405');

  console.log(JSON.stringify({ status: 'passed', sdk: `${sdkPackage.name}@${sdkPackage.version}`, protocol: main.transport.protocolVersion, node: process.version, transport: 'official StreamableHTTPClientTransport over loopback HTTP', database: 'in-memory only', credentials: 'ephemeral, never logged or persisted', checks, httpRequests: wire.length, limitation: 'This verifies the official SDK client, not third-party agent applications or external collector execution.' }, null, 2));
} finally {
  for (const client of openClients) await client.close().catch(() => {});
  bridge.closeAllConnections();
  await new Promise(done => bridge.close(done));
  db.close();
}
