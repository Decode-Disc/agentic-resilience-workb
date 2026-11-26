---
type: research-questions
repos:
  - identifier: "Decode-Disc/agentic-resilience-workb"
    sha: "ecb2a357fa1035577f4efb2b140436b00e66bad7"
flow: tdd
---

# Research Questions: Evaluation Review and Closeout

## Key Context Pointers

- `scripts/evaluations/workbench-browser/campaign-review.ts`
- `scripts/evaluations/workbench-browser/campaign.ts`
- `scripts/evaluations/workbench-browser/protocol.ts`
- `convex/qualificationCampaigns.ts`
- `convex/qualificationCampaignPolicy.ts`
- `src/__tests__/config/qualification-campaign.test.mjs`
- `src/__tests__/config/qualification-v2.test.mjs`
- `src/__tests__/convex/execution/qualification-campaign.test.ts`
- Recorded campaign evidence: `/home/abdwhb/.cache/workbench-evaluations/sources-efficiency-ce843ce-20261125-ready` (`qualification-summary.json`, `qualification-conclusion.md`, `close.log`, `lots/lot-1/automated-review-*`, `lots/lot-1/observations/before-cleanup-*`)

## Questions

1. **Pi automated review loop, inputs, and context growth:** In `scripts/evaluations/workbench-browser/campaign-review.ts`, what prompt, tools, and frozen files does the Pi reviewer receive, how does its turn loop handle tool results and provisional `automated-review-report.md` writes, and what caused the `sources-efficiency-ce843ce-20261125-ready` review to spend 27 turns, 5 report revisions, and 1.27 MB on a lot where 8 of 12 scenarios did not run?
2. **Reviewer model, reasoning effort, and authority configuration:** Across `scripts/evaluations/workbench-browser/campaign-review.ts`, `convex/qualificationCampaignPolicy.ts`, and `scripts/evaluations/workbench-browser/campaign.ts`, how are the Pi reviewer's model, reasoning effort, request/cost allowance, and timeout configured and validated, and which parts are frozen in the campaign manifest versus overridable per invocation?
3. **End-of-lot observation export (`before-cleanup-*`):** In `scripts/evaluations/workbench-browser/campaign.ts` (around line 2301) and its Convex query owners, what queries, pagination loops, and file writes run during `before-cleanup-*` export and cleanup, and what accounts for the 4 min 46 s duration between `23:41:21` and `23:46:07` UTC?
4. **Evidence indexing, template freezing, and hash drift:** In `scripts/evaluations/workbench-browser/campaign.ts` (around lines 132–210 and 976–1045), what files are hashed into `evidence-index-<hash>.json` and `review-template-<hash>.json`, when does re-indexing occur, and why did `sources-efficiency-ce843ce-20261125-ready` produce two distinct hashes (`2cec9ebe...` before review and `02913a30...` during closeout)?
5. **Assessment adoption and `--campaign close` recovery:** In `scripts/evaluations/workbench-browser/campaign.ts` (`runCampaignReviewStage` and `submit-assessment` around lines 976–1050 and 1588–1640) and `convex/qualificationCampaigns.ts`, how does assessment adoption interact with the local Convex backend, what state is persisted before and after `submit-assessment`, and what fails when the backend stops mid-closeout?
6. **Existing test coverage and protected invariants:** Across `src/__tests__/config/qualification-campaign.test.mjs`, `src/__tests__/config/qualification-v2.test.mjs`, and `src/__tests__/convex/execution/qualification-campaign.test.ts`, what behaviors and integrity invariants are currently asserted for Pi automated review, observation export, evidence hashing, and closeout recovery?
