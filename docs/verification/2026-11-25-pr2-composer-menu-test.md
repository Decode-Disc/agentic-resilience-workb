# Composer menu browser-test synchronization

Date: 2026-11-25. Reviewed starting revision: `e1b8e1779063957295e478f0be841f06a829b618`, [PR 2](https://github.com/Decode-Disc/agentic-resilience-workb/pull/2).

## Observed failure and evidence

The [workbench-ui (2) check](https://github.com/Decode-Disc/agentic-resilience-workb/actions/runs/45612331353/job/139198784453) failed two `composer-program.spec.ts` cases: light theme at 1,440 and 390 pixels. Both reached the assertion after pressing Escape and refocusing the editor, but the Composer tools trigger still reported `aria-expanded="true"`. The other 43 cases in that shard passed.

The original sequence clicked the trigger, checked only the unchanged editor text, pressed Escape on the page's current focus, and immediately forced focus back into the editor. It did not establish that the popup had mounted or acquired keyboard focus, and it did not verify native focus restoration before intervening.

Installed Base UI 1.6.0 mounts the menu through its portal and manages initial/return focus through `FloatingFocusManager`; `useDismiss` supplies popup/trigger key handlers and document listeners while open. Local event instrumentation showed the menu's focus arriving after the trigger click. Nevertheless, the original test passed locally in the initial four-case run, 20 repeated cases, and four cases under sixfold Chromium CPU throttling. The exact CI event ordering was not captured, so premature keyboard dispatch remains a supported explanation, not a reproduced application defect.

## Correction

The browser test now waits for the named menu to be visible and focused, sends Escape to that menu, and verifies that the popup is hidden, the trigger is collapsed and focus has returned to the trigger. Only then does it focus the editor and verify that the draft remains intact. These assertions retain the original dismissal requirement and additionally exercise native focus restoration. No application component, dependency, retry count, sleep or timeout changed.

## Verification

```sh
pnpm workbench-ui:check composer-program.spec.ts --repeat-each=3 --workers=2 --reporter=list
pnpm workbench-ui:check --shard=2/4 --workers=2 --reporter=list
pnpm exec biome check src/__tests__/design-system/workbench-ui/browser/composer-program.spec.ts
pnpm docs:check
```

The correction's focused repeated run passed 12 cases. The complete shard passed all 45 cases with two workers. Biome and documentation checks passed. Only the focused browser checks were rerun because this correction changes one browser test and its evidence report. The temporary event logging and CPU throttling were removed. The application backend and provider workflows were not exercised for this test-only correction. The new commit's CI result remains the decisive check for the original environment; local passes alone do not establish that its intermittent failure is eliminated.
