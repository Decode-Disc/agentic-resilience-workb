---
type: design-review
flow: tdd
status: rechecked-watch
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "6043a64af02577cb3aaf13eb2a3ce1e8804f7060"
---

# Oracle Review: Sources Harness Efficiency

Oracle reviewed the first program-design draft using Codex GPT-6 Astra at xhigh effort. The verdict was **BLOCK**: three high-severity and one medium-severity blocking findings, plus three medium-severity nonblocking watches. The system direction remained viable. This report does not convert the revised design into an independently approved implementation.

The [complete original report](validation/sources-efficiency-tdd-review/oracle-report.md) is preserved verbatim. Its TDD line citations refer to the [reviewed snapshot](validation/sources-efficiency-tdd-review/reviewed-tdd.md), SHA256 `7ea0a081f78f29959a00dc73982dec5ebd884060537253d2013876f7310b5c42`, rather than the subsequently revised document. The [current TDD](29-tdd-sources-harness-efficiency.md) contains the parent's corrections. The [review mandate](validation/sources-efficiency-tdd-review/request.json) records the delegated task and constraints.

## Findings and Disposition

| Finding | Original severity and decision | Evidence and consequence | Revision in the TDD |
| --- | --- | --- | --- |
| Pi truncates an accepted large page | High, blocking | The native tool default is 51,200 bytes; the application result can reach 65,536 bytes before its success wrapper. A retained successful page could reach the model as invalid truncated JSON. | Derive shared native output limits from the common result capacity plus exact rendered-envelope overhead; cover both history tools and the real native transcript. |
| Unchanged consultation version breaks old receipt replay | High, blocking | Same-version dispatch recomputes the current research-state pin before returning the recorded success; adding progress changes that pin. | Advance `consult_run_state` to version 3, use existing completed-old-version replay, and explicitly refuse/re-admit pending old requests. Preserve historical validation and bytes. |
| A targeted cursor loses its event identity | High, blocking | Old continuation pins omit the reference; page resolution takes it only from the immediate predecessor. A third page can select the mission index instead of a cross-mission dossier context event. | Carry resolved frontier and target in each new continuation pin. Resolve legacy predecessor chains with authority and consistency checks; never infer chronological browsing from an absent old reference. Test a colliding sequence across at least three pages. |
| Compact counts omit attributed-only arguments | Medium, blocking | The actual effective-use tally has four categories; the draft represented only three. | Reuse the existing `effectiveUses` tally and validator, including `attributed_argument_only`, with restriction-sensitive consumer tests. |
| Terminal settlement has additional gates | Medium, watch | Session-prefixed admission, settlement marking and retry handling are currently conversation-gated, not only lookup/eligibility. | Specify session identity at admission, terminal lookup, worker close success/failure and structured-session retry outcomes together. Preserve conversation-only queue behavior and test four crash boundaries. |
| Small summaries can duplicate expensive reads | Medium, watch | Sources observations create their own reader; Workbench loads research state and contributions separately. | Share one transaction-local reader and loaded preparation/capture/contribution facts across detailed and compact projections. Measure rows/bytes through both contexts and standalone consultation. |
| Profile regeneration discards old keys | Medium, watch | The generator replaces its map and common result-schema changes affect profile identity even for retained definitions. | Preserve the baseline, explicitly retain required historical keys only under the same SDK tuple, measure new keys, and verify old lookup plus configuration refresh/pin behavior. |

All seven concerns were accepted by the parent after inspecting the cited code. None is silently downgraded or treated as an implementation fix. The original BLOCK is preserved as the first review verdict. The subsequent independent recheck returned WATCH with no remaining architectural blocker; all four blocking findings are resolved at design level.

## Checks and Limits

Oracle inspected project references, request/research/design documents, current implementation and test source, and installed Pi Durable/Pi AI/Chord 1.4.0. It verified the original document hash and clean tracked checkout before and after review. It ran no tests, provider calls, backend operations or profile generation and changed no files. Its failure scenarios are source-derived, not runtime reproductions.

The parent rechecked the cited ownership and execution order. A small offline probe executed the installed Chord `boundOutput` function used by Pi's final tool-result path. The [retained result](validation/sources-efficiency-tdd-review/output-bound-probe.json) shows that a 65,536-byte canonical value becomes 65,563 bytes in the current success envelope: Pi's 51,200-byte default truncates it, and setting only 65,536 still drops 27 bytes. The derived 65,563-byte allowance preserves this fixture exactly. This verifies that library boundary and the wrapper calculation; it does not exercise the complete native tool lifecycle, authority, receipt adoption or model understanding.

Only ignored design/review documents and supporting evidence changed. Full native delivery, historical cursor replay, crash recovery, profile migration and query-cost regressions remain implementation checks. No production correction, live qualification or semantic acceptance is claimed.

## Independent Recheck

The [complete recheck report](validation/sources-efficiency-tdd-review/oracle-recheck-report.md) reviewed the [frozen revised design](validation/sources-efficiency-tdd-review/rechecked-tdd.md), SHA256 `56e496051d36bb4713c9281574a4f6446d2db12c259d0e7eb109f665e5e12e62`, on the same repository HEAD. Oracle confirmed all four original blockers resolved in the design. The three watches remain open until implementation verifies native terminal settlement, actual projection rows/bytes, and historical/current profile behavior. This is permission to submit the design for user approval, not runtime acceptance or implementation authorization.

The parent incorporated two final refinements requested by the recheck: preserve the cancelled non-conversation writer fence and test explicit failure without false settlement; test profile refresh with unchanged additive catalogue revisions as well as changed revisions, including missing database profiles. Those refinements were checked against `piStore.writer`, `nativeProfileCatalogueRevision` and `agentInputByteLength`. No new mechanism or design direction was introduced. The frozen reviewed snapshot remains unchanged; the current TDD includes these refinements.

The recheck was source inspection only. Oracle ran no tests, profile generation, backend operations, provider calls or qualification and changed no files. Full native delivery, historical restoration, crash recovery, profile refresh, measured read costs and model usefulness remain unverified. The user approved the revised program design on 2026-11-21. Both design sections are now approved; the three implementation watches remain open, and implementation has not been authorized.
