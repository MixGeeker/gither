# Authenticated pool and MCP collection contract

## Human authority and availability

The owner configures `refillThreshold` (default 30) and `batchTarget` (default 60). Availability counts published, currently available snapshots for that user, excluding their saved and dismissed decisions. Pending candidates, rejected candidates, unpublished snapshots and other users' projects do not count. There is no 30-project catalog cap.

A low-pool check queues at most one queued, leased or backoff job for the owner. That job asks an external collector to assess the frozen candidate target. It does not ask for that many approvals or enough admissions to fill the threshold. Each submission accepts at most 60 distinct canonical repositories; the total target can differ from 60 when the human changes it. Distinct repositories already known to the owner are reported as duplicates and count as assessed candidates for that job, without creating or republishing records. Repeating the same repository in the same job does not consume another slot.

Only authenticated owner-session endpoints can change rules, profile, subscriptions, review candidates, publish/unpublish snapshots, save/dismiss or undo. An agent may propose subscriptions or collection plans in a separate proposal store. It cannot apply them. Proposal storage is capped at 100 records per owner. Further proposals return `PROPOSAL_LIMIT_REACHED` until the human clears reviewed proposals through a session-only operation; no MCP deletion tool exists.

## Profile, allocation and feedback

Human profile fields are versioned: topics, source preferences, explicit excluded topics, and flavor labels/weights. Integer weights must total 100, with a positive `exploration` weight. Each job freezes rules, profile, subscriptions and aggregate feedback at creation. A later human edit affects subsequent jobs, never the in-flight snapshot.

`flavorTargets` converts percentages into integer candidate targets with largest-remainder rounding. A nonempty batch reserves at least one exploration candidate, moving one slot from the largest non-exploration bucket if rounding would eliminate it. These are instructions for the external collector, not server verification of research quality or flavor compliance.

Feedback uses actual human decisions. Per-tag scores are `2 × saved − 0.5 × dismissed`. Fewer than three distinct decisions cannot produce a suggestion. Repeated saves or dismissals can produce explainable advisory suggestions, never automatic profile changes or topic bans. Explicit exclusions override suggestions. Undo removes its contribution from live aggregation; previously queued jobs retain their frozen aggregate.

## Lease and review lifecycle

Claims are atomic, isolated by user and bound to the exact API key, job and opaque claim token. A stable claim idempotency key replays the same active lease. Another key cannot steal it. An expired lease cannot submit, heartbeat or finish. Use a new claim idempotency key after the retry window.

Defaults: five-minute renewable lease, three attempts, 30-second exponential retry backoff capped at one hour, and five-minute cooldown after completed collection. A terminal failed job stops automatic new batches. The owner may explicitly retry through a session-only operation. A queued job is not evidence an agent is connected or running.

Submissions are transactional, canonicalized, budget-limited and idempotent while the bound lease is active. New records remain pending. `completed` is accepted only when assessed count reaches the target, and means collection completion, not approval or publication. Review receipts are idempotent and append-only; publication stores an immutable candidate snapshot. Unpublishing changes availability, not the audit history.

## MCP transport and discovery

Endpoint: `/mcp`, authenticated with a separately audience-bound MCP API key. The HTTP boundary checks the key, origin and request limits before invoking the adapter.

The adapter is explicitly pinned to MCP protocol `2025-11-25`. This is a tested compatibility target, not a claim of latest-protocol or third-party-client certification. It supports stateless Streamable HTTP POST with JSON responses, initialization, ping, tool discovery/calls, resource discovery/read and prompt discovery/get. It does not offer a GET event stream, resumable sessions, JSON-RPC batches or server-initiated sampling. Non-initialization requests require `MCP-Protocol-Version: 2025-11-25`; requests must accept both `application/json` and `text/event-stream`. Request bodies are bounded to 1 MiB.

Start with resource `gither://onboarding` or prompt `gither_collector_onboarding`. The discoverable schemas describe required evidence, limits, claim binding and human-review boundaries. `_meta` request metadata is supported. Unknown stats should be omitted.

| Purpose | Required scope |
| --- | --- |
| Pool status and human collection rules | `pool:read` |
| Human profile, subscriptions and proposal reads | `profile:read` |
| Published available catalog | `catalog:read` |
| Candidate outcomes and aggregate feedback | `candidates:read` |
| Claim, heartbeat and finish, including frozen job profile | Both `collection:claim` and `profile:read` |
| Submit candidates to your active bound claim | `candidates:write` |
| Store separate subscription or plan proposals | `pool:write` |

Pool status can queue a job and expire stale leases; its MCP annotation explicitly is not read-only. Pool-only keys receive redacted job status, without profile, subscription, feedback or flavor snapshots. There is no MCP tool for human review, user decisions or authoritative human configuration.

## Untrusted sources and verification

The service performs no network fetches and executes no repository code or README commands. Candidate repository roots and evidence are restricted to bounded HTTPS `github.com` URLs; evidence must belong to the same repository. Credentials, query strings and encoded paths are rejected. Repository text, queries and review notes are data, not instructions. The external collector must use its own authorized research tools, and the human must verify sources before approving.

Tests in `tests/server-pool.test.mjs` cover threshold boundaries, candidate targets, isolation, lease races/replay/expiry/backoff, review separation, deduplication, budgets, undo, frozen profiles, aggregate feedback, flavor allocation, scoped MCP discovery and the complete JSON-RPC collection lifecycle. No production API keys or external collector were used in these tests.

## Official SDK interoperability check

On 2026-11-06, `scripts/verify-mcp-sdk.mjs` passed against the official `@modelcontextprotocol/sdk@1.32.2`, using its `Client` and `StreamableHTTPClientTransport` over the actual Node HTTP bridge. The negotiated protocol was `2025-11-25`. The check covered SDK initialization, tools, onboarding resources, prompts, a complete synthetic collection lifecycle, idempotent submission, scope errors and missing/invalid/wrong-audience/revoked credential rejection. The SDK tolerated the unsupported optional GET stream (`405`) as expected.

See [the reproducible verification report](mcp-sdk-verification.md). This verifies that exact SDK client and transport, not every third-party agent application, OAuth support, or real external research/Agent execution.
