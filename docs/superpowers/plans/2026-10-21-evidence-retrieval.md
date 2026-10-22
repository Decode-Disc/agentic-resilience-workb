# Evidence retrieval implementation

Date: 2026-10-21

Authority: accepted implementation request and [ADR-025](../../decisions/025-use-versioned-scoped-evidence-retrieval.md). Product invariants and existing surfaces are preserved. Production activation is gated, remote deployment and commits are excluded.

**Interpretation and delivery update, 2026-10-22:** the steps and results below preserve the original implementation record. The [Snowflake correction](../../verification/2026-10-21-evidence-retrieval-repair.md#interpretation-correction-2026-10-22) shows that exact-reference misses can coexist with useful equivalent evidence in the prepared input. The historical scores and 10/12 reviewed-reference count are unchanged; they do not establish useful-evidence completeness or select a definitive winner. Later [scope and source-review corrections](../../verification/2026-10-22-source-review-corrections.md) are separately verified. Follow the [roadmap](../../ROADMAP.md#recorded-delivery-state-2026-10-22) for open work. No historical provider allowance, activation or delegation authority is renewed by this plan.

1. Add structured full-capture candidates, exact span validation, searchable context and pinned materialization. Keep the legacy extractor unchanged by default. Demonstrate late evidence and separated table context through failing then passing tests.
2. Add derived Convex rows with native text and 1024-dimensional vector indexes. Scope every operation to the active authorized preparation, run, revision, capture hash and policy. Share selection and context logic between qualification and comparison.
3. Add bounded direct Cloudflare embeddings, exact-profile cache, cumulative byte reservations, provider telemetry, cancellation/generation fences and explicit lexical degradation. Test limits and failures with external I/O mocked only.
4. Freeze complete-evidence references from the existing 32 captures and 16 controls, extend evaluation CLI selectors, compare native lexical and hybrid ranking without generative calls, and record costs, recall, omissions and provenance. Respect the USD 0.10 evaluation ceiling.
5. Integrate the winning method for new versioned preparations, prioritize pinned references when approved evidence is materialized, and preserve historical preparation identities. Runtime embedding allowance is USD 0.01 per dossier.
6. Verify focused behavior, native backend ranking, bounded real provider output, protected approval/materialization at desktop and mobile, and pnpm check once stable. Keep incomplete gates explicit and do not activate prematurely.

Execution progress and original-file hashes are retained in /tmp/evidence-retrieval-implementation-20261021. Work directly in the existing feature branch because prerequisite source-preparation work is uncommitted. Preserve unrelated changes and local services. Review locally without implementation or review subagents.


## Historical implementation outcome

The scoped implementation and native comparison are complete. Structured lexical retrieval is selected because it preserved all required references in 17 of 32 conditions, compared with 12 of 32 for hybrid retrieval. The final candidate passed 1,123 tests, client/backend typechecking and the production build. Protected desktop and mobile corpus approval/materialization checks passed. Live activation remains deferred by the existing global-check blockers and disabled preparation workflow. See the [verification report](../../verification/2026-10-21-evidence-retrieval.md) for frozen evidence, resource accounting, limitations and exact validation results.

## Subsequent correction

The definitive interpretation of that technology choice was withdrawn after diagnosis showed that final selection discarded retrieved references and several historical references were not comparable evidence for their queries. The user then authorized passage-retention repair, reference review and protected-flow verification without new paid calls or remote deployment. The repair uses a 32-KiB context-expansion budget, preserves exact provenance and measures comparable evidence separately from context and unresolved controls. Both modes retain 10 of 12 comparable conditions on the saved native rankings. This is not a new model-answer evaluation or an independent held-out benchmark. See the [repair report](../../verification/2026-10-21-evidence-retrieval-repair.md) for current results and remaining gates. The earlier implementation outcome remains historical evidence, not the current acceptance decision.
