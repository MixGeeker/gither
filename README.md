# Gither

A responsive, local-first project-discovery prototype. The repository was initially empty and this implementation initializes it from scratch.

## Features

- One-card project discovery: swipe left to pass, swipe right to save.
- Explicit buttons, keyboard arrows, Z to undo, and touch/pointer support.
- Saved projects and theme persisted in localStorage; no preference learning.
- Search by project, purpose, or technology, category filtering, and explicit sorting.
- GitHub Primer light, dark and dimmed color themes with Material Design 3-inspired components.
- In-app design-token inspector and JSON export.
- Twelve real open-source projects with clearly labeled static example summaries, not live metrics.
- Local Agent is a visible future integration, not a connected service.

## Stack

React 19.3.1, TypeScript 7.0.2 (stable), Vite 8.3.6, and CSS custom properties. Exact versions are pinned in package.json and package-lock.json. There is no account database, analytics, or backend. Sample data and design tokens are in `src/data.ts`; pure state logic is in `src/state.ts`; the UI is in `src/App.tsx`.

## Run

Run `npm ci`, then `npm run dev`. For a production bundle run `npm run build`; deploy the resulting `dist` directory. Node.js 24.22.1 was used for verification.

## Verify

Run `npm run check` for strict TypeScript 7 validation, `npm test` for the complete state/data/security test suite, and `npm run build` for the production bundle. `npx tsc --version` reports 7.0.2.

## Deploy to Cloudflare Pages

Use this repository as the source, choose Vite, set the build command to `npm run build`, and set the output directory to `dist`. This static prototype does not require Workers or D1. A future real search integration will need an authenticated backend or a securely paired local agent; do not expose local agent ports publicly.

The private Sites preview, when published, is separate from the user's own Cloudflare account. `.openai/hosting.json` configures that preview only.

## Design tokens

`src/data.ts` exports all three semantic token sets plus shared spacing, motion, breakpoint, and interaction values. Theme color values are applied directly as CSS variables by `src/App.tsx`; `src/styles.css` and `src/card-refinement.css` implement the Material 3-inspired layout. Respect `prefers-reduced-motion`; keyboard and button alternatives are provided for swipe gestures.

## Data and limitations

Favorites stay on the current browser and origin and do not sync across devices. Clearing browser data removes them. Project summaries are illustrative and are not automatically refreshed. Consult official project repositories for current functionality, licenses, and deployment instructions.

## Future discovery pipeline (not implemented)

Scheduled trigger → GitHub/Show HN source adapters → queue → normalize and deduplicate → D1 candidate store → review/publish → read-only search API. An optional local Agent may later search or rerank through a secure pairing flow. None of these services is connected in this prototype; no background discovery or preference learning runs.

## Phase 2: PWA, sharing, and auth foundation

- Installable PWA manifest with generated 192/512px icons and an Apple touch icon.
- Build-time service worker caches only the app shell and bundled sample data. Auth, callbacks, sessions, tokens and private APIs are explicitly excluded. Updates require the user to choose the update button.
- Project links open that project. Shared-list links contain only explicitly selected project IDs and a title; no favorites are shared by default or automatically imported by the recipient.
- Native system sharing when supported; copy-link and 1200×1500 PNG card download fallbacks. Generated links retain the host's access policy; a private preview does not become public because a link is shared.
- Login remains disabled at the user’s request. No visible login/register entry, runtime auth request or password collection.
- Separate Better Auth 1.7.17 + native D1 Worker foundation, with reviewed migration, provider security controls and local workerd/D1 tests. It is NOT deployed or configured with real OAuth credentials. OAuth first login can register an account once configured; email/password remains disabled pending verified email delivery.

Commands: `npm run check`, `npm run auth:check`, `npm test` (37 checks), `npm run build`, `npm run auth:smoke`. The last command only dry-bundles and tests locally; it does not deploy.

See [auth setup and security](docs/auth-backend.md) and [phase-two boundaries](docs/phase-two.md).

## Design update

GitHub Primer color values are reused from official current tokens. The UI uses Material 3 web shape, state and type guidance with a compact mobile layout, icon actions and no decorative slogans. No GitHub/Google brand assets or affiliation are implied. See [design sources and mappings](docs/design-system.md). Legacy theme IDs are retained internally so stored favorites and preferences remain compatible.

OAuth implementation is paused at the user's request. Google/GitHub login has no visible entry point and no runtime requests in the app. `src/AuthPanel.tsx` and `worker/` remain isolated extension scaffolding only, disabled and undeployed.

The discovery screen is card-first with no app header or logo. Search/filter and More are bottom-navigation sheets; the large card, primary swipe actions and navigation fit a phone viewport with safe-area padding.

Cards now use a black Polaroid frame with a wider GitHub identity footer, genuine repository-owner avatars and dated Star/Fork counts. `src/github-metadata.json` and `public/avatars/provenance.json` record official source URLs and collection time. Counts are snapshots, not live. The code-rain graphic is decorative, not repository source or agent activity, and becomes static under reduced motion. The Cal.com sample now links to the canonical `calcom/cal.diy` repository after a verified redirect.

## Card and interaction refinement

Project purpose is presented as an explicitly labeled editorial text cover, not a fabricated product screenshot. Dark mode uses semantic dark surfaces throughout. The black identity footer is 164px high on tall phones, with narrower responsive variants. Code rain is a low-opacity background and respects reduced motion.

Search distinguishes all matching projects from the remaining discovery queue. “View all” includes saved and dismissed matches. Replay restores only the dismissed matches under the current filters and is undoable. Feedback occupies a fixed row above actions instead of covering them. Appearance choices are directly available under More, separately from the token inspector. Short screens retain the author and project purpose in a scrollable reader.
