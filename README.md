# Gither

Phone-first GitHub project discovery: swipe to save or dismiss, read concrete capabilities/use cases, and control a personal discovery pool. React 19.3.1 + TypeScript **7.0.2** + Vite 8.3.6; production self-hosted backend uses Node 24, SQLite and Better Auth 1.7.17. Versions are pinned.

## Self-host with Docker

```sh
./scripts/deploy.sh
```

This user-run command builds the image, securely prompts for the first owner's password locally, then starts the app at `http://127.0.0.1:3000`. Docker Engine + Compose and an interactive terminal are required. No default password, real user, or API/MCP key is created automatically. Subsequent runs preserve the existing owner. Public HTTPS requires your domain/DNS and `./scripts/deploy.sh --https` after configuring `.env`.

**Validation boundary:** the development cloud computer has no Docker/Podman/BuildKit engine. Docker configuration is source-reviewed, but the image has not been built or run there. The production Node runtime, authentication, HTTP, pool and MCP flows have separate local tests. See [deployment, backup and recovery](docs/docker-selfhost.md).

## What is implemented

- GitHub Primer light/dark/dimmed colors, M3-inspired components, black Polaroid repository frame, accessible swipe/buttons/keyboard and undo. Latest sample cards use direct capability descriptions and concrete scenarios, not slogans or nested illustrations.
- Single-owner password login and server-backed favorites/decisions. Closed registration; Google/GitHub social login remains disabled. HttpOnly sessions, exact-origin checks, password throttling, local recovery and session/key revocation.
- Separate API and MCP key audiences, explicit scopes, expiry, hash-only storage, one-time display and password reauthentication for key management.
- Human-configured pool threshold and candidate batch target. Defaults: below **30 available undecided projects** queues one collection job for **60 candidate assessments**. This is not a 30-project capacity limit or a guarantee of 60 approved projects.
- External-Agent job claims, leases, heartbeat, idempotent submissions, canonical repository deduplication across tasks, bounded failure/backoff, and human retry. Pending candidates are not admitted automatically; human review publishes immutable snapshots.
- Versioned human topics, sources, exclusions and flavor percentages, including exploration. Jobs freeze rules/profile/feedback and integer allocation guidance. Explicit human preferences outrank aggregate feedback. One dismissal does not ban a topic; undo removes its contribution.
- Authenticated MCP onboarding resource/prompt, schema-defined tools and scoped writes. Agents can submit candidates and propose plans/subscriptions, but cannot publish, change human rules, forge likes or administer accounts.

The app **queues** collection tasks. It does not deploy or schedule the external Agent, execute third-party repository code, or pretend a queued task has already run. The three sample projects are sourced editorial examples, not measured third-party outputs or real user feedback.

## MCP

Use `/mcp` with an MCP-audience Bearer key configured securely in the client. Discover `gither://onboarding`, `gither_collector_onboarding`, and `tools/list` before working. The implemented compatibility target is explicitly **MCP 2025-11-25**, JSON Streamable HTTP; no claim of latest-protocol or universal client compatibility is made. See [collector workflow and scopes](docs/mcp-collector.md).

Machine REST endpoints are under `/api/v1/*` and require an API-audience key. Human settings, review, decisions and key management are session-only `/api/me/*`. No credential belongs in a URL, repository, prompt, browser localStorage or application log.

## Development and tests

```sh
npm ci
npm run check
npm run server:check
npm test
npm run selfhost:build
```

`npm run dev` serves the static design demo. `npm run build` produces that demo only, without account protection or private backend data. **Do not deploy the static demo as if it were the authenticated application.** Docker runs `selfhost:build`, whose frontend fails closed when its API is unavailable.

For isolated browser QA, `scripts/preview-selfhost.mjs` runs the real application against a disposable in-memory database with a clearly synthetic account. It is not copied into the Docker runtime image and refuses production mode. It is not a production authentication shortcut.

## Cloudflare path

Docker is the self-hosted Node/SQLite path. It does not run on Workers. The `cloudflare/` directory retains a separate, disabled local Workers/D1 prototype with three-source metadata collection and review snapshots. It has no configured cloud database, routes, credentials or production deployment; its legacy MCP is not the new authenticated Docker MCP. [Cloudflare prototype boundaries](docs/cloudflare-local-plan.md).

Future Cloudflare deployment requires porting the new auth/pool domain behind Workers/D1 adapters and running those adapter tests. No automatic equivalence or database migration is claimed. The previous private Sites preview is a separate hosting flow and has not been updated by these local changes.

## Data and remaining boundaries

- First release is one owner per installation, not public multi-user registration or SMTP password recovery. Database queries and keys are owner-isolated and tested; local recovery revokes old sessions/keys.
- Candidate claims/evidence are untrusted until human review. Unknown metrics remain unknown. Weak similarity does not merge repositories; exact canonical GitHub identity drives deduplication.
- Flavor allocations guide the external collector; the server does not claim to verify how it searched. Feedback suggestions are transparent aggregates, not hidden rewrites of user preferences.
- Third-party OAuth, live external-Agent scheduling, broad automatic source collection, third-party Agent app integration, Docker image execution and public TLS remain separately verifiable deployment work.
- Do not commit `.env`, `.dev.vars`, `/data`, database/WAL files, backups, secrets or generated keys. Back up before upgrades, and perform local recovery after restoring an old database before exposing it.

## Verified MCP client

The official TypeScript MCP SDK 1.32.2 completed 23 real loopback HTTP requests with protocol 2025-11-25, including onboarding, scoped collection and credential failure paths. See [the reproducible report](docs/mcp-sdk-verification.md). This is a client/server interoperability check, not a live external Agent or scheduled collection deployment.
