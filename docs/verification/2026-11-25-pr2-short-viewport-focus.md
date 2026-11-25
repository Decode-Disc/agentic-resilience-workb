# Framing editor visibility after viewport reduction

Date: 2026-11-25. Starting revision: `84f1b9a30a50368f5baa52945725da0b015a8766`, [PR 2](https://github.com/Decode-Disc/agentic-resilience-workb/pull/2).

## Reproduced defect

The [fourth browser shard](https://github.com/Decode-Disc/agentic-resilience-workb/actions/runs/45615331466/job/139209121124) failed the interrupted-response display scenario at 390 and 320 pixels. After reducing viewport height from 844 to 520 pixels, the refinement editor remained focused but had zero viewport intersection. The other seven shard cases passed.

The existing mobile framing stylesheet constrains the anchored dock's height in short viewports and gives it independent overflow scrolling, preserving room for the response above it. Reducing that height can hide the already-focused editor below the dock's visible extent. The browser's original focus scrolling does not repeat merely because its containing scroll box shrinks. The existing application test reproduced the same failure locally at its editor visibility assertion before the production change.

## Correction

`StartFramingScreen` now observes its own dock size. If focus is inside that dock and the focused control is outside its visible vertical bounds, it adjusts only the dock's scroll offset to reveal the control. It does not move focus or change the transcript's scroll position. The observer disconnects on unmount. The shared dock primitive, framing layout, disclosure state and existing height policy are unchanged.

Manual inspection of the real framing component in the illustrative gallery covered desktop, 390-pixel and 320-pixel widths. At 390 × 520 after resizing a focused editor, its bottom was 509.9 pixels against the dock's 510-pixel lower edge, with focus preserved. At 320 × 520 the corresponding edge was within one pixel of the dock boundary. These measurements concern rendering; the separate admitted application scenario exercises persisted interruption and reload.

## Verification

```sh
pnpm test:e2e src/__tests__/e2e/workbench-interrupted-display.spec.ts -g '390px' --workers=1 --reporter=list
pnpm test:e2e src/__tests__/e2e/workbench-interrupted-display.spec.ts --workers=1 --reporter=list
pnpm workbench-ui:check framing-mobile.spec.ts chat-surfaces.spec.ts --workers=1 --reporter=list
pnpm exec vitest run src/__tests__/components/workspace/start-screens.test.tsx --maxWorkers=1
pnpm exec tsc --noEmit
```

The first command reproduced the original failure before correction. After correction, all seven focused gallery cases, 12 component integration cases and the frontend/test typecheck passed. The unchanged 320-pixel application scenario passed in the first combined run. That run's desktop and 390-pixel cases timed out while waiting for the initial simulated reply, before reaching the visual assertions; it ran alongside compilation and gallery checks. Their later authority refusals followed test teardown and do not establish the cause of that wait. The subsequent isolated serial run passed all three unchanged application scenarios at 1,440, 390 and 320 pixels in 2.6 minutes, including interruption display, editor focus/visibility after resizing, reachable Start, reload and zero provider calls. No test assertion, retry or timeout was relaxed.

No backend code, provider call, migration, cloud cutover or paid qualification is part of this correction. The final CI result remains revision-specific.
