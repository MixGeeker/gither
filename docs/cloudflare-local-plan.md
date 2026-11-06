# Cloudflare reviewed-catalog prototype

This is a local-only review copy based on Gither commit 507ceb7 plus the three project-card examples. No cloud resources, credentials, account access, GitHub commits, DNS changes, or deployment have been made. Existing public repository and private Sites preview are unchanged.

## Smallest complete path

1. Workers serves the Vite static build and same-origin `/api/*` plus `/mcp`.
2. D1 stores candidates, exact revisions, collection run aggregates, append-only review audit and immutable published snapshots.
3. Three source-backed examples (DS-Bot-App, deepseek-harness, Ombre-Brain) seed as `pending_review`. They are not automatically published.
4. A collector can refresh only metadata for those three fixed public repositories. It cannot read arbitrary URLs, execute README instructions, run model inference, publish cards or write human feedback. Content descriptions remain manually sourced use-case examples.
5. A separately authorized reviewer accepts/rejects an exact pending revision. A refresh cannot silently overwrite the last approved snapshot.
6. Public API and MCP read only the reviewed projection. `?catalog=1` loads this API in the actual React UI; empty/error states do not masquerade as live results using sample fallbacks.

This is not broad automatic discovery yet. Source discovery, README-to-card generation, moderation UI and durable job queues remain future work.

## Default safety state

`COLLECTION_ENABLED=false`, no Cron expressions, no admin authorization binding, no real D1 ID, no routes or workers.dev publication. Login, server-side favorites and human feedback remain disabled. The included all-zero D1 ID is a local placeholder, not a cloud resource.

Admin POSTs require exact configured Origin and a trusted authorization service binding (`ADMIN_AUTH`) which must independently verify the caller and return a principal with the requested role. Caller-supplied `x-role`, user IDs or body claims have no authority. This service is NOT implemented or connected. Deployment must not enable writes until a reviewed Access/JWT/session solution is configured. Local tests inject ephemeral synthetic authorization; there is no production test-mode flag or public test backdoor.

The collector role can seed/collect. The reviewer role can inspect candidates and review. Neither role can submit human user feedback. No route writes `human_feedback`; that table remains empty. Agent/test activity belongs to collection/test evidence, not user ratings, saves, clicks or preferences.

## API contract

- `GET /api/health`: sanitized readiness and feature flags.
- `GET /api/projects?q=&limit=` and `/api/projects/:id`: published snapshots only.
- `GET /api/admin/candidates`: reviewer only.
- `POST /api/admin/seed` and `/api/admin/collect`: collector only; collection requires the explicit enable flag.
- `POST /api/admin/review`: reviewer only, `{id, revision, decision, note}`; stale/double review returns 409.
- `/api/feedback`, `/api/favorites`, `/api/auth/*`: explicitly unavailable until verified user sessions are implemented.

No CORS wildcard, no SQL concatenation from user values, bounded JSON/body/queries, fixed upstream allowlist, request deadlines, redirect rejection, safe errors and provenance are enforced. The current API is capped at 50 projects because it is a three-source prototype, not a production feed.

## MCP compatibility and self-test

The endpoint intentionally targets legacy MCP **2025-11-25**, tools-only JSON Streamable HTTP. It implements `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`; no sessions, streaming, subscriptions, resources, prompts or side-effect tools. POST requires JSON and Accept for JSON + SSE; subsequent requests require `MCP-Protocol-Version: 2025-11-25`. GET/DELETE return 405. Origin is validated when supplied. No authentication metadata sent by a client is treated as authorization.

Tools: `search_projects`, `get_project`, `collection_status`. All are actually read-only and return published data or sanitized aggregate state. The collector cannot create a fake “human liked this” event through MCP.

This is not claimed to support the current MCP 2026-07-28 revision. Before production/client integration, adopt the current official SDK or explicitly test the intended client against this pinned compatibility target. Local tests are genuine JSON-RPC HTTP roundtrips through workerd, not proof of a ChatGPT/other MCP client connection.

Sources: https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle and https://modelcontextprotocol.io/specification/2025-11-25/basic/transports . Current-version differences: https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning . Cloudflare SDK option: https://developers.cloudflare.com/agents/model-context-protocol/apis/handler-api/ .

## Local validation

- `npm run check` and `npm test`: frontend, state, source fixtures and decoder.
- `npm run catalog:check`: strict TypeScript 7 Worker validation.
- `npm run catalog:smoke`: production frontend build, Wrangler `--dry-run`, then ephemeral local workerd + D1 API/MCP tests. Synthetic GitHub and auth bindings never contact providers; database is disposed afterward.

No `wrangler deploy` without `--dry-run`, `d1 create`, remote migration, secret write or OAuth registration is part of this workflow.

## Decisions before cloud deployment

Confirm the target Cloudflare account/zone/domain, intended audience and cost limits. Authorize creating the named Worker and D1, applying migrations and configuring the needed bindings. Choose verified admin authorization (for example Cloudflare Access), review/publish ownership, approved source scope and collection cadence. Credentials or persistent access need their own secure authorization path. Human login and feedback remain separately paused unless the user explicitly resumes them.

The current static private Sites preview belongs to a separate hosting flow; it is not evidence of access to the user's Cloudflare account.
