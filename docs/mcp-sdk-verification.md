# Official MCP SDK interoperability verification

Verified on **2026-11-06**, in the cloud workspace only.

## Exact tested combination

- Official npm package: `@modelcontextprotocol/sdk@1.32.2`
- Client classes: `Client` and `StreamableHTTPClientTransport`
- Negotiated MCP protocol: `2025-11-25`
- Runtime: Node `v24.22.1`
- Server: the application's real `createHttpServer` → `createApplication` → authenticated MCP adapter
- Transport: actual loopback HTTP requests, with normal SDK fetch/headers and no custom transport mock
- Fixture storage: SQLite `:memory:` only
- Authentication: randomly generated, short-lived test credentials retained only in process memory; no credentials were logged or written to disk

## Results: passed

The script made **23 actual HTTP requests** and verified:

1. SDK initialization, negotiated protocol, server capabilities and the initialized notification.
2. `listTools`, including bounded candidate schemas and absence of human decision/configuration tools.
3. `listResources`, `readResource` for `gither://onboarding`, and `listResourceTemplates`.
4. `listPrompts` and `getPrompt` for `gither_collector_onboarding`.
5. `callTool`: pool status → atomic claim → candidate submission → idempotent submission replay → collection completion. Both synthetic candidates remained pending human review; neither became available.
6. A valid MCP key without `profile:read` received a structured `INSUFFICIENT_SCOPE` tool error.
7. Missing, invalid and API-audience credentials failed initialization with HTTP 401.
8. Revoking the previously working MCP key caused the next SDK request to fail with HTTP 401.
9. Subsequent requests carried the negotiated protocol header. The initialized notification received HTTP 202. The SDK accepted the optional GET event stream being unsupported with HTTP 405.

No server implementation change was required for the official SDK run. Existing backend regression tests also passed: **44/44**.

## Reproduce without changing project dependencies

From the repository root, install the exact SDK into an isolated temporary directory. This install does not modify the project's package or lock file and disables dependency lifecycle scripts:

```sh
npm --prefix /tmp/gither-mcp-sdk-interop \
  --cache /tmp/gither-mcp-sdk-cache \
  install --ignore-scripts --no-audit --no-fund --save-exact \
  @modelcontextprotocol/sdk@1.32.2
npm run server:build
MCP_SDK_DIR=/tmp/gither-mcp-sdk-interop/node_modules/@modelcontextprotocol/sdk \
  node scripts/verify-mcp-sdk.mjs
```

The verifier asserts the exact package version, builds an in-memory fixture, opens a loopback server, and closes the server/database after the run. It prints only the test summary, protocol/version and check names, never keys, passwords or claim tokens.

## Limits

This verifies interoperability with the official SDK client at the exact version above. It does **not** establish universal compatibility with third-party Agent applications, OAuth-only clients, an external account connection, real GitHub research, deployed scheduling, Docker execution, public TLS or external Agent execution. Synthetic GitHub URLs in the fixture were never fetched and are never published as real projects.
