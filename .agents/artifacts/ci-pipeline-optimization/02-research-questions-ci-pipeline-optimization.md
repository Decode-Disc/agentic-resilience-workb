---
type: research-questions
repos:
  - identifier: "Decode-Disc/agentic-resilience-workb"
    sha: "f6d05d9333254b7904b33ea956a283b194dda32c"
flow: tdd
---

# Research Questions: CI Pipeline Optimization

## Key Context Pointers

- `.github/workflows/quality.yml`
- `package.json` (`test`, `check`, `test:e2e`, `workbench-ui:check`)
- `vitest.config.ts` and `src/__tests__/setup/cleanup.ts`
- `scripts/local-dev.ts` (`test:e2e`, `waitForBackend`, `waitForOrigin`)
- `playwright.config.ts`, `workbench-ui.playwright.config.ts`, `e2e/global-setup.ts`
- PR #2 GitHub Actions run: `https://github.com/Decode-Disc/agentic-resilience-workb/actions/runs/45593318635`
  - E2E job log: `https://github.com/Decode-Disc/agentic-resilience-workb/actions/runs/45593318635/job/139132839003`
  - Quality job log: `https://github.com/Decode-Disc/agentic-resilience-workb/actions/runs/45593318635/job/139132838397`
  - UI job log: `https://github.com/Decode-Disc/agentic-resilience-workb/actions/runs/45593318635/job/139132838976`

## Questions

1. **E2E startup failure and timeout:** In `.github/workflows/quality.yml` (`browser-e2e`) and `scripts/local-dev.ts` (`test:e2e`, `waitForBackend`, `waitForOrigin`), how do the anonymous Convex backend and web server start during `pnpm test:e2e`, why did Convex fail typechecking in run `45593318635`, and why did `scripts/local-dev.ts` keep waiting until the startup timeout instead of exiting as soon as Convex failed?
2. **Vitest execution profile:** In `package.json` (`test`, `check`) and `vitest.config.ts`, how do Vitest workers, isolation, and setup files currently run, and which test files or setup steps drive the 10m46s runtime in the `quality` job?
3. **Vitest DOM vs Node split:** Across `src/__tests__/**/*.test.{ts,tsx}`, which test suites require `jsdom` versus pure Node, and what do those tests depend on in `src/__tests__/setup/cleanup.ts` or `vitest.config.ts` (`execArgv`, plugins, path aliases)?
4. **Playwright browser installs and launch behavior:** In `.github/workflows/quality.yml`, `workbench-ui.playwright.config.ts`, `playwright.config.ts`, and `e2e/global-setup.ts`, what Chromium binaries do `workbench-ui` and `browser-e2e` install and launch today, and how does that compare to `preview-service` (`--only-shell chromium`)?
5. **CI job structure, caching, and sharding:** In `.github/workflows/quality.yml`, what setup, cache hits, and test counts occur across `quality`, `preview-service`, `workbench-ui` (4 shards), and `browser-e2e` (4 shards), and what are the per-step durations and queue wait times from run `45593318635`?
6. **Workflow and config guardrails:** Which tests or verification scripts (such as `src/__tests__/config/*.test.mjs`, `scripts/check-*.ts`, or `pnpm check`) inspect or assert invariants on `.github/workflows/quality.yml`, `vitest.config.ts`, `playwright.config.ts`, or `scripts/local-dev.ts`?
