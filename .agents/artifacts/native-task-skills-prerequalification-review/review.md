# Native task skills and document dates: pre-qualification review

Date: November 19, 2026. Scope: current uncommitted implementation on `sources-workflow-no-legacy`, based on `5d7e35b1`, including the subsequent independent-review corrections. This is a direct read-only code review against the accepted design and implementation plan. No production edits, publication or paid calls were made during this review. Unrelated frontend and review-transport changes were excluded.

## Disposition

No new blocking implementation defect was identified in the reviewed scope. The inspected code and rerun regressions support the technical integration of Workbench 7/Sources 5, native on-demand skill reading, retained historical definitions, immutable package resolution, shared operation admission/settlement, and documentary date reconciliation. This finding does not establish semantic improvement or general reliability.

The proposed paired qualification is not yet executable under its own comparison contract. `docs/verification/native-task-skills-qualification-protocol.md` explicitly records that the evaluator lacks the control binding retaining prior methods while exposing the same admitted reader. The inspected fixture/catalogue surfaces still provide production versions and reader probes, not that paired binding. Complete and deterministically verify observation/tool parity before freezing and authorizing the 24-execution comparison. This is a disclosed evaluation prerequisite, not a newly discovered production regression.

## Inspection

Inspected native skill contracts, resource packaging and hash checks, path admission and native reader adaptation, scheduled input authorization and retained-result validation, context-read repetition settlement, agent catalogue composition, Workbench version/phase/completion restrictions, Sources instructions and runtime methods/examples. Inspected shared date extraction/reconciliation, HTML metadata preservation, public-read continuation and Sources capture metadata. Compared the reported eleven corrections with their code and regression coverage, including equivalent EOF reads, malformed inputs, old-package retention and historical instruction characterization.

The implementation reuses Pi discovery/catalogue/reading and the existing Convex scheduled lifecycle. Pure schemas are separated to avoid catalogue initialization cycles. There is one shared reader operation and one date reconciliation owner; no new execution engine, filesystem fallback or per-agent chronology subsystem was found. On-demand teaching effectiveness remains a qualification question.

## Checks run in this review

- First targeted Vitest run: 103 tests passed across five matched suites: agent skills, document dates, public-context integration, operation conformance and Sources retrieval. The command also named a nonexistent `operation-results.test.ts`; Vitest did not execute such a suite, and it is not counted as coverage.
- Second targeted Vitest run: 37 tests passed across seven suites: Workbench framing completion/continuity, Sources compaction, native profile identity/input capacity, documentary reading context and HTML normalization/passages.
- Native skill packaging process tests: 2 passed, including deterministic relocated output and adverse metadata/resource/immutability cases.
- `pnpm agent-skills:check`: passed.
- `pnpm convex:check`: passed.
- `node --experimental-strip-types scripts/check-execution-boundaries.ts`: passed.
- Scoped `git diff --check`: passed for the reviewed tracked production files.
- `pnpm docs:check`: 57 Markdown files, 348 local links, zero errors; existing TECH word-count advisory remains.

Total executed behavioral checks: 140 Vitest tests plus 2 packaging process tests. No tests were added or weakened for this review.

## Limits

The full CI aggregate, frontend checks/build, browser CI, deployed-reader probes and cloud deployment were not rerun. Prior full-check and local-publication results are implementation-report evidence, not fresh observations from this review. The reviewed tests use deterministic external/model responses and prove integration behavior, not economic judgment. Qualification still needs the paired evaluator binding, frozen held-out inputs, exact model/effort/provider choices, and a separately authorized execution/review budget.
