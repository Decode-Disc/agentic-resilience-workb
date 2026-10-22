# Targeted Source Comparison Implementation Plan

**Recorded continuation, 2026-10-22:** the implementation checkpoint below is historical. Subsequent [live comparisons](../../verification/2026-10-20-source-comparison-live-evaluation.md), [cross-company grouped evaluation](../../verification/2026-10-21-source-quality-second-batch.md), [retrieval correction](../../verification/2026-10-21-evidence-retrieval-repair.md#interpretation-correction-2026-10-22) and [source-review fixes](../../verification/2026-10-22-source-review-corrections.md) preserve both progress and unresolved limits. [ADR-025](../../decisions/025-use-versioned-scoped-evidence-retrieval.md) subsequently extends the retrieval boundary excluded from this original scope. The original worker delegation and 185-call allowance are not renewed. Use the [roadmap](../../ROADMAP.md#recorded-delivery-state-2026-10-22) for remaining acceptance work; the 600-character limit remains deferred and unchanged.

## Goal

Compare useful attributed contributions with relevant primary passages already captured before proposing their use, preserve independent contributions, and prevent known issues from disappearing through requalification. Reduce analyst preparation without adding individual confirmations.

## Plan status and revision date

Authorized bounded implementation, 2026-10-20. The user approved the concrete comparison direction and explicitly requested one implementation worker under the orchestrator's direction and validation. This task is separate from the broader implementation goal, which remains paused. The orchestrator owns this contract, documentation, independent review and browser verification. The worker owns scoped production and test edits. No commit, merge, publication, production deployment, runtime activation or additional paid experiment is authorized.

Implementation checkpoint: the bounded capability is integrated and independently verified with 171 passing relevant tests, client and Convex typechecks, focused Biome and a successful build. The offline retrieval audit preserves its exact inputs and investigator judgments without inference. Repository-wide checks are not fully green, the inspector has an existing return-focus limitation, and live semantic and protected preparation gates remain open. See the [verification report](../../verification/2026-10-20-targeted-source-comparison.md) for exact results and limits. This checkpoint does not resume the broader goal or authorize activation.

## Authoritative requirements and accepted decisions

Read `AGENTS.md`, `PRODUCT.md`, `context/TECH.md`, `convex/_generated/ai/guidelines.md`, ADR-024 and the [accepted comparison direction](../../designs/2026-10-20-known-source-issues-proposal.md). Qualification prepares documentary selection and does not verify truth. Corpus approval, precise provenance, append-only analyst decisions, rejected-source exclusion, application-controlled model attempts and the existing workflow engine remain mandatory.

An argument invalidated by an identified premise must not be proposed. A quotation containing a possible factual issue remains restricted even if the wider thesis might survive that issue. A model concern is not a proven error. No conflict observed in selected passages is scoped comparison evidence, never a certificate of factual truth or complete-document review.

## Non-goals

No exhaustive factual audit, financial rule matcher, embeddings, new retrieval model, provider, model order, workflow engine, general claim generator, analyst confirmation per need, issue-resolution screen or interface redesign. Do not repurpose the remaining conditional runtime attempts or change frozen evaluation references. The current cumulative allowance is 185 calls with USD 1 unchanged, of which 183 calls are recorded. No new calls belong to this implementation task.

## Evidence at the Original Planning Checkpoint

The existing `sourcePreparationWorkflow.run` inspects and qualifies batches of two, optionally searches a finite supplement and finishes the proposal. It has no cross-document input. `sourcePreparationActions.qualifySource` verifies stored capture bytes and uses the existing bounded OpenRouter adapter. `providerCalls.recordAttempt` owns dossier-wide attempt reservation and replay handling. `sourceSelectionProposals` fingerprints qualification/capture pins but no comparison evidence. `sourceUsage` and `sourceFindingUsage` govern downstream use but do not see cross-document issues.

The completed protocol-3 experiment demonstrates an allowed full quotation using a zero-debt premise contradicted by the primary annual report. The wrong cRPO amount in another article does not alone disprove its growth argument. These cases motivate the generic restriction boundary, not a production blacklist. The comparison must receive actual captured primary text. Existing reference judgments cannot substitute for that input.

Baseline client and Convex typechecks passed. The changed evaluation-audit script passed focused Biome. The admitted analyst inspector was captured and visually inspected at 1440 by 1000 and 390 by 844 in `/tmp/workbench-source-qualification/targeted-checks-*-before.png`, including Preview and Source details. Existing task-file bytes are preserved under `/tmp/targeted-source-checks-baseline/` for comparison with the worker's edits. These are local verification artifacts, not product evidence.

## Preservation contract

| Surface or contract | Owner | Direction and evidence |
| --- | --- | --- |
| Source intake and captured bytes | `convex/sourceCaptures.ts` | Preserve acquisition, immutable content and existing limits. Read existing storage only. |
| Preparation and cancellation | `convex/sourcePreparation.ts`, `sourcePreparationActions.ts`, `sourcePreparationWorkflow.ts`, `domain/sourcePreparationAuthority.ts` | Modify with a versioned bounded comparison phase. Preserve legacy journal sequencing, execution-slot claims, deadlines, generation fences and supplement limits. |
| Qualification and provider transport | `convex/integrations/sourceQualification.ts` | Preserve raw qualifications and route policy. Share the actual bounded structured-request implementation for the two concrete tasks without copying transport/error policy. |
| Proposal and approval | `convex/sourceSelectionProposals.ts` | Modify immutable comparison pins and fingerprint. Preserve grouped approval, source decisions, identity and history. |
| Selection and analytical use | `convex/domain/sourceSelectionPolicy.ts`, `domain/sourceUsage.ts`, `claimGeneration.ts` | Modify the shared finding-use boundary. Preserve authority classification, exact-byte evidence and independent contributions. |
| Source inspector | `convex/sources.ts`, `src/components/workspace/source-context-panel.tsx`, `src/lib/presentation/research-copy.ts` | Modify only existing finding disclosures. Preserve modal, Preview/Source details, navigation, spacing, loading geometry, keyboard access, motion and source actions. No new confirmation or control. |
| Persistence | `convex/schema.ts` | Add optional version/pin fields and a comparison result variant in existing task results. No second state owner or new issue table without evidence that existing task results cannot own bounded history. |

## Runtime responsibility map

Convex queries resolve owned current captures, decisions, pinned comparisons and safe inspector projections. Mutations reserve attempts, validate pins, persist immutable results and publish proposals atomically. Node actions read storage, verify hashes, construct bounded inputs and perform one provider attempt at a time. The existing Workflow component sequences the comparison. A focused domain module owns comparison selection, schemas, materialization and evidence restriction data. The existing source-selection policy remains the owner of effective evidence use. React renders the owned projection only.

## Locked public/domain interfaces

Extend the existing internal preparation API with comparison input, cached-result and save-result operations, plus an internal action for grouped comparison. No new public operation or TanStack server function is needed. The focused domain owner is `convex/domain/sourceComparison.ts`; exact exported names may follow existing file conventions but must be recorded in the verification report. Schemas define domain result types, and persisted Convex data continues to use generated types.

New preparations snapshot an optional comparison version. Legacy operations without it preserve their recorded workflow sequence. Versioned operations finish the current round's pending capture and qualification batches before comparing contributions, then evaluate supplementation or finish the proposal. Comparing immediately inside an early acquisition batch would miss primary captures acquired later and make the result depend on source order. After supplemental captures arrive, comparison sees the expanded context before final coverage is evaluated. Use batches of at most two and exact-input caching within the same execution authority and global limits. An absent applicable check cannot unlock an automatic attributed hypothesis, including when an old qualification remains readable. Historical documentary use retains its existing contract.

Each grouped task targets all otherwise eligible attributed arguments and forecasts from one exact qualification/capture, including alternatives. Preserve the existing maximum of fifteen findings. A finding omitted from the bounded input is inconclusive. The input binds run/company identity, active revision, comparison version, qualification task, target capture/hash and complete target reference spans. Older same-run primary captures may be supporting context if their sources remain eligible under current revision decisions. A manual-addition window targets only its new content and never reacquires or requalifies older documents.

Derive target spans from verified captured text and existing qualification references and selected-passage offsets. Current protocol 3 materializes complete selected passages. A historical narrower quotation must reproduce uniquely within its selected range or remain inconclusive. Do not change qualification output or its protocol to add finer spans. Contributions sharing an inseparable paragraph may share its restriction. Independence between distinct passages is preserved; this slice does not authorize new within-paragraph quotation selection.

Reuse the existing authority classifier rather than copying a host registry. Bound discovery to sixty candidate metadata records, at most eight primary captures per target, sixteen MiB per capture and thirty-two MiB aggregate storage reads. Prefer relevant documentary roles/purpose and periods with stable identity tie breaks. Retrieve at most six primary passages per finding plus immediate structural or table context when it fits, with at most sixty-four primary passages per task. Use existing extraction and exact offsets. Include each selected primary document's existing title, canonical URL, kind and reporting period as context, rather than asking the model to infer identity or period from internal IDs or generic wording such as "we". Token overlap and structure select candidate passages only and never adjudicate agreement. Preserve complete target quotations, reserve space for primary evidence, and enforce 128 KiB for the full serialized input including instructions, document context and response schema. Record all omissions and completeness limits.

Every finding receives `no_conflict_observed`, `possible_conflict` or `inconclusive`. The prompt requires comparison of company/entity, concept/metric, period, units/basis and the issue's effect on the proposed argument. A no-conflict result requires exact comparable primary references. A possible conflict also requires at least one exact cited primary passage. A bare model suspicion without contrary evidence is inconclusive and cannot create a permanent issue. Missing comparable evidence, an unresolved material premise or invalid scope is inconclusive. Bounded omission never proves absence elsewhere. The application materializes reference text from its input and validates identities, spans and quotations, without claiming it deterministically verifies the model's semantic judgment.

Keep raw qualification immutable. Persist a separate versioned task result with target and primary capture/hash/span pins, comparison disposition, explanation, completeness and provenance. Preserve possible-issue history in existing task results. Match applicable restrictions by exact target capture/hash and overlapping spans, so a changed qualification task or false dependency flag cannot erase them. A later positive model result cannot silently clear an earlier applicable possible conflict. An earlier inconclusive result may be superseded for permission by a new applicable comparison with genuinely changed or expanded evidence, while preserving both records. Valid uncertainty never justifies another attempt on an identical input. A new capture has its own identity and does not inherit an issue by URL alone.

Pin comparison task/status and applicable history on proposal items, include them in the fingerprint, and revalidate them at approval. A rejected, missing or changed primary pin cannot authorize a result. Current source reading and analytical use must share this rule. No conflict observed retains attributed-hypothesis use only. Possible conflict, inconclusive, missing or stale checks prohibit automatic use of the affected argument. Independent checked contributions on other spans remain available. Existing context-only uses cannot strengthen factual support.

## Task dependency order

1. Reproduce missing-check and cross-document issue regressions at real use boundaries.
2. Implement bounded comparison input/output and shared provider transport.
3. Persist checked results under existing authority and sequence them before proposal completion.
4. Pin results through selection, approval, reading and analytical use.
5. Validate existing inspector behavior and complete independent review.

## Concrete TDD tasks

### Restrict automatic attributed use without hiding independent material

**Outcome:** An absent, inconclusive or conflicted applicable check cannot create an attributed hypothesis. An independent checked passage remains available. **Files:** Modify `domain/sourceUsage.ts`, `domain/sourceSelectionPolicy.ts`, `claimGeneration.ts` only as needed. Create focused tests under `src/__tests__/convex/sources/` and extend `src/__tests__/convex/evidence/restricted-source-usage.test.ts`. Preserve existing documentary, exact-quotation and approval guards.

**RED:** Use the existing inspected-evidence seed and real attributed-hypothesis mutation to assert rejection of an otherwise eligible argument with no comparison. Confirm the test fails because the existing mutation allows the argument. Also test a generic contradictory premise and a distinct independent argument. The regression must import actual production modules rather than copy policy logic. **GREEN:** Apply comparison restrictions through `sourceFindingUsage` and its actual callers. Run `PATH="/usr/bin:$PATH" pnpm test src/__tests__/convex/evidence/restricted-source-usage.test.ts`. **Refactor:** Keep one finding-use owner. Stop if a restriction must be duplicated in React or a new claim generator is needed. **Handoff:** RED/GREEN logs and exact affected public outcomes.

### Build and materialize a bounded comparison

**Outcome:** Input contains exact target and relevant captured primary passages. Results cannot reference foreign or omitted evidence or turn missing evidence into agreement. **Files:** Create `convex/domain/sourceComparison.ts`; modify `convex/integrations/sourceQualification.ts`; create focused source-comparison and transport tests under the established source/integration test directories.

**RED:** Verify that missing comparable evidence remains inconclusive, foreign reference IDs fail, serialized schema bytes count toward the limit, whole target quotations are preserved, and the actual adapter sends text-only schema-bound data with no retries. A wrong amount with correct growth must not imply the whole thesis is disproved. **GREEN:** Implement deterministic bounded retrieval, input hash, strict response schema and exact reference materialization. Use the real SDK with only HTTP mocked. Run the new focused files individually. **Refactor:** Share existing transport policy for the two actual tasks. Stop if retrieval requires a new provider, extra acquisition or a benchmark-specific mapping. **Handoff:** Recorded input/response bounds and actual test logs. Passing mocked semantic examples do not establish model quality.

### Persist and execute checks durably

**Outcome:** Versioned checks run after qualification and before final publication, reuse exact inputs and consume the existing attempt budget. **Files:** Modify `convex/schema.ts`, `providerCalls.ts`, `sourcePreparation.ts`, `sourcePreparationActions.ts`, `sourcePreparationWorkflow.ts`, `domain/sourcePreparationAuthority.ts`; extend qualification-action, preparation-completion and workflow tests.

**RED:** Through actual mutations/actions and Workflow tests, assert versioned comparison execution, no duplicate paid operation on replay, cancellation/deadline rejection before persistence, no fallback after cancellation, explicit exhaustion of the shared 120-attempt limit, legacy journal omission and manual new-content targeting with old captured context. **GREEN:** Add optional fields and task variants, validate all referenced captures and decisions, reserve attempts through the existing owner, and persist explicit inconclusive outcomes. Before supplementation, incorporate comparison outcomes when they affect usable coverage. Exact caches avoid repeated calls for unchanged inputs. Run the affected workflow and source-action files. **Refactor:** Keep the existing workflow engine, counters and execution authority. Stop on missing generation/revision/source-decision fences. **Handoff:** Task pins, counters, replay and failure outcomes, with no live provider call.

### Freeze checks into proposals and inspection

**Outcome:** An applicable issue survives requalification, changes the proposal fingerprint and remains visible on its affected finding. **Files:** Modify `convex/sourceSelectionProposals.ts`, `sources.ts`, `domain/sourceUsage.ts`, `sourceSelectionPolicy.ts`, source-context component and presentation copy. Extend content-informed proposal/selection and source-context tests. Minimal shared test-fixture edits are permitted only for valid checked inputs.

**RED:** A later qualification with the same capture/span cannot erase an issue; approval of stale comparison pins fails; rejecting the primary cannot preserve an authorizing result. Inspector tests show the concern and exact cited primary text, while preserving independent rows and excluding raw task/provider/configuration identifiers. **GREEN:** Include immutable result/history pins in fingerprint and proposal items and project safe details in existing disclosures. Run the affected source selection, restricted-use and component files. **Refactor:** Do not duplicate semantic labels or redesign review. **Browser gate:** Orchestrator compares desktop/mobile against the captured baseline, verifies disclosure with keyboard and visible focus, checks overflow and browser errors, and verifies an explicitly illustrative checked fixture if available. **Handoff:** Exact assertions, screenshots and any incomplete live path.

## Security and durable-execution matrix

| Boundary | Required controls |
| --- | --- |
| Storage read | Current owned preparation and decision before reading, committed same-run capture, byte limit, exact hash, bounded aggregate reads. No new URL/DNS operation. |
| Model I/O | Active generation/revision/version/source authorization immediately before each attempt, existing paid-work guard and atomic shared reservation, exact input hash, source/preparation/step/attempt operation key. |
| Transport | Existing selected routes and price ceilings, sixty-second attempt, preparation deadline signal, 6,144 output tokens, one-MiB response, zero SDK/workflow retries, at most one technical fallback. |
| Persistence | Recheck active execution and every target/primary identity and decision. Late results may close telemetry but cannot publish checks, advance state or trigger another call. |
| Replay/cache | Exact logical input/version reuse only. Unknown or already-recorded attempts cannot be reissued under the same identity. New generations do not reset global limits or issue history. |
| Uncertainty/failure | Missing configuration, invalid output, incomplete evidence, deadline and exhausted allowance yield explicit reviewable/inconclusive restrictions, never empty successful checks. |
| Approval | Current fingerprint and immutable capture/qualification/comparison/history pins checked atomically. No automatic corpus approval. |

## User-facing copy contract

Use concise English within existing finding disclosures: `No conflict observed in compared passages`, `Possible conflict to review`, or `Not enough comparable evidence`. Explain that the affected passage requires verification before use and retain the exact primary quotation and source context. Do not claim verified truth or a definitively false thesis. The next available analyst action remains inspection and the existing grouped corpus decision, not a new confirmation. Raw backend errors, workflow keys, task IDs, provider names/codes, configuration, counters and budget mechanics never appear in analyst copy. Existing illustrative labels stay visible.

## Verification matrix

| Exit criterion | Deterministic proof | Browser proof | Live proof | Blocking |
| --- | --- | --- | --- | --- |
| Missing/conflicting check restricts actual hypothesis | Real claim mutation and use-policy tests | Finding restriction disclosed | Model detection not established by mocks | Offline implementation gate |
| Independent useful contribution survives | Source policy and real mutation tests | Separate finding disclosure | Later semantic evaluation | Offline implementation gate |
| Exact primary references and conservative retrieval | Real domain + SDK transport tests | Exact projected quotation | Fresh changed-input model evaluation | Activation gate remains open |
| Quota/replay/cancel/deadline/manual/legacy safety | Actual action/mutation/Workflow tests | Existing paused/read-only behavior preserved | Fresh protected preparation | Offline gate plus later activation gate |
| Approval cannot race changed pins | Real proposal fingerprint and approval tests | Existing grouped approval preserved | Fresh protected preparation | Offline gate plus later activation gate |
| Existing inspector preserved | Component safe-copy tests | Desktop/mobile, keyboard, focus, overflow, console | No paid I/O needed for illustrative fixture | Changed-surface gate |

## Live and browser gates

Do not activate `SOURCE_QUALIFICATION_ENABLED` or call providers for this task. The existing 183-call accounting and two conditional attempts stay unchanged. A new comparison protocol cannot claim semantic acceptance from replayed old qualification outputs or mocked HTTP. Fresh authorized evaluation must test the actual new input and record the investigator's judgments and HTTP diagnostics before activation. Its budget is not part of this implementation authorization.

Parent runs focused changed-file diagnostics and client/Convex types after worker completion, reviews the diff against saved baseline, and verifies relevant regional tests independently. The repository-required final check may expose the known unchanged lint failure, which must remain reported rather than repaired outside scope. Broader test failures and incomplete browser/live gates remain visible. No passing component suite substitutes for a protected workflow.

## Self-review and known deferrals

This extends existing state, workflow, transport and use-policy owners rather than adding a verification platform. All semantic outcomes remain model judgments tied to exact evidence. Sparse retrieval and omitted inputs can miss issues and require semantic evaluation. This slice has no automatic clearing of earlier issues and no new issue adjudication interface. Historical documents remain readable, but unperformed checks do not authorize new attributed arguments. Runtime activation, live comparison quality, unrelated baseline failures, broader goal resumption, commits and deployment remain separate authorities.

## Bounded transport correction after live truncation

Two authorized first-case requests returned HTTP 200 with finish_reason length at 6,144 tokens. Both repeated long compound primary reference keys containing source/capture identifiers and content hashes throughout the response. Preserve these failed responses and their costs. Replace only request-local primary reference encoding with deterministic compact aliases, keeping each alias mapped to the existing complete source/capture/hash/passage/span in the prepared input and materialized result. This changes neither citation authority nor result semantics. Exact serialized input hashes invalidate old request reuse. The persisted output contract and historical comparison pins remain readable. Do not raise output limits, split a document into extra model calls, fabricate valid output from the truncated response or activate the feature.

Before any further inference, prove alias uniqueness, deterministic preparation, exact provenance materialization and foreign-reference rejection through the actual production module, then regenerate the offline retrieval audit and freeze a new manifest. The first failed run remains part of cumulative accounting. Of the four comparison calls authorized at ceiling 189, two remain unused, with two separate conditional runtime attempts still reserved.

## Citation scope correction from the completed two-document comparison

The grouped request exposes the union of captured primary passages, but its response schema and materializer permit only each finding's lexical retrieval subset. This prevents a valid citation to primary material already provided elsewhere in the same grouped input. In the debt run, p145 is supplied globally yet cannot be cited for the mixed financial contribution containing the same zero-debt premise. DeepSeek instead cites allowed financial paragraphs that do not contain the asserted debt figure. The Capital response similarly invokes another provided AI paragraph while returning an allowed but irrelevant reference. This establishes an interface restriction, not proof that a model will become semantically correct after removing it.

Allow each finding to cite any primary passage actually included in this exact prepared request. Keep per-finding ranked keys as retrieval suggestions, the existing per-output citation limit, exact target spans, same-run capture eligibility and the full serialized-input limit. Reject omitted, foreign or fabricated keys. The same immutable request owns all primary provenance. No additional content, acquisition, provider, model request or approval is introduced. Test the inability to express a valid cross-finding citation before changing production code. Preserve all failed and successful historical model responses. Changed-input semantic acceptance and fresh protected runtime preparation remain required before activation.

The existing maximum-input test now exceeds its unchanged five-second deadline. A zero-network probe of the real module records 1,461.5 ms wall / 1,713.2 ms CPU for a fifteen-contribution input, with ten repeated serialization/schema conversions while removing one finding at a time. Use the existing qualification implementation's bounded prefix-search approach locally in the comparison owner. Preserve the exact largest fitting prefix, request bytes, input hash and omissions, verified against the retained before-probe. This is a preparation-cost correction, not a claim to resolve all host/runtime timeouts.
