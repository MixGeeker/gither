# Verification — 2026-11-05

## Automated

- Node.js 24.22.1.
- TypeScript CLI reports 7.0.2, pinned exactly.
- `npm run check`: strict type checking passed.
- `npm test`: 9/9 state and data tests passed.
- Semantic foreground/muted text colors meet a 4.5:1 contrast ratio against each theme background.
- `npm run build`: Vite 8.3.6 production build passed.

## Browser checks

Performed in a cloud browser against the production bundle:

- Save a project, inspect the next card, and undo to restore the prior card.
- Search for Bruno, open its details, save it, refresh, and verify the saved count remains.
- Switch visual themes and verify the theme remains after refresh.
- Verify no-results state and clear filters.
- Verify the AI category has two sample projects.
- Verify explicit alphabetical sorting begins with AppFlowy.
- Inspect token values in the modal and download the JSON; verify all three themes are present.
- Drag a project card right to save, then undo.
- Use left arrow to dismiss and Z to undo.
- Inspect the narrow layout in a 390px-wide iframe (375px content area after its scrollbar): no horizontal overflow. Inspect the dark theme and the detail modal at this width.

Browser extension metadata errors appeared in the console; no application-origin error was observed in the checks. A physical phone touchscreen was not tested. Swipe uses standard pointer events with `touch-action: pan-y`; buttons and keyboard provide equivalent controls.

## Boundaries

No live ingestion, account synchronization, backend, D1, or local Agent connection is implemented. Project summaries are static examples; favorites and theme are local to the browser and origin.

## Phase 2 verification

- Frontend and auth Worker strict TS7 checks pass.
- 26 automated tests pass: 9 original, 6 sharing/PWA, 11 authentication/security.
- Production frontend build and service-worker generation pass.
- Better Auth Worker dry-run build and actual local workerd/D1 smoke test pass; no production resource was created.
- Browser-generated PNG was downloaded and visually inspected at 1200×1500.
- List sharing begins with no selected items and a disabled copy button; selecting one of two saved projects produced a URL containing only that project.
- Opening that URL displayed only the selected item without changing the saved count.
- Stopping the preview origin produced curl exit 7; reloading the browser still rendered the cached app and saved count.
- Unconfigured login and registration display clear unavailable states with disabled provider controls.
- Full provider consent/token exchange, real email delivery, production D1 and physical PWA installation are not verified.

## GitHub + Material 3 update (2026-11-05)

- Official Primer light/dark/dimmed token sources checked; dimmed small-text accent uses Primer dark accent for >=4.5:1 contrast.
- 28 tests passed; frontend strict TypeScript 7 and Vite production build passed.
- Mobile homepage tested in a real resized cloud browser window at 125% zoom (window.innerWidth 400, clientWidth 388, height 726 CSS px). No iframe or mock device rendering. DevTools/device emulation is prohibited by the browser policy, so native phone hardware has not been tested.
- Page scrollWidth equals clientWidth (388): no horizontal page overflow. Save-action row ends at y641, before bottom navigation begins at y650: all four primary actions are visible on the first screen.
- Save and Undo verified on the mobile layout; theme changes preserve favorites.
- Login entry removed at user request. Auth scaffolding remains isolated, disabled and undeployed; no credentials or Cloudflare resources were created.
