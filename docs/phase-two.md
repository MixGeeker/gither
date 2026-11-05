# Phase 2 — what works and what is not connected

## PWA

The production build emits a manifest, app icons and `sw.js`. After the first successful online visit, the browser can cache the application shell and bundled examples. Installation depends on browser support and must be initiated by the user. The UI explains iOS/Android/desktop installation and reports when the offline package is ready. A new worker waits for explicit update confirmation.

The service worker does not handle non-GET or cross-origin requests and excludes `/api/*`, auth routes, callbacks and URLs containing authorization/session parameters. It never caches private API responses or session data. Favorites remain in the current browser's localStorage, not the service worker cache or a cloud account.

Verified locally by stopping the preview origin (curl failed with connection error), reloading the already-visited application in the browser, and confirming the shared-list page and saved count still rendered from the cached shell. A physical-device installation has not been tested.

## Sharing

Project and list URLs contain public catalog IDs plus an optional user-entered title. Lists start with nothing selected; users explicitly choose the records to disclose. Opening a shared list does not add those records to the recipient's favorites. URL values are encoded, deduplicated, validated and bounded. This is a static snapshot, not a server-side collaborative list, and cannot be revoked independently once copied.

The share sheet offers browser-native sharing where supported, clipboard copying, and a downloadable PNG. Card images show the selected public project summaries, not private browsing history, saved counts or account details. Images are generated locally, without a third-party rendering service. Current previews may be private: recipients still need permission to open the site. Sharing never changes the site's access policy.

## Authentication

The frontend and Worker foundation exist and pass TypeScript 7 checks. The static preview does not have a live auth backend. Its Google/GitHub buttons are intentionally disabled and explain what is missing.

Activation needs an approved production domain and same-origin API route, a real D1 binding and applied migrations, a strong Worker secret, OAuth clients and exact callbacks, provider consent/branding setup and production end-to-end verification. None was provisioned by this task. Credentials must go through a secure configuration channel, never the repo, browser bundle, or chat.

OAuth first login is the supported registration design. Password registration is intentionally off until verified email delivery and password recovery are implemented. Account identity does not imply favorites sync: that is separate future work with an explicit data-migration decision.
