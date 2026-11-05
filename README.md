# Gither

A responsive, local-first project-discovery prototype. The repository was initially empty and this implementation initializes it from scratch.

## Features

- One-card project discovery: swipe left to pass, swipe right to save.
- Explicit buttons, keyboard arrows, Z to undo, and touch/pointer support.
- Saved projects and theme persisted in localStorage; no preference learning.
- Search by project, purpose, or technology, category filtering, and explicit sorting.
- Three complete visual systems: Paper & Olive, Electric Crush, After Hours.
- In-app design-token inspector and JSON export.
- Twelve real open-source projects with clearly labeled static example summaries, not live metrics.
- Local Agent is a visible future integration, not a connected service.

## Stack

React 19.3.1, TypeScript 7.0.2 (stable), Vite 8.3.6, and CSS custom properties. Exact versions are pinned in package.json and package-lock.json. There is no account database, analytics, or backend. Sample data and design tokens are in `src/data.ts`; pure state logic is in `src/state.ts`; the UI is in `src/App.tsx`.

## Run

Run `npm ci`, then `npm run dev`. For a production bundle run `npm run build`; deploy the resulting `dist` directory. Node.js 24.22.1 was used for verification.

## Verify

Run `npm run check` for strict TypeScript 7 validation, `npm test` for nine state/data/accessibility tests, and `npm run build` for the production bundle. `npx tsc --version` reports 7.0.2.

## Deploy to Cloudflare Pages

Use this repository as the source, choose Vite, set the build command to `npm run build`, and set the output directory to `dist`. This static prototype does not require Workers or D1. A future real search integration will need an authenticated backend or a securely paired local agent; do not expose local agent ports publicly.

The private Sites preview, when published, is separate from the user's own Cloudflare account. `.openai/hosting.json` configures that preview only.

## Design tokens

`src/data.ts` exports all three semantic token sets plus shared spacing, motion, breakpoint, and interaction values. CSS variables in `src/styles.css` implement those styles. Respect `prefers-reduced-motion`; keyboard and button alternatives are provided for swipe gestures.

## Data and limitations

Favorites stay on the current browser and origin and do not sync across devices. Clearing browser data removes them. Project summaries are illustrative and are not automatically refreshed. Consult official project repositories for current functionality, licenses, and deployment instructions.

## Future discovery pipeline (not implemented)

Scheduled trigger → GitHub/Show HN source adapters → queue → normalize and deduplicate → D1 candidate store → review/publish → read-only search API. An optional local Agent may later search or rerank through a secure pairing flow. None of these services is connected in this prototype; no background discovery or preference learning runs.
