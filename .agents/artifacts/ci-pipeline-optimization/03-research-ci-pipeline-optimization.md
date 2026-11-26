---
date: 2026-11-26T11:54:00Z
repos:
  - identifier: "Decode-Disc/agentic-resilience-workb"
    sha: "f6d05d9333254b7904b33ea956a283b194dda32c"
topic: "CI Pipeline Optimization"
type: research
flow: tdd
tags: [research, ci, github-actions, vitest, playwright, convex]
status: complete
---

# Research: CI Pipeline Optimization

## Research Question

1. **E2E startup failure and timeout:** In `.github/workflows/quality.yml` (`browser-e2e`) and `scripts/local-dev.ts` (`test:e2e`, `waitForBackend`, `waitForOrigin`), how do the anonymous Convex backend and web server start during `pnpm test:e2e`, why did Convex fail typechecking in run `45593318635`, and why did `scripts/local-dev.ts` keep waiting until the startup timeout instead of exiting as soon as Convex failed?
2. **Vitest execution profile:** In `package.json` (`test`, `check`) and `vitest.config.ts`, how do Vitest workers, isolation, and setup files currently run, and which test files or setup steps drive the 10m46s runtime in the `quality` job?
3. **Vitest DOM vs Node split:** Across `src/__tests__/**/*.test.{ts,tsx}`, which test suites require `jsdom` versus pure Node, and what do those tests depend on in `src/__tests__/setup/cleanup.ts` or `vitest.config.ts` (`execArgv`, plugins, path aliases)?
4. **Playwright browser installs and launch behavior:** In `.github/workflows/quality.yml`, `workbench-ui.playwright.config.ts`, `playwright.config.ts`, and `e2e/global-setup.ts`, what Chromium binaries do `workbench-ui` and `browser-e2e` install and launch today, and how does that compare to `preview-service` (`--only-shell chromium`)?
5. **CI job structure, caching, and sharding:** In `.github/workflows/quality.yml`, what setup, cache hits, and test counts occur across `quality`, `preview-service`, `workbench-ui` (4 shards), and `browser-e2e` (4 shards), and what are the per-step durations and queue wait times from run `45593318635` (and current HEAD)?
6. **Workflow and config guardrails:** Which tests or verification scripts (such as `src/__tests__/config/*.test.mjs`, `scripts/check-*.ts`, or `pnpm check`) inspect or assert invariants on `.github/workflows/quality.yml`, `vitest.config.ts`, `playwright.config.ts`, or `scripts/local-dev.ts`?

## Research Methodology

This document describes the current system using facts from code, tests, GitHub Actions run logs (`45593318635` on `f4af3901` and green HEAD run `45811442776` on `f6d05d93`), and local command verification (`pnpm convex:check` exited 0 on `f6d05d93`). Open questions identify behavior that remains unverified.

## Summary

The Quality workflow (`.github/workflows/quality.yml`) runs 10 parallel jobs per pull request: `quality`, `preview-service`, 4 `workbench-ui` shards, and 4 `browser-e2e` shards. On the latest green HEAD run (`45811442776`, commit `f6d05d93`), total wall-clock time is **8m28s** and total runner time is **43.7 runner-minutes**; the critical path is shared by `browser-e2e (4)` (**8m27s**) and `quality` (**8m07s**). On the earlier failing PR #2 run (`45593318635`, commit `f4af3901`), total wall-clock time reached **13m32s** because `quality` spent **10m46s** in Vitest and all four `browser-e2e` shards waited the full 10-minute startup timeout after Convex typecheck failed.

In `browser-e2e`, step 119 runs `pnpm exec convex dev --once --typecheck disable`, then step 121 runs `pnpm test:e2e`, which spawns `convex dev --start "pnpm exec vite dev"` **without** `--typecheck disable`. Because `convex dev` stays alive in watch mode when function push or typechecking fails, it never launches Vite while keeping `child.exitCode === null`; `waitForBackend` succeeds on `/instance_name`, and `waitForOrigin("web")` polls every 150ms until `LOCAL_RUNTIME_POLICY.maxStartupTimeoutMs` (600,000ms = 10 minutes) expires.

In `quality`, Vitest runs **348 test files** (3,468 tests) with `environment: "jsdom"`, `isolate: true`, `maxWorkers: 4`, and `setupFiles: ["./src/__tests__/setup/cleanup.ts"]`. Only **62 files** are `.test.tsx`; all **286 `.test.ts` files** contain zero DOM API references, yet **265 of them** run inside `jsdom` because only 21 files declare `// @vitest-environment node`. Every single test across all 348 files also executes `cleanup.ts`'s `afterEach`, which imports `@testing-library/react` and awaits `setTimeout(resolve, 60)` (~208s of cumulative sleep across 3,468 tests) to drain `input-otp` timers, even though `input-otp` is only used by `src/components/workspace/invitation-access-drawer.tsx`.

Across CI jobs, the `pnpm` store cache already works (dependencies install in 5-9s). Eight jobs install full Chromium (`playwright install --with-deps chromium`, 16-40s normally, up to 120s on a spike in `workbench-ui (1)` on `45811442776`), even though all suites launch headless Chromium, whereas `preview-service` uses `--with-deps --only-shell chromium` (12-16s). `browser-e2e` has severe shard imbalance on HEAD (`165s`, `197s`, `277s`, `433s` across shards 1-4). Existing guardrails test `scripts/local-dev.ts` extensively (`src/__tests__/config/local-runtime.test.ts`, which itself took 199.5s on run `45593318635`), while no script or test asserts invariants on `.github/workflows/quality.yml`, `vitest.config.ts`, or Playwright configs.

## Detailed Findings

### 1. `browser-e2e` starts `convex dev` without `--typecheck disable` and waits 10 minutes if push fails

In `.github/workflows/quality.yml:118-121`, each `browser-e2e` shard runs two separate Convex invocations:
1. `pnpm exec convex dev --once --typecheck disable` (`quality.yml:119`) initializes the anonymous local deployment (`CONVEX_AGENT_MODE=anonymous`), writes `.env.local` and `.convex/local/default/config.json`, and pushes functions with typechecking disabled (15-35s).
2. `pnpm test:e2e --shard=${{ matrix.shard }}/4` (`quality.yml:121`) invokes `node --experimental-strip-types scripts/local-dev.ts test:e2e --shard=...` (`package.json:27`).

Inside `scripts/local-dev.ts:211-360`, `runNativeWatcher(root, true, true, args)` sets `nativeArgs = []` (`local-dev.ts:243`, reserving `args` for Playwright) and spawns `node_modules/convex/bin/main.js` with `["dev", ...backendVersionArgs, "--local-cloud-port", String(ports.convex), "--local-site-port", String(ports.site), "--start", "pnpm exec vite dev"]` (`local-dev.ts:304-318`). It passes no `--typecheck` flag and no `--once` flag.

```mermaid
sequenceDiagram
    participant CI as quality.yml (browser-e2e)
    participant LD as scripts/local-dev.ts
    participant CD as convex dev (watch)
    participant Vite as vite dev (--start)

    CI->>LD: pnpm test:e2e --shard=N/4
    LD->>CD: spawn convex dev --start "pnpm exec vite dev"
    CD-->>LD: local backend serves /instance_name
    Note over LD: waitForBackend() succeeds (local-dev.ts:472-487)
    CD->>CD: internal tsc --project convex fails (exitCode stays null)
    Note over CD,Vite: watch mode stays alive; --start never runs Vite
    loop every 150ms for 600,000ms (10 min)
        LD->>LD: waitForOrigin("web") checks manifest + child.exitCode
    end
    LD-->>CI: LocalDevError: "The local web listener did not become ready before the startup timeout."
```

Two details explain the 10-minute hang observed in run `45593318635` (job `139132839003`, 10:19:22Z to 10:29:25Z):
- `waitForBackend` (`scripts/local-dev.ts:448-505`) checks only `child.exitCode === null` and `GET http://127.0.0.1:<port>/instance_name` (`scripts/local-runtime.ts:1014-1040`). It does not verify that `convex dev`'s function push succeeded.
- `waitForOrigin` (`scripts/local-dev.ts:775-811`) waits up to `STARTUP_TIMEOUT_MS` (`LOCAL_RUNTIME_POLICY.maxStartupTimeoutMs = 600_000` in `convex/resourcePolicy.ts:485`, overridable via `LOCAL_RUNTIME_STARTUP_TIMEOUT_MS` at `local-dev.ts:39-42`), polling every `150ms` (`webReadinessPollMs`, `convex/resourcePolicy.ts:487`) for `vite.config.ts:15-56` (`localRuntimeAddressPlugin`) to publish `manifest.origins.web`. Because `convex dev` stays alive in watch mode after `typeCheckFunctionsInMode` fails (`node_modules/convex/dist/esm/cli/lib/typecheck.js:23-83`), `child.exitCode` remains `null` and `waitForOrigin` blocks for all 600 seconds.

On commit `f4af3901` (run `45593318635`), `convex dev`'s internal `tsc --project convex` reported 94 errors in 20 files (e.g. `convex/companyResolution.ts:394` implicit `any`, `convex/domain/workbenchContext.ts` union property errors), even though `tsc --noEmit -p convex/tsconfig.json` passed in `quality` on the same commit. On current HEAD `f6d05d93` (after `@convex-dev/agent` was retired in `f1eabf3`), `pnpm convex:check` exits 0 locally and all four `browser-e2e` shards pass in run `45811442776`. The watch-mode 10-minute hang mechanism in `scripts/local-dev.ts` remains unchanged.

#### Testing Patterns

`src/__tests__/config/local-runtime.test.ts` (48 tests, `// @vitest-environment node`) tests `scripts/local-dev.ts` by copying it into temporary git repos and spawning real Node child processes (`local-runtime.test.ts:413-416, 541-567`). Lines `819-857` assert the exact `convex dev` argument vector (`["dev", "--local-backend-version", "precompiled-fixture", "--local-cloud-port", ..., "--local-site-port", ..., "--start", "pnpm exec vite dev"]`) and Playwright arg forwarding. Lines `1595-1670` test non-zero native exit propagation and `SIGINT` cleanup on timeout. No test currently covers a `convex dev` watcher that stays alive after a push/typecheck failure without launching Vite.

---

### 2. Vitest runs 265 pure-Node test files in `jsdom` and sleeps 60ms after every test

`package.json:24,34` runs `pnpm test:protocol && TMPDIR=/tmp TEMP=/tmp TMP=/tmp vitest run` inside `pnpm check`. `vitest.config.ts:4-18` configures:

| Option | Value | Location |
| --- | --- | --- |
| `environment` | `"jsdom"` (`jsdom@28.1.0`) | `vitest.config.ts:8` |
| `execArgv` | `["--no-experimental-webstorage"]` | `vitest.config.ts:10` |
| `include` / `exclude` | `src/__tests__/**/*.test.{ts,tsx}` excluding `src/__tests__/live/**` | `vitest.config.ts:11-12` |
| `isolate` | `true` | `vitest.config.ts:13` |
| `maxWorkers` | `4` | `vitest.config.ts:14` |
| `testTimeout` | `15_000` | `vitest.config.ts:16` |
| `setupFiles` | `["./src/__tests__/setup/cleanup.ts"]` | `vitest.config.ts:17` |

Measured Vitest phase totals from CI `quality` logs:

| Run | Commit | Files / Tests | Wall-clock | `transform` | `setup` | `import` | `tests` | `environment` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `45593318635` (fail) | `f4af3901` | 347 / 3,460 | **645.58s** (10m46s) | 26.70s | 52.94s | 463.88s | 1690.85s | 280.20s |
| `45811442776` (pass) | `f6d05d93` | 348 / 3,468 | **404.44s** (6m44s) | 17.01s | 30.07s | 261.76s | 1101.88s | 165.89s |

Three measured cost centers stand out inside Vitest:
1. **`jsdom` creation + isolated module imports:** With `isolate: true` and `environment: "jsdom"` applied globally, Vitest paid **165.89s-280.20s** of worker CPU time creating `jsdom` environments and **261.76s-463.88s** re-importing modules across 348 files.
2. **Global 60ms `afterEach` sleep in `src/__tests__/setup/cleanup.ts:77-82`:** `cleanup.ts` imports `cleanup` from `@testing-library/react` (`cleanup.ts:1`), registers DOM shims (`ResizeObserver`, `IntersectionObserver`, `HTMLCanvasElement.getContext`, `window.matchMedia`, `window.scrollTo`, `HTMLElement.getAnimations`), mocks `@paper-design/shaders`, and runs `afterEach(async () => { cleanup(); await new Promise((resolve) => setTimeout(resolve, 60)); })` after **every test** in all 348 files — even files with `// @vitest-environment node`. Across 3,468 tests, that single `setTimeout(60)` adds **208.1 seconds** of pure wait time (~52s wall-clock across 4 workers). The comment cites `input-otp` timers, yet `input-otp` is only imported by `src/components/ui/input-otp.tsx:5` and `src/components/workspace/invitation-access-drawer.tsx:7`.
3. **Slow individual test files (run `45593318635`):** `src/__tests__/config/local-runtime.test.ts` alone took **199.5s (3m20s)** across 48 tests that spawn `git init`, `scripts/local-dev.ts`, and `script` PTY processes. Next slowest were `convex/sources/sources-instruction-capacity.test.ts` (53.5s), `components/workspace/connected-start-workspace.test.tsx` (53.1s), `convex/execution/workbench-native-interface.test.ts` (50.5s), `convex/execution/pi-native-transport.test.ts` (48.0s), `convex/sources/sources-handoff-capacity.test.ts` (45.4s), `convex/admin/model-configuration.test.ts` (39.2s), and `benchmarks/source-quality-study.test.ts` (36.7s).

Other steps inside `pnpm check` in `quality` (run `45593318635` / `45811442776`): `agent-skills:check` (~1s), `docs:check` (~0.3s), `design:check` (~0.1s), `typecheck` (~37s), `lint` (~25s), `format:check` (~2.5s), `test:protocol` (~14s), and `vite build` (~4s total on `45811442776`).

#### Testing Patterns

`vitest.live.config.ts:1-17` spreads `vitest.config.ts` and overrides `include` to `src/__tests__/live/**/*.contract.test.ts` gated by `RUN_LIVE_PROVIDER_TESTS=1`. `pnpm test:protocol` runs 7 `.test.mjs` files under `src/__tests__/config/` via Node's built-in `node --experimental-strip-types --test` runner (`package.json:25`).

---

### 3. All 286 `.test.ts` files are DOM-free while only 62 `.test.tsx` files require `jsdom`

Scanning all 348 non-live Vitest files under `src/__tests__/**/*.test.{ts,tsx}` yields:

| Category | File count | Notes |
| --- | --- | --- |
| `.test.tsx` (React / DOM suites) | **62** | All under `components/` (48), `routes/` (8), `design-system/` (3), `hooks/` (3) |
| `.test.ts` with DOM API references | **0** | Zero `.test.ts` files reference `@testing-library/*`, `document.*`, `window.*`, `localStorage`, `sessionStorage`, `HTMLElement`, `ResizeObserver`, or `IntersectionObserver` |
| `.test.ts` with `@vitest-environment node` | **21** | 11 in `config/`, 9 in `benchmarks/`, 1 in `e2e/` |
| `.test.ts` defaulting to `jsdom` | **265** | Includes all 244 `convex/` files (52 using `convex-test`), `lib/` (8), `config/` (5), `tooling/` (3), `benchmarks/` (1), `routes/` (1), `components/` (1), `e2e/` (1), `helpers/` (1) |

Only two `.test.ts` files import from `@/components`, `@/hooks`, or `@/routes`: `src/__tests__/convex/execution/agent-identities.test.ts` and `src/__tests__/routes/source-review-search.test.ts`. `vitest.config.ts:5` provides `resolve: { tsconfigPaths: true }` (resolving `@/*`, `@convex/*`, `@evaluations/*`, `@scripts/*`, `@preview/*`, `@assets/*` from `tsconfig.json:35-42`), and `vitest.config.ts:10` sets `execArgv: ["--no-experimental-webstorage"]` so Node 26's experimental `localStorage` does not collide with `jsdom`.

#### Testing Patterns

`src/__tests__/setup/cleanup.ts:31-75` already guards its DOM shims with `typeof HTMLCanvasElement !== "undefined"`, `typeof window !== "undefined"`, and `typeof HTMLElement !== "undefined"`, but unconditionally imports `@testing-library/react`, mocks `@paper-design/shaders`, and registers the 60ms `afterEach` hook for every file regardless of environment.

---

### 4. Playwright installs full Chromium in 8 jobs even though all suites launch headless Chromium

| CI Job | Install command | Playwright config & launch | Spec files |
| --- | --- | --- | --- |
| `preview-service` (`quality.yml:58`) | `npm exec -- playwright install --with-deps --only-shell chromium` | `services/playwright-browser/src/stealth.ts:36-44` (`headless: true`, `playwright@1.62.1`) | 1 (`src/__tests__/services/preview-egress.spec.ts`) |
| `workbench-ui` ×4 (`quality.yml:86`) | `pnpm exec playwright install --with-deps chromium` | `workbench-ui.playwright.config.ts:1-24` (default headless Chromium, no `channel`, no `headless: false`; `@playwright/test@1.62.1`) | 26 (`src/__tests__/design-system/workbench-ui/browser/*.spec.ts`) |
| `browser-e2e` ×4 (`quality.yml:115`) | `pnpm exec playwright install --with-deps chromium` | `playwright.config.ts:63-68` (`devices["Desktop Chrome"]`, default headless Chromium) + `e2e/global-setup.ts:117` (`chromium.launch()`, headless) | 13 (5 in `e2e/*.spec.ts` + 8 in `src/__tests__/e2e/*.spec.ts`) |

None of the three suites sets `headless: false` or `channel: "chrome"`. In `quality.yml`, `preview-service` installed Chromium headless shell in **12-16s**, while full Chromium installs in `workbench-ui` and `browser-e2e` took **16-40s** normally and spiked to **120s** in `workbench-ui (1)` on run `45811442776`.

#### Testing Patterns

`workbench-ui.playwright.config.ts:17-23` starts its own Vite dev server (`workbench-ui.vite.config.ts` on `127.0.0.1:3002`) with `workers: process.env.CI ? 2 : 1` and `retries: 0`. `playwright.config.ts:36-45,69-70` runs `fullyParallel: true`, `workers: 2` (`WORKBENCH_E2E_WORKERS: 2`), `retries: 1` in CI, and `e2e/global-setup.ts`, which launches Chromium once per shard on `GITHUB_ACTIONS === "true"` to seed default models via the admin UI before tests start.

---

### 5. Green HEAD CI runs take 8m28s across 10 jobs, dominated by `browser-e2e (4)` and `quality`

Measured job timings on the green HEAD run (`45811442776`, commit `f6d05d93`, total wall-clock 8m28s, total runner time 43.7m):

| Job | Queue | Setup (`checkout` + `pnpm` + `node` + `install`) | Chromium | Backend init | Tests / Checks | Total run |
| --- | --- | --- | --- | --- | --- | --- |
| `browser-e2e (4)` | 2s | 28s | 20s | 20s | **433s** (9 tests, 6.6m) | **505s** (8m25s) |
| `quality` | 2s | 26s | — | — | **456s** (Vitest 404s) | **485s** (8m05s) |
| `browser-e2e (3)` | 2s | 29s | 22s | 19s | 277s | 354s (5m54s) |
| `browser-e2e (2)` | 2s | 27s | 20s | 22s | 197s | 271s (4m31s) |
| `browser-e2e (1)` | 2s | 32s | 40s | 15s | 165s | 261s (4m21s) |
| `workbench-ui (1)` | 2s | 30s | **120s** | — | 105s | 260s (4m20s) |
| `workbench-ui (2)` | 2s | 31s | 38s | — | 86s | 163s (2m43s) |
| `workbench-ui (3)` | 2s | 30s | 21s | — | 94s | 150s (2m30s) |
| `workbench-ui (4)` | 2s | 35s | 20s | — | 78s | 139s (2m19s) |
| `preview-service` | 1s | 9s (`npm ci` 1s) | 16s | — | 6s | 35s |

Key structural facts from both runs:
- **`pnpm` cache works:** `actions/setup-node` with `cache: pnpm` reuses the pnpm store; `pnpm install --frozen-lockfile` takes **5-9s** across all 9 pnpm jobs (and `npm ci` in `preview-service` takes **1s**).
- **Queue spikes under 10-job concurrency:** In run `45593318635`, `workbench-ui (1)` queued **158s** and `browser-e2e (2)` queued **119s** waiting for GitHub-hosted runners. In run `45811442776`, queue times were 1-2s.
- **Shard imbalance in `browser-e2e`:** Playwright splits the 13 spec files across 4 shards statically. Shard 4 received `start-workbench.spec.ts`, `workbench-interrupted-display.spec.ts`, `workbench-model-controls.spec.ts`, and `workspace-layout.spec.ts` (9 tests taking 50s-2.1m each = 396s test execution + ~37s startup = 433s), while shard 1 finished in 165s (2.6x faster).
- **`workbench-ui` setup vs test ratio:** The 4 shards spent 363s total running tests (78-105s per shard) and 325s combined in repeated setup + Chromium installs (50-150s per shard).
- **Duplicated YAML:** `.github/workflows/quality.yml` repeats the 4-step checkout/pnpm/node/install sequence in `quality` (`:20-35`), `workbench-ui` (`:72-84`), and `browser-e2e` (`:101-113`), plus Chromium install in `workbench-ui` (`:85-86`) and `browser-e2e` (`:114-115`).

#### Testing Patterns

No workflow lint or YAML test validates `.github/workflows/quality.yml`.

---

### 6. Guardrails enforce `scripts/local-dev.ts` contracts and resource policies, not workflow YAML

| Guardrail | Files checked | Relevant assertions |
| --- | --- | --- |
| `scripts/check-resource-policy.ts` (`pnpm lint`) | `convex/`, `src/`, `scripts/`, `services/` (includes `scripts/local-dev.ts` and `services/playwright-browser/src/**`; excludes root `*.config.ts` and `.github/**`) | Rejects caller-local numeric literals in `setTimeout`/`setInterval`/`AbortSignal.timeout` and `timeout`/`timeoutMs`/`maxBytes`/`maxTokens` defaults; requires `// resource-policy-exception: <reason>` on intentional exceptions (`check-resource-policy.ts:326-466`) |
| `scripts/sync-resource-policy.ts --check` (`pnpm lint`) | `services/playwright-browser/src/resource-policy.generated.json` | Must match `PREVIEW_POLICY` from `convex/resourcePolicy.ts` (`sync-resource-policy.ts:4-20`) |
| `scripts/check-imports.ts` (`pnpm lint`) | All `.ts`/`.tsx` from root except `services`, `.agents`, `dist`, `build`, `_generated` | Includes `vitest.config.ts`, `playwright.config.ts`, `workbench-ui.playwright.config.ts`, `scripts/local-dev.ts`; forbids `../` in `import.meta.glob`/dynamic `import()` and `.js` extensions on TS files |
| `src/__tests__/config/local-runtime.test.ts` (`pnpm test`) | `scripts/local-dev.ts`, `scripts/local-runtime.ts`, `vite.config.ts` | Asserts exact `convex dev` argv in `test:e2e` (`:819-857`), env vars (`:859-922`), port/version pinning, lock serialization, `SIGINT` shutdown on timeout (`:1624-1670`) |
| `tsconfig.json:2-11` (`pnpm typecheck`) | `src/**`, `scripts/**`, `e2e/**`, `vitest.config.ts`, `workbench-ui.playwright.config.ts` | Excludes root `playwright.config.ts` |
| `biome.json:10-24` (`pnpm lint`, `pnpm format:check`) | Root `*.ts`, `scripts/**`, `services/playwright-browser/src/**` | Formats and lints all TS/JS config and script files |
| `AGENTS.md:238`, `context/TECH.md:15,17,19` | Documentation references | Document 4-shard Playwright CI, `.node-version`, `vitest.config.ts`, and `scripts/local-dev.ts` contracts |

Repo-wide search across `src/__tests__/config/*.test.mjs`, `scripts/check-*.ts`, and `scripts/sync-*.ts` confirmed zero assertions targeting `.github/workflows/quality.yml`, `vitest.config.ts`, `playwright.config.ts`, or `workbench-ui.playwright.config.ts`.

## Code References

Key files covering the researched CI pipeline (exhaustive for workflow, test configs, and startup orchestration):
- **CI Workflow:** `.github/workflows/quality.yml:1-124` (4 job definitions, matrix sharding, cache setup, Playwright/Convex commands).
- **Package Scripts:** `package.json:10-51` (`check`, `test`, `test:protocol`, `test:e2e`, `workbench-ui:check`, `test:preview`, `typecheck`, `lint`).
- **Vitest Configuration & Setup:** `vitest.config.ts:1-19`, `vitest.live.config.ts:1-17`, `src/__tests__/setup/cleanup.ts:1-82`.
- **Local Runtime & E2E Startup:** `scripts/local-dev.ts:39-42, 211-372, 448-505, 775-811, 922-940`, `scripts/local-runtime.ts:418-439, 1014-1068`, `convex/resourcePolicy.ts:484-502` (`LOCAL_RUNTIME_POLICY`), `vite.config.ts:15-56`.
- **Playwright Suites:** `playwright.config.ts:1-71`, `workbench-ui.playwright.config.ts:1-24`, `e2e/global-setup.ts:29-147`, `e2e/global-teardown.ts:7-15`, `services/playwright-browser/src/stealth.ts:36-44`, `services/playwright-browser/src/server.ts:375-386`.
- **Guardrails & Tests:** `src/__tests__/config/local-runtime.test.ts:1-2459`, `src/__tests__/config/resource-policy.test.ts:18-42`, `scripts/check-resource-policy.ts:14-53, 326-467`, `scripts/sync-resource-policy.ts:4-20`, `scripts/check-imports.ts:5-14, 121-170`.
- **CI Run Evidence:**
  - Failing PR #2 run (`f4af3901`): `https://github.com/Decode-Disc/agentic-resilience-workb/actions/runs/45593318635` (jobs `139132838397`, `139132839003`, `139132838976`).
  - Green HEAD run (`f6d05d93`): `https://github.com/Decode-Disc/agentic-resilience-workb/actions/runs/45811442776`.

## Architecture Documentation

```text
.github/workflows/quality.yml
├── quality (1 runner) ─────────▶ pnpm check ─▶ checks + tsc + biome + test:protocol + vitest (348 files, jsdom, 4 workers) + vite build
├── preview-service (1 runner) ─▶ npm ci + playwright --only-shell chromium + tsc + preview-egress.spec.ts
├── workbench-ui (4 shards) ────▶ pnpm install + playwright chromium + workbench-ui:check (26 specs, 2 workers/shard)
└── browser-e2e (4 shards) ─────▶ pnpm install + playwright chromium + convex dev --once --typecheck disable
                                  └─▶ scripts/local-dev.ts test:e2e
                                       ├─▶ convex dev --start "pnpm exec vite dev" (watch mode, typecheck enabled)
                                       ├─▶ waitForBackend (600s) + waitForOrigin("web", 600s)
                                       └─▶ playwright test --shard=N/4 (13 specs, 2 workers/shard, global-setup seeds models)
```

All local-runtime timeouts are centralized in `convex/resourcePolicy.ts` (`LOCAL_RUNTIME_POLICY`) and enforced by `scripts/check-resource-policy.ts`. `scripts/local-dev.ts` serializes startup with `flock`, binds worktree-scoped ports, and delegates web server launch to `convex dev --start` when starting both Convex and Vite together.

## Open Questions

1. **Exact cause of the 94 Convex TS errors on `f4af3901`:** On `f4af3901` (run `45593318635`), `tsc --noEmit -p convex/tsconfig.json` passed in `quality`, while `convex dev`'s `tsc --project convex` failed in `browser-e2e` immediately after `convex dev --once --typecheck disable` ran codegen; on HEAD `f6d05d93` (after `@convex-dev/agent` was retired in `f1eabf3`), both `pnpm convex:check` and `browser-e2e` pass. Whether `convex dev --once` generated different `_generated/` types on `f4af3901` was not reproduced on that older commit.
2. **Per-test duration breakdown on `f6d05d93` for `local-runtime.test.ts` and `convex-test` suites:** The top-25 slow-file table was parsed from run `45593318635` (645.6s Vitest total); on green HEAD `45811442776`, Vitest dropped to 404.4s total, and per-file durations on HEAD have not been parsed separately.
