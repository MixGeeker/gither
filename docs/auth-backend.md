> 2026-11-05: Login implementation is paused by user request. There is no account entry point in the shipped frontend. Existing code is retained only as an isolated extension scaffold; do not activate or provision without a new request.

# Authentication backend foundation

## Current state

The static preview is intentionally **not authenticated**. This repository contains a separate Cloudflare Worker using Better Auth 1.7.17 and native D1. No cloud resources, OAuth clients, secrets, deployments or accounts have been created. An unavailable backend is not a successful login. Local favorites remain local and do not sync to the account database.

`GET /api/auth/status` returns only availability flags:

```json
{"configured":false,"providers":{"google":false,"github":false},"emailPassword":false,"reason":"AUTH_UNCONFIGURED"}
```

This indicates configuration, not a successful provider or database connectivity check. Other auth calls return HTTP 503 while unconfigured. A static host without the Worker may return 404 or HTML; the UI must treat these as unavailable, never as success. Authentication responses must not be cached by the service worker, CDN, or browser.

## Architecture and security

- Frontend and Worker must share an origin. Route only `/api/auth/*` to this Worker, keeping static assets on the existing host. Do not enable wildcard CORS or use a third-party cookie workaround.
- Better Auth owns callback state, PKCE, provider token exchange and session creation. Never implement OAuth token exchange in browser code or store tokens in localStorage.
- Explicit fixed `BETTER_AUTH_URL` and exact trusted origin prevent host-header-derived redirects. Production requires HTTPS. Local HTTP is allowed only for localhost/127.0.0.1 with an explicit local flag.
- Sessions use HttpOnly, SameSite=Lax cookies, Secure on HTTPS. Cookie caching is disabled so session revocation reaches D1 immediately.
- OAuth tokens are encrypted at rest with the Better Auth secret. Protect database backups and use a randomly generated high-entropy secret of at least 32 characters. Secret rotation requires a separate migration plan, not simply replacing the secret and stranding existing encrypted tokens.
- Account linking is explicit, from an authenticated session only. Same-email provider logins do not silently merge accounts. The last account cannot be unlinked. A future account-settings UI must offer linking deliberately.
- Only identity/email scopes are requested: Google `openid email profile`, GitHub `read:user user:email`. No repository, organization, Drive, contacts, or mail access is required.
- Database-backed rate limiting and verification records are used, not process-local storage or eventually consistent KV.
- Email/password is disabled. OAuth first login may create an account; this is the implemented registration mechanism. Do not turn password registration on until verified transactional-email delivery, required verification, password-reset delivery, abuse controls and end-to-end tests are implemented. Never silently bypass email verification.

## Activation checklist (requires owner approval and resources)

1. Choose the final HTTPS frontend origin and ensure it can route `/api/auth/*` to this Worker. The existing static preview is not automatically an OAuth deployment.
2. Provision a D1 database and add its actual binding as `DB` to `wrangler.auth.jsonc`, with `migrations_dir: "migrations"`. Apply reviewed migration `0001_auth.sql` to the intended database. Do not confuse local and remote D1.
3. Create a Google OAuth **Web application** in Google Cloud, configure branding/audience/test users as appropriate, and register the exact callback `https://YOUR_ORIGIN/api/auth/callback/google`. Register a separate development callback/client as needed. Configure authorized JavaScript origin to the frontend origin if the console asks.
4. Create a GitHub OAuth App with homepage `https://YOUR_ORIGIN` and callback `https://YOUR_ORIGIN/api/auth/callback/github`. A distinct development app avoids GitHub's single-callback limitation. If choosing a GitHub App instead, grant only Email addresses: read-only and verify compatible callback/token behavior.
5. Set `BETTER_AUTH_URL` to the origin only (no path), store `BETTER_AUTH_SECRET` and provider client secrets as Worker secrets, set provider client IDs, and set `AUTH_ENABLED=true` only after completing the checks. Never prefix secrets with `VITE_`, commit `.dev.vars`, or paste secrets into a chat.
6. Register the approved same-origin route. Verify missing configuration, invalid state, denied consent, private GitHub email, callback mismatch, replayed callback, cross-origin POST, rate limiting, login/logout/revocation, explicit linking and signup behavior in a staging deployment before enabling real users.

Provider credentials may be configured independently; a provider stays unavailable unless both ID and secret exist. All four global prerequisites (enable flag, valid origin, database binding, sufficiently long secret) are mandatory.

## Local validation

Dependencies are pinned by the root package manifest. Use Node 24 and TypeScript 7. `wrangler.auth.jsonc` is intentionally non-deployable by default: no route or database ID is supplied. A bundle dry-run must not publish anything. Do not run `wrangler deploy` without `--dry-run` under the current authorization.

A developer may copy `.dev.vars.example` to ignored `.dev.vars` and fill it locally. Do not generate or provision credentials as part of tests. For local D1 testing, use a separate local-only Wrangler configuration with a local D1 binding and run migrations with `--local`, never `--remote`.

## Official references

- Native D1 support: https://better-auth.com/blog/1-5
- Options and security configuration: https://better-auth.com/docs/reference/options
- Schema and migration support: https://better-auth.com/docs/concepts/database
- Explicit account linking: https://better-auth.com/docs/concepts/users-accounts
- Google integration: https://better-auth.com/docs/authentication/google
- GitHub integration: https://better-auth.com/docs/authentication/github

### Verified checks

- `npx tsc -p tsconfig.worker.json`: strict TypeScript 7, including unchecked indexed access and exact optional properties. `skipLibCheck` skips upstream declaration checking, not application code.
- `npx tsc -p tsconfig.worker.json --noEmit false --outDir .auth-dist && node --test tests/auth-*.test.mjs`: configuration, no-secret status, origin/scope guards, actual Better Auth redirect/state/PKCE cookies, absent session, disabled password registration, migration schema alignment.
- `WRANGLER_SEND_METRICS=false XDG_CONFIG_HOME=/tmp/gither-wrangler npx wrangler deploy --config wrangler.auth.jsonc --dry-run --outdir .auth-dist/bundle`: Worker bundling only; does not deploy.

The SQL was generated with installed Better Auth's `getMigrations(authOptions).compileMigrations()` against an empty local SQLite database, then applied to an in-memory database and checked again for no pending changes. A small schema plugin declares a unique `(providerId, accountId)` index so concurrent logins cannot duplicate an external identity. No password-signup or provider token-exchange test uses real accounts or credentials. Full provider consent/callback/token exchange and production D1 are still unverified until resources are supplied.

- `npm run auth:build && node scripts/auth-d1-smoke.mjs`: verified the actual local workerd runtime and D1 binding, applied the migration, checked status and null session, initiated both providers with PKCE and HttpOnly cookies, and confirmed two OAuth state records persisted in D1. It uses Wrangler's installed Miniflare test runtime, not production D1. Full OAuth consent/token exchange is deliberately not simulated as a successful login.
