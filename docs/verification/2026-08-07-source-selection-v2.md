# Source Selection v2 Verification

> **Dated evidence.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

## Automated Coverage

- Table-driven policy tests cover SEC form roles and issuer-CIK conflicts, official company domains, company-matched and unrelated shared IR hosts, institutional independent publishers, qualified partners, Community content, indexes, unverified publishers, canonical and accession duplicates, direct-document preference over an index for the same accession, period-aware identities, annual/interim/material series caps, official-family and independent-producer caps, stable ordering, research-angle tie-breaking, adaptive stopping and analyst-supplied sources.
- Convex tests cover SEC discovery ordering, derived and configured ceilings, v2 proposal persistence, `outdated` drafts, server-side approval blocking, authorization before rebuild I/O, one durable rebuild lease under concurrency, stale-proposal rejection before I/O, bounded provider attempts, retry cycles after a blocked cooldown, disabled paid work as a durable typed outcome, `complete`/`partial`/`blocked` outcomes and preservation of append-only analyst decisions.
- Transport tests prove that a timed-out Exa metadata request aborts its underlying HTTP request before another attempt can begin.
- UI tests cover the rebuild banner, partial and blocked outcomes, approval blocking where required, centralized authority and document labels, selection explanations, proposal tabs, kanban adjustments, source inspection, actionable non-technical copy and absence of the misleading `Independent web source` label.
- The frozen 110-candidate fixture uses typed role-event obligations rather than prose labels and passes the documented precision, recall, exclusion, duplication, contribution and `needs_attention` gates. It satisfies 37 of 37 unique obligations and recommends 37 of 39 candidate rows attached to them; the two omitted rows are alternate URLs for already-covered events.

## Manual Verification

Chrome DevTools AXI verification completed on the local ServiceNow draft at 1440 × 1000 and 390 × 844. The obsolete-policy banner remained legible after its mobile action was changed to a stacked layout, the action exposed a disabled `Rebuilding proposal…` state, the proposal-to-adjustment and back transitions completed without retaining both views, and the kanban columns remained available at both widths.

The metadata-only rebuild completed successfully against the real local action. It replaced the 14-source v1 draft with an immutable v2 proposal containing 7 policy recommendations, 0 `Needs attention` items and 34 alternatives; one pre-existing analyst decision kept the effective included count at 8. Annual, interim and material SEC filings rendered as primary-regulator documents, while specialized forms remained in Alternatives. The rebuilt proposal exposed readable coverage gaps and became approvable without altering the two already-approved local corpora.

A fresh browser page loaded the rebuilt proposal without the transient pagination-cursor warning seen during the first proposal-ID transition. The remaining console 404 was an unrelated missing resource with no source-review failure or analyst-facing error.

## Live Benchmark

The five-company provider benchmark is implemented but intentionally not run by default. Its output is not considered complete until the generated scorecard receives manual labels.

## Independent Review

An expert reviewer re-audited the five prior P1 findings after the final fixes and returned `APPROVE` with zero remaining issues. Its focused review suite passed 56 tests across eight files and independently confirmed the authority/identity boundary, period and duplicate semantics, rebuild concurrency and cancellation controls, typed provider outcomes, UI consequences and benchmark denominator.

## Commands

- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm test --reporter=json --outputFile=/tmp/source-selection-v2-tests-p1-approved.json` — 133 test files and 419 tests passed.
- `pnpm convex:check` — passed against local deployment `local:local-aboul_panga-dd_proto` after the final rebuild-lease schema change.
- `pnpm build` — passed after the final policy, rebuild and UI changes.
- `pnpm check` — reaches and passes typecheck and lint, then stops on five pre-existing formatter differences outside this implementation: `motion-animate-presence.test.tsx`, `motion-animate-presence.tsx`, `workbench-shell.tsx`, `source-proposal-adjustment-board.tsx` and `styles.css`. These user-authored files were preserved.
