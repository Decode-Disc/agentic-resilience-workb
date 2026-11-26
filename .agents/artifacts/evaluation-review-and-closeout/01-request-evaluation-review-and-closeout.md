---
type: request
repos:
  - identifier: "Decode-Disc/agentic-resilience-workb"
    sha: "ecb2a357fa1035577f4efb2b140436b00e66bad7"
---

# Original Request: Evaluation Review and Closeout Improvements

Improve the evaluation side (independent of product fixes in `sources-partial-reading`) based on the measured defects from the completed `sources-efficiency-ce843ce-20261125-ready` campaign:

1. **Pi automated review cost and context growth:** the review consumed $3.36 across 27 requests (95.7% of total campaign spend vs. $0.15 for all 65 workflow calls), rewrote `automated-review-report.md` 5 times, and grew payloads to 1.27 MB even though 8 of 12 scenarios never ran.
2. **End-of-lot observation export latency:** exporting `before-cleanup-*` observations and restoring configuration took 4 min 46 s (`23:41:21` to `23:46:07` UTC).
3. **Closeout and assessment adoption resilience:** `--campaign close` failed at `submit-assessment` (`operation_failed`) when the local Convex backend stopped (`watcher exit 143`), requiring manual restart and re-adoption, and post-export billing recovery produced a second `evidence-index` / `review-template` hash (`2cec9ebe...` vs. `02913a30...`).

Follow the RPI TDD flow (Research questions -> Research -> TDD) while preserving qualification evidence integrity, frozen review boundaries, and existing test invariants.

## Source Pointers

- `scripts/evaluations/workbench-browser/campaign-review.ts`
- `scripts/evaluations/workbench-browser/campaign.ts`
- `scripts/evaluations/workbench-browser/protocol.ts`
- `convex/qualificationCampaigns.ts`
- `convex/qualificationCampaignPolicy.ts`
- `src/__tests__/config/qualification-campaign.test.mjs`
- `src/__tests__/config/qualification-v2.test.mjs`
- `src/__tests__/convex/execution/qualification-campaign.test.ts`
- Local campaign evidence: `/home/abdwhb/.cache/workbench-evaluations/sources-efficiency-ce843ce-20261125-ready` (`qualification-summary.json`, `qualification-conclusion.md`, `close.log`, `lots/lot-1/`)
