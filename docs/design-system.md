# GitHub colors + Material 3 components

Updated 2026-11-05. Gither is an independent app, not a GitHub or Google product. No proprietary brand logo is used. Values are directly applied from `themes` in `src/data.ts` to CSS custom properties. Existing internal theme IDs remain compatible with saved browser state.

## Exact color mappings

| Gither role | Primer token | Light | Dark | Dimmed |
|---|---|---|---|---|
| background | bgColor-default | #ffffff | #0d1117 | #212830 |
| surface | bgColor-muted | #f6f8fa | #151b23 | #262c36 |
| text | fgColor-default | #1f2328 | #f0f6fc | #d1d7e0 |
| muted | fgColor-muted | #59636e | #9198a1 | #9198a1 |
| primary/link | fgColor-accent | #0969da | #4493f8 | #4493f8 (dark token reused) |
| accent container | bgColor-accent-muted | #ddf4ff | rgba(56,139,253,.10) | rgba(65,132,228,.10) |
| border | borderColor-default | #d1d9e0 | #3d444d | #3d444d |
| action | button-primary-bgColor-rest | #1f883d | #238636 | #347d39 |
| onPrimary | button-primary-fgColor-rest | #ffffff | #ffffff | #ffffff |

Sources: [Primer color reference](https://primer.style/product/primitives/color/), [backgrounds](https://github.com/primer/primitives/blob/main/src/tokens/functional/color/bgColor.json5), [foregrounds](https://github.com/primer/primitives/blob/main/src/tokens/functional/color/fgColor.json5), [borders](https://github.com/primer/primitives/blob/main/src/tokens/functional/color/borderColor.json5), [dark base](https://github.com/primer/primitives/blob/main/src/tokens/base/color/dark/dark.json5), [dimmed base](https://github.com/primer/primitives/blob/main/src/tokens/base/color/dark/dark.dimmed.json5), [buttons](https://github.com/primer/primitives/blob/main/src/tokens/component/button.json5).

## Material 3 interpretation

- 28px cards and dialogs, 8px chips, pill buttons and segmented theme controls.
- Bottom navigation on all screen sizes, supporting icon plus short label. No discovery header.
- Consistent 24px outlined SVG icons, 1.8px stroke. Icon-only actions have accessible labels and title tooltips.
- 48px minimum secondary targets; labeled primary decisions are 56px high.
- Purpose 34/46px; repository 17/24px; body 15/27px; metadata 13/22px. Short screens reduce headline size before making the content reader scroll.
- State layers: hover 8%, pressed 12%, disabled 38%. Keyboard focus has a 3px outline in addition to state color.
- 200ms standard easing cubic-bezier(.2,0,0,1), disabled under prefers-reduced-motion. This uses established M3 web tokens, not the newer Expressive spring system.

Official [shape](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-shape.scss), [type](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-typescale.scss), [state](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-state.scss), [motion](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-sys-motion.scss), [filled button](https://github.com/material-components/material-web/blob/main/tokens/versions/v0_192/_md-comp-filled-button.scss).

## Content rules

No decorative slogans, quotes, project-number ornament, or giant art words. Keep project purpose, technology, functional evidence and essential sample/private/offline states. Icons replace familiar actions, not unclear status. Theme mode changes do not change saved projects. Login is disabled; the isolated backend scaffold is not connected.

Accessibility adaptation: Primer dimmed accent #478be6 is below 4.5:1 on #212830. Gither reuses the official dark accent #4493f8 for dimmed text and icon controls to meet normal-text contrast. All colors still come from Primer.

## Card-first mobile revision

No top header, Gither logo, search bar, filter row, sorting row or page heading appears above the discovery card. Search and sorting open from the bottom navigation. Secondary settings are grouped in More; account entry remains absent. A 28px card fills `100dvh - 196px - safe-area-insets`, approximately 80% of the 440×956 phone viewport. Primary pass/save buttons are 56px tall, secondary Undo/Share 48px. The 72px bottom navigation adds the device bottom safe area. The page declares viewport-fit=cover. Project identity and functional evidence remain inside the card, with sample-data status retained.

## Polaroid identity revision

A 2px #010409 frame wraps three sides; a black identity footer with 124px minimum height creates the wider bottom border (120px on shorter screens). It grows if repository text wraps. The footer includes genuine GitHub organization/avatar images, owner/repository syntax, Star/Fork icon counts and a visible snapshot date. Missing images show a labeled initial fallback. The content area uses semantic Primer colors in every mode: one continuous muted surface (#f6f8fa / #151b23) across cover and summary. Code rain has 6% overall opacity with a 20–26s cycle behind the editorial text cover, and stops under reduced-motion. It is decorative, not actual repository code or an agent status. The cover is explicitly labeled and is not a product screenshot. A fixed 32px live-status row sits between the card and primary actions, preventing feedback overlap.

iPhone 16 Pro Max layout target is 440×956 CSS pixels (physical screen 1320×2868, scale3). Sources: https://support.apple.com/en-us/121032 and https://www.ios-resolution.com/. Browser screenshots emulate only the logical full-screen rectangle; they do not claim real iPhone hardware, Safari chrome, hardware DPR3, or Dynamic Island simulation.

## Visual consolidation

The duplicated top project name, separated white summary panel, tag pills and repeated audience sentence were removed from the front card. Repository identity remains in the footer; full audience/features remain in Details. A labeled original three-step functional diagram presents the existing example’s purpose with consistent outlined icons. It does not resemble a fabricated product screenshot or claim live output. The description sits22px below the purpose heading. Metadata uses12–13px text; the dated snapshot uses11px (10px on narrow screens), with a48px link target. Identity/avatar40px, details48px and decision56px targets remain accessible. The footer is auto-height with a minimum, not a clipping fixed height.
