# Docker self-hosting

This is a **single-owner self-hosted release**, not public signup and not Cloudflare Workers deployed inside Docker. Google/GitHub login remains disabled. The separate `cloudflare/` tree is a local reviewed-catalog prototype, not this authenticated production runtime.

## Start

Requirements: Docker Engine + Compose, a local persistent disk, and an interactive terminal. The Docker image has **not yet been built/run in this development environment**, because no container engine is available. Node production runtime and application tests are independently checked; do not confuse them with a Docker smoke test.

From the checked-out repository:

```sh
./scripts/deploy.sh
```

The script builds the image, asks locally for the first owner's email/name/password (password hidden), and starts Compose. The app binds only `127.0.0.1:3000`. Open `http://127.0.0.1:3000`. There is no default password, no public first-owner registration race, and no API/MCP key is automatically generated. On later runs the existing owner is preserved. Email is a login identifier, not a claim that the inbox was verified.

Equivalent explicit commands:

```sh
docker compose build app
docker compose run --rm -it app setup
docker compose up -d
```

Without setup the server exposes only health and setup status, not project/account APIs. The application never creates a real owner or API key merely by starting. Startup migrations create schema only. A user-initiated local setup creates a random session secret in the restricted data volume and the owner's hashed password.

## Public HTTPS

Provide your own server/domain and DNS first. Copy `.env.example` to `.env`, set `APP_ORIGIN=https://your-domain.example` and `SITE_HOST=your-domain.example`, then run:

```sh
./scripts/deploy.sh --https
```

This optional Caddy service requests a TLS certificate for that domain and publishes ports 80/443. Only run it after you intend that public deployment. The application remains private behind login; owner APIs require a cookie session and machine APIs require audience-bound scoped keys. HTTP production origins are rejected; HTTP is allowed only for explicit loopback development.

No Cloudflare resource, DNS entry, OAuth app, external account or credential is created by this repository. Do not configure broad wildcard origins or expose the SQLite directory. Docker mode supports one application replica on local storage, not multiple replicas sharing SQLite over NFS.

## Accounts and keys

- Passwords use Better Auth hashing. Sessions are HttpOnly, SameSite cookies; HTTPS adds Secure. Password login has account/global and library rate limits. Forwarded client-IP headers are not trusted.
- Only the owner may use the browser account interface. Public signup, email reset, social login, email/role changes and account-linking endpoints are deliberately disabled.
- Create separate keys for API and MCP clients. Both have owner-bound scopes, mandatory expiry, hash-only storage and immediate revocation. Raw keys are shown once, in memory, and must be stored in the intended client's secure configuration. Never paste keys into repository content, query URLs, prompts or logs.
- Creating/revoking keys requires the owner's password again. Keys cannot manage accounts, create keys, change human rules/profile, publish candidates or forge human feedback.
- Private favorites and dismissals are server-backed. They are not uploaded from the old demo's localStorage without an explicit import feature; there is currently no automatic import.

## Pool semantics

Defaults are a **refill threshold of 30 available undecided projects**, and **60 candidate assessments per collection job**. Below 30 queues one job; 60 is not an available-pool cap and not a promise of 60 admissions. Saved/dismissed/unavailable projects do not count. Submissions remain pending until human review. The queue waits for an external authorized Agent to claim it; this app does not automatically run that Agent or schedule its external execution.

Exact normalized GitHub repositories deduplicate per owner across tasks and past decisions. Distinct repositories are never merged merely because their names or topics look similar. Evidence and generated claims remain untrusted and require review.

Human profile topics, sources, exclusions and flavor percentages are versioned. Ratios total 100 and preserve a positive exploration allocation. Jobs freeze their configuration; edits apply to later jobs. Single dismissals do not ban topics, and undo removes the corresponding signal.

## Backup and recovery

SQLite uses WAL, foreign keys, bounded locks and transactional writes. Back up with SQLite's consistent backup operation, not a casual copy of the live WAL database:

```sh
docker compose run --rm app backup
```

Backups are under `/data/backups/` and contain `gither.db` plus the session secret. They are **private credential-bearing backups**, not artifacts to publish or upload without authorization. Keep an off-host encrypted copy through your own approved backup system. This project does not configure a remote backup destination.

For forgotten passwords, stop the app, then run the local recovery command. It resets the owner password and revokes every existing session and API/MCP key:

```sh
docker compose stop app
docker compose run --rm -it app reset-owner
docker compose up -d app
```

To restore, stop the app, restore both matching backup files into the private data volume with owner permissions, and run `reset-owner` **before** exposing the restored app. Old backups may contain previously revoked tokens; recovery revokes them again. Never replace the auth secret casually while keeping the database. Take a tested backup before upgrading; auth schema incompatibilities fail closed.

## Verification commands

```sh
npm ci
npm run check
npm run server:check
npm test
npm run selfhost:build
```

Tests use isolated temporary/in-memory credentials only. They do not sign into providers, provision a deployment, execute third-party projects, or simulate fabricated human usage.
