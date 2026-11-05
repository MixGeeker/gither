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
