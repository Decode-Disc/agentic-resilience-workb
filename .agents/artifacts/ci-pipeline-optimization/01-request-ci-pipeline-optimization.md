---
type: request
repos:
  - identifier: "Decode-Disc/agentic-resilience-workb"
    sha: "f6d05d9333254b7904b33ea956a283b194dda32c"
---

# Original Request: CI Pipeline Optimization

Reduce CI wall-clock time and wasted runner minutes on pull requests, starting from the bottlenecks observed in PR #2's GitHub Actions run (13m32s total).

Desired outcomes:
1. Fix the `browser-e2e` Convex startup failure and make startup fail fast instead of waiting ~10 minutes per shard for the web startup timeout.
2. Reduce the `quality` job's Vitest execution time (10m46s in PR #2).
3. Evaluate and streamline duplicated workflow setup, Chromium installation, caching, and Playwright sharding (`workbench-ui` and `browser-e2e`) based on measured timings.

## Source Pointers

- `.github/workflows/quality.yml`
- `package.json`
- `vitest.config.ts`
- `playwright.config.ts`
- `workbench-ui.playwright.config.ts`
- `scripts/local-dev.ts`
- `e2e/global-setup.ts`
- `https://github.com/Decode-Disc/agentic-resilience-workb/actions/runs/45593318635`
- `https://github.com/Decode-Disc/agentic-resilience-workb/actions/runs/45593318635/job/139132839003`
- `https://github.com/Decode-Disc/agentic-resilience-workb/actions/runs/45593318635/job/139132838397`
- `https://github.com/Decode-Disc/agentic-resilience-workb/actions/runs/45593318635/job/139132838976`
