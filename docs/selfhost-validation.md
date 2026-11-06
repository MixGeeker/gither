# Self-hosted release validation — 2026-11-06

## Automated

- React/frontend, Node server, and retained Cloudflare prototype typechecks passed with TypeScript 7.0.2.
- Full regression suite: 122 tests passed, zero failures, on the final source snapshot.
- Production self-hosted frontend and Node ESM bundles built successfully.
- Independent read-only security review found and verified fixes for asynchronous key serialization, profile/scope leakage, MCP scope separation, proposal bounds, human retry/clear recovery, and Docker file handling.
- Official MCP SDK 1.32.2 completed 23 actual loopback HTTP requests using protocol 2025-11-25. [Detailed reproduction](mcp-sdk-verification.md).
- Shell syntax checks and Compose YAML parsing passed. These do not substitute for an actual Docker build.

## Real browser

The production frontend and real Node HTTP/auth/pool handlers ran against an isolated in-memory test database. Browser viewport was 440 × 956 CSS pixels (iPhone 16 Pro Max-sized simulation, not an actual iPhone).

Observed: password login, fail-closed empty pool, importing three explicitly labeled static examples as pending candidates, individual review into the pool, saving a project, undo restoring its queue position and saved count, search matching one project with an accurate count, editing profile and flavor ratios to 80/20 with version increment, theme selection, PWA install/update UI, same-account share dialog, and logout returning to the login gate. No horizontal page overflow was present at this viewport.

The card regression discovered in this run was corrected: backend-generated project IDs now render the approved text-only capabilities and scenario layout, not the old diagram fallback. Verified owner avatars resolve by canonical repository; unknown metrics remain unavailable rather than inheriting sample statistics.

## Limits

- No Docker/Podman/BuildKit engine is installed in the validation environment. Image build/start, volume ownership under Docker, public DNS/TLS and physical-device installation remain untested.
- No real owner account, persistent API/MCP key, cloud resource or live external Agent job was created. Browser fixtures were temporary; tests did not execute the three third-party projects.
- External Agent application integration and unattended scheduling remain the deployer's separate setup. Official SDK interoperability does not prove every third-party client works.
- This is a single-owner deployment with terminal bootstrap/recovery, not public multi-account registration. OAuth remains disabled.
- Cloudflare/D1 prototype adapters remain separate and unconfigured; Docker does not deploy to Workers.
