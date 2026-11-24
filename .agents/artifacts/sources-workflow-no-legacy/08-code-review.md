---
type: code-review
flow: tdd
status: approved
date: "2026-11-19"
---

# Independent code review

The user explicitly requested code-reviewer review for implementation. One fresh read-only native code-reviewer lane used the fixed GPT-6.1 Sol / xhigh profile because the change affects shared execution, authorization, accounting and persistence. The same reviewer rechecked corrected findings and the final integrated state; no additional specialist lane or implementation delegation was used.

## Final verdict

**APPROVE: no outstanding critical, high, medium or low findings in the inspected code.** The reviewer inspected 73 code/test files plus the owning reference changes against `cf757669701104f835a29fb1f0941d1c78ce3304`. Those file hashes remained unchanged during its final verification; its reported scope digest is `66eed84466b5f94381cafb40499d5871f1ae60f236f3cf098d834b0a87eb322f`.

## Findings and dispositions

| Finding | Verified mechanism and correction |
| --- | --- |
| Start failure could strand a scheduled wait | `beginScheduledExecution` was outside the shared error-settlement block. Its known refusal now settles the retained request before callback execution. |
| Legacy inline requests could not complete | The start boundary now accepts an owned historical running request without a job, exactly once, while preserving generation fences. |
| Contradictory terminal SSE costs could appear reconciled | The terminal-close catch path now preserves billing conflict, reservation and halt state through ledger replay and continuation. |
| Legacy conflict accounting was interpreted as zero | Missing counters remain uninitialized during factual settlement and block new spending or continuation until reconciled. |
| First-input observation confused local HTTP status with provider receipt | Proven non-dispatch takes precedence; a later request replaces the first pointer only after established non-dispatch, never uncertainty. |
| Committed open prefixes were unreadable after a crash | Protected readers now expose an explicit incomplete prefix with stable snapshot/cursor identity. |
| Dossier purge orphaned private diagnostic fragments | Bounded deletion resides in retainedText's existing owner and runs before invocation ownership disappears. No ownership checker exception was added. |
| Append/seal stalls could lose known receipts or exceed authority | Cleanup shares the existing settlement grace, preserves terminal receipt fields and returns typed capture failure. Both stalls have real-time regressions. |
| Generation cancellation could trigger an unhandled provider rejection | The installed provider discarded `reader.cancel`'s Promise. Middleware gives HTTP abort ownership and prevents duplicate downstream cancellation; no global rejection handler masks it. |
| Invalid objects and late diagnostics needed distinct treatment | Canonical text/receipt precede object validation; diagnostic capture remains receipt-bound after cancellation, while domain adoption remains fenced. |
| Fallback hydration optimization could suppress useful wakes | Authority/generation/lease checks precede deferral; new observations, results, rebinds and competing work take normal replay. The reviewer independently probed immediate admission after a deferred wait receives its result. |

The reviewer reported that the root-cause guard passes and established no unresolved masking fallback, authorization bypass or duplicate-dispatch defect.

## Independent verification

The final frozen battery passed 128/128 tests across documentary integration, comparison action, model invocation, documentary transport, journal, qualification and Pi deferred wakes. A separate overlapping Pi/qualification battery passed 42/42, including steering, recovery and exact/missing/changed financial proof. The evaluator suite passed 32/32; focused relay conflict/refusal regressions passed.

Frontend/scripts and backend TypeScript checks passed. Biome checked 73 files with zero errors; three chained-assertion warnings in the comparison tests were verified as pre-existing in HEAD. Documentation, resource-policy generation/checks, execution ownership, imports and scoped patch-integrity checks passed. TECH's word-count warning is advisory. Overlapping counts must not be added.

## Review boundaries

The reviewer changed no source files, started no services and called no live providers. It did not independently execute the implementer's isolated runtime demonstrations, browser qualification or OpenRouter/Arize correlation. The implementer's broader 1,886-test rerun was still pending when this report was returned and is not part of this review's passed count. Final implementation evidence and remaining qualification limits belong to [the consolidated record](09-implementation-complete.md). Later functional changes would require renewed review.
