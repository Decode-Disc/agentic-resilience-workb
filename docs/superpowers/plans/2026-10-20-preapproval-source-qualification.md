# Pre-approval Source Qualification Implementation Plan

**Recorded continuation, 2026-10-22:** this plan preserves the authorized implementation scope and protocol revisions. Later [grouped evaluation](../../verification/2026-10-21-source-quality-second-batch.md), [retrieval interpretation correction](../../verification/2026-10-21-evidence-retrieval-repair.md#interpretation-correction-2026-10-22) and [source-review fixes](../../verification/2026-10-22-source-review-corrections.md) qualify its outcomes. See the [roadmap](../../ROADMAP.md#recorded-delivery-state-2026-10-22) for remaining acceptance work. Historical call counters and delegations are not current grants. The 600-character comparison limit remains unchanged and deferred behind the evidence-preservation investigation.

**Goal:** Prepare a justified source selection from captured document content, reduce routine analyst work, and preserve corpus approval and evidence integrity.

**Status:** Authorized for implementation, 20 October 2026. Progress and verification are recorded separately. Authorization excludes commits, publication and production deployment.

**Current bounded extension:** The user accepted [targeted comparison and evidence-bound restrictions](../../designs/2026-10-20-known-source-issues-proposal.md) and explicitly delegated that implementation to one worker under the orchestrator's direction and validation. Its [separate implementation plan](2026-10-20-targeted-source-comparison.md) governs the work. The broader goal is paused at the user’s explicit request. The latest four-call authorization proposal was withdrawn for this pause and remains unapproved. Six authorized comparison attempts have completed at cumulative 189 attempts and USD 0.55230824396 conservatively reported or reserved, under the authorized overall ceiling of 191 and USD 1. The two original conditional runtime attempts remain unused. The completed comparison is not semantically accepted. A subsequent shared-context citation correction is verified offline, with changed-input model evaluation and fresh protected preparation still open. A prepared four-call continuation at ceiling 195 is a proposal, not authorization. No unconditional activation is authorized.

**Technical revision, 20 October 2026:** The initial grouped model format failed its recorded live gate. Protocol version 2 retains the canonical qualification but asks the model for fixed nullable role contributions and passage identifiers. The application materializes exact quotations and presentation excerpts from the immutable input. Role definitions and document-purpose compatibility have one owner in `SOURCE_ROLE_REQUIREMENTS`. A selected passage is never silently truncated. The existing 4,000-character passage/citation bound applies. This replaces model-authored summaries and literal citation copying in Tasks 1 and 3, without changing product decisions, providers, call limits or approval. The model must still pass semantic evaluation. A bounded diagnostic does not replace the full nineteen-document gate. Any additional calls beyond the authorized combined limit require approval.

**Technical revision after the completed comparison:** The shared response contract cannot represent results and forecasts separately within one role. Amend the existing protocol to version 3: each role is null or contains at most two homogeneous contributions, retaining the existing fifteen-finding overall bound and three passage references per contribution. Add the explicit source-content nature `mixed_or_uncertain` for a passage that cannot be safely classified as one kind. Such content remains useful for context or targeted verification and cannot support a factual claim. This changes representation and restriction scope, not the product workflow, analyst checkpoints, models or call envelopes. Distinct contributions use distinct passage references and carry their own kind, period and dependency. The investigator must still judge semantic correctness: a finer schema cannot correct a model that mislabels a forecast even when it stands alone.

**Correction sequence:** In Tasks 1/3, test two contributions for the same role, mixed content, duplicate groups, unchanged quotation materialization, serialized-input limits and refusal to replay old input keys as new model evidence. In Tasks 4/6, keep role availability as a documentary summary while enforcing citation-specific usage through the existing shared owner. Test actual results plus forecasts under one available role, mixed paragraphs, conflicting uses of one passage, and refusal through real claim creation and policy evaluation. Make attributed-hypothesis selection precise when a role has more than one eligible contribution, preserve stable replay, and retain read-only access to immutable version-2 pins. In Task 7, return adjudicated per-finding usage from the existing owned source query and render it in the existing details disclosure, with stable distinct keys and safe mixed-content copy. Preserve every existing layout and control. Update canonical validators additively; no new tables, provider calls, dependency, verifier engine or live claim generator. New inference remains unauthorized above 145. Old incorrect responses remain evidence of the defect and cannot become new-format success through invented annotations.

**Architecture:** Extend the existing selection policy and Convex workflow. Persist immutable pre-approval captures, qualify their content with bounded structured model calls, then materialize the exact captures after approval. Convex remains the only state owner and workflow engine.

**Tech stack:** Existing React, TanStack Start, Convex, Exa and Vitest. AI SDK and the OpenRouter adapter follow the repository dependency controls.

**Spec:** [Accepted working decisions](../../designs/2026-10-20-source-qualification-working-decisions.md), supplemented by the accepted DeepSeek/MiMo routing and Exa PDF-text decisions below.

## Global Constraints

- Implement locally with `executing-plans` and `tdd`. No implementation or review delegation without explicit authorization.
- English code, fixtures, documentation and product copy. Preserve existing uncommitted documentation moves and evaluations.
- Grouped corpus approval remains mandatory before analytical extraction. Rejected sources never contribute downstream. Preparation does not fabricate an accepted decision.
- Existing initial discovery limit: 48. Recommendation ceiling: 24. Historical candidate ceiling for this protocol: 60, including manual candidates and exclusions.
- Examine existing alternatives before one dossier-wide supplement, capped at three searches, four new candidates each and twelve additions total. Preserve all history.
- One grouped qualification per uncached document. No model confidence as evidence, hidden retries, automatic semantic escalation or provider-owned model fallback.
- Public PDFs use Exa text with locators in the preserved representation, never invented page numbers. Unavailable text is a visible limitation.
- This tranche does not add general live claim generation, assessments, briefs, continuous monitoring, general crawling or page-aware PDF parsing.

## Review Focus

- Partial reading cannot establish absence from the full document.
- Wrong-company mentions and outdated destinations cannot acquire content-dependent coverage through a plausible title.
- Attributed arguments cannot become verified facts or artificially increase authority and corroboration.
- Cancellation and replay cannot reset paid-work allowances or restart the automatic supplement.
- Artifact cleanup cannot delete a capture referenced by preparation or approved evidence.

## Current State and Preservation Contract

The baseline is `a9f30ae` on the existing `roadmap-phase-5` branch. Five focused files passed 100 tests during planning. The global pnpm launcher stalled, but the project-installed Vitest runner passed. No admitted browser session existed at planning time.

| Surface | Owner | Direction and evidence |
| --- | --- | --- |
| Source classification and coverage | `convex/domain/sourceSelectionPolicy.ts` | Modify metadata-only eligibility using inspected content. Preserve deterministic ranking and provenance authority. |
| Proposals and approval | `convex/sourceSelectionProposals.ts` | Modify immutable proposal references. Preserve individual audited decisions and grouped approval. |
| Retrieval and evidence artifacts | `convex/evidenceActions.ts`, `convex/evidenceArtifacts.ts` | Preserve accepted-decision fences. Add separate capture authority and exact-byte materialization. |
| Durable research | `convex/researchWorkflow.ts` | Add preparation before proposal and approval. Preserve the main handle that awaits approval for legacy drafts. |
| Review UI | `live-source-review.tsx`, `source-proposal-review.tsx` | Preserve summary, Recommended/Needs attention/Alternatives, adjustment board, inspection, preview, public links, undo and approval. |
| Evidence policy | `convex/domain/evidencePolicy.ts` | Modify role-blind authority/corroboration aggregation. |
| Live claim capability | `convex/claimGeneration.ts` | Preserve the explicit unavailable state for arbitrary live documents. |

Capture admitted desktop/mobile browser baselines before UI edits. Preserve source-review URLs, Back/Forward, responsive master/detail and drawer, resizing, keyboard/focus states, reduced motion, shared primitives and geometry-preserving loading. Only preparation state, content-backed reasons, passages and restrictions change visibly.

## Runtime and Interface Contract

Convex mutations own authorization, slot claims, transitions, counters and immutable persistence. Actions own external I/O. The installed Workflow component owns durable execution and human checkpoints. Domain modules own selection and restrictions. Presentation helpers translate safe product copy. Integration adapters have no persistence authority.

Add one `sourceCaptures` table with preparation/run/revision/source identity, generation, capture key, upload lifecycle, storage ID, content hash, retrieval/normalizer versions, timestamp, completeness and typed failure. Extend existing `sourceSelectionProposalRebuilds` for preparation operations, `aiTaskResults` for `source_qualification`, proposal items for pinned capture/task IDs, runs for the single supplement, source versions for capture provenance and provider calls for preparation authority. Keep analytical `acceptedDecisionId` required.

Public preparation: `sourcePreparation.startForReview({runId, corpusRevisionId, expectedProposalId, requestId})`. Internal discovery claim: `sourcePreparation.claimForDiscovery({runId, corpusRevisionId, expectedExecutionGeneration})`. Workflow: `sourcePreparationWorkflow.run({preparationId})`. Actions: `sourcePreparationActions.inspectSource({preparationId, sourceId})` and `qualifySource({preparationId, sourceCaptureId})`. Completion: `sourcePreparation.finish({preparationId, expectedExecutionGeneration})`. Approved reuse extends the existing `evidenceActions.retrieveAndNormalizeSecSource`, `retrieveAndNormalizeExaSource`, `retrieveAndNormalizeManualSource` and `retrieveAndNormalizePublicPdfSource` boundaries with their unchanged required accepted-decision inputs. They resolve the approved proposal capture before external I/O and commit through `evidenceArtifacts.materializeInspectedSource`. This avoids an additional forwarding action while preserving the existing workflow dispatcher.

Public callers cannot supply arbitrary storage IDs or qualifications. Client records use generated Convex types. A canonical schema in `convex/domain/sourceQualification.ts` owns inferred types, validation and the Convex validator. Findings distinguish company relationship, existing document kind/coverage role, asserted fact/attributed argument/forecast/reported outcome, reproducible quotations, period applicability and limitations/dependencies. The model cannot assign provenance authority, factual verification or final selection. When passage or byte allowances are full, the existing shared extractor and qualification preparation prioritize descriptive prose, tables and examples over short navigation. Preserve original paragraph identities and offsets across selection and analytical materialization. This formatting priority never establishes semantic relevance or truth.

The internal workflow obtains at most two eligible sources through `sourcePreparation.nextBatch({preparationId})`. `recordResult({preparationId, outcome})` returns `recorded`, `source_rejected` or `deadline_elapsed`. Rejection and expiry discard late results without interrupting the remaining review transition. Cancellation, changed generation, ownership errors and inconsistent records remain errors. Persisted provider/configuration stop codes prevent another batch, and completion presents the remaining limitations without fabricating outcomes for unchecked sources.

| Limit | Value |
| --- | --- |
| Captured and normalized document | Existing 16 MiB bound |
| Serialized qualification input, including instructions/context and response JSON schema | 128 KiB |
| Output | 6,144 tokens |
| Attempt timeout | 60 seconds |
| Attempts per logical input | One primary and at most one fallback |
| Concurrent source operations | Two |
| Persisted preparation deadline | Fifteen minutes, unchanged by resume. A genuinely new manual source opens its own fifteen-minute window for that content only, without rereading older sources or resetting dossier-wide search, candidate or model-attempt limits. |
| Initial candidate/model envelope | 60 distinct candidates, 120 attempts |
| SDK and workflow retries for model actions | Disabled |

Clean input deterministically, removing non-text payloads while preserving reproducible text and passage identities. Use the complete cleaned document when it fits. Otherwise select passages using structure and research-question relevance, persist omissions and mark partial reading. Positive narrow findings remain possible; negative whole-document conclusions do not.

Configure `deepseek/deepseek-v4-flash-0731` through `reka` first and `xiaomi/mimo-v2.6-flash` through `deepinfra/fp8` second. Require structured outputs, disable hidden fallback and cap route prices at $0.15/M input and $0.60/M output. Fall back only on transient transport or invalid/incomplete output. Valid uncertainty, missing configuration, cancellation, disabled paid work and account billing failures do not trigger another model. Revalidate routes and exact package versions before activation/install.

## Task Dependency Order

Contract → captures → qualification/evaluation → selection → workflow/supplement → approved materialization/policy → existing UI → integrated verification.

### Task 1: Qualification Protocol and Recorded Reference

**Outcome:** Bounded, reproducible qualification with recorded expected judgments.

**Files:** Create `convex/domain/sourceQualification.ts`, `src/__tests__/convex/sources/source-qualification.test.ts` and qualification fixtures/reference under `scripts/evaluations/source-selection/`. Modify authoritative documents through ADR-024. Preserve original benchmark bytes and runs.

**Interfaces:** `prepareQualificationInput(...)`, `validateQualificationOutput(...)` and canonical inferred schema types.

- [x] RED: Test oversized text and embedded payload cleanup, complete/partial distinction, invented/ambiguous quotations and injection content as data. Assert serialized input ≤131072 bytes and invalid citations rejected. Run `pnpm test src/__tests__/convex/sources/source-qualification.test.ts` and record the intended missing-behavior failure.
- [x] GREEN: Implement deterministic preparation and strict validation. Write expected company/purpose/period/use judgments before inference.
- [x] REFACTOR: Keep protocol knowledge localized; no generic AI-task framework.

**Stop:** Factual text changes during cleanup, quotations lose provenance or gold depends on changing URLs. **Handoff:** Focused passing test output and reference rationale. **Browser:** None.

### Task 2: Authorized Immutable Captures

**Outcome:** Candidate retrieval before approval creates no analytical evidence.

**Files:** Create `convex/sourceCaptures.ts`, `convex/sourcePreparation.ts`, `convex/sourcePreparationActions.ts`, `src/__tests__/convex/sources/source-captures.test.ts`. Modify schema, provider calls, artifact cleanup and existing retrieval transport input types. Extend `src/__tests__/convex/evidence/artifact-cleanup.test.ts`.

**Preserve:** Accepted-source fences, pinned DNS retrieval, old artifacts and cleanup safety window. **Interfaces:** Internal capture reservation, attachment, finalization; complete/partial/unavailable inspection results.

- [x] RED: Through the real action boundary prove committed preparation creates zero source versions/passages. Unauthorized, rejected and stale work performs zero network calls. Cleanup preserves committed capture storage. Run `pnpm test src/__tests__/convex/sources/source-captures.test.ts src/__tests__/convex/evidence/artifact-cleanup.test.ts`.
- [x] GREEN: Narrow transport inputs instead of fabricating approval. Protect captures in all reconciliation and immediate deletion paths. Recheck generation before persistence.
- [x] REFACTOR: Share reference checks within the existing artifact owner.

**Stop:** Optional analytical approval IDs, pre-authorization DNS or deletion of referenced captures. **Handoff:** Authorization, cancellation, immutability and orphan cleanup proofs. **Browser:** None.

### Task 3: Model Integration and Reproducible MiMo Evaluation

**Outcome:** Grouped structured qualification with application-owned fallback and telemetry.

**Files:** Create `convex/integrations/sourceQualification.ts`, `convex/integrations/sourceQualificationConfig.ts`, `src/__tests__/convex/integrations/source-qualification-transport.test.ts`. Modify preparation actions, AI task persistence, telemetry and existing comparison/catalog scripts.

**Preserve:** Offline default tests and old evaluation history. **Interfaces:** One-attempt provider adapter, bounded application fallback, validated immutable task result.

- [x] Verify official registry versions and release age immediately before installing `ai` and `@openrouter/ai-sdk-provider` through the dependency-installation skill. Planning candidates were `ai@7.0.138` and adapter `3.1.0`; do not bypass supply-chain controls.
- [x] RED: Mock HTTP only. Primary failure followed by fallback makes two requests; valid uncertainty makes one; absent config and cancellation make none. Assert strict output, maxRetries zero, routing, limits and telemetry. Run `pnpm test src/__tests__/convex/integrations/source-qualification-transport.test.ts`.
- [x] GREEN: Implement using installed version-matched SDK docs. Persist selected input passage references, hashes, protocol versions, route, usage and outcome. No secrets or reasoning traces.
- [x] Evaluate MiMo against unchanged 99 expected decisions and existing sensitivity cases. Evaluate both selected models against the new qualification reference. The earlier choice result is 98/99 with its sensitivity evidence retained. The final authorized continuation reused twenty-seven exact-input responses and added eleven requests, all HTTP 200. Both current matrices are nineteen structurally valid responses. Cumulative accounting is 145 attempts and USD 0.49142902524 conservatively reported or reserved, with USD 1 unchanged and no authorization above 145. Original failures and judgments remain unchanged. The original DeepSeek failure cause is still unknown. **Evaluation is complete, activation is blocked:** mixed actual-results and guidance passages receive one factual label, and the actual use guard allows two false achieved-results probes for MiMo. See the current assessment, per-document investigator judgments and reproducible offline policy audit under `scripts/evaluations/source-selection/`. Do not activate, change routing or weaken the forecast stop condition. Correct and revalidate the affected contract before proposing any further paid check.
- [x] REFACTOR: Qualification evaluation imports production preparation/validation. Keep the older choice benchmark independently reproducible.

**Stop:** Wrong-company promotion, forecasts treated as outcomes, unsafe factual promotion, invented citations or unusable bounded transport. Safe abstentions remain documented. **Handoff:** Commands, manifests, hashes, costs and MiMo verdict. **Browser:** None.

### Task 4: Content-informed Selection and Documentary Availability

**Outcome:** Useful alternatives affect selection without acquiring unjustified authority.

**Files:** Modify `convex/domain/sourceSelectionPolicy.ts`, `convex/sourceSelectionProposals.ts` and their existing policy/proposal tests.

**Preserve:** Deterministic ranking, recommendation ceiling, analyst decisions and history. **Interfaces:** Qualification inputs; role states `available`, `limited`, `not_established`, with reasons and capture references.

- [x] RED: Through proposal generation/query test historical vs current terms, useful adverse arguments, incidental company mentions, obsolete destinations, unreadable sources, exclusions and repeated reporting. Historical terms are limited; unknown current terms remain not established; unverified useful arguments have attributed use only. Run the three existing source-selection policy/proposal files.
- [x] GREEN: Establish content purpose/company relevance from anchored findings. Preserve provenance authority. Domains alone do not prove editorial independence or factual corroboration. Effective inclusion uses the same coverage owner.
- [x] REFACTOR: Keep selection and coverage rules in their existing domain owner.

**Stop:** Title-only content coverage, inclusion rewriting provenance or partial reading proving irrelevance. **Handoff:** Public proposal regressions and audit-case differences. **Browser:** Task 7.

### Task 5: Durable Proactive Preparation and Single Supplement

**Outcome:** Preparation precedes approval and stops within the finite envelope.

**Files:** Create `convex/sourcePreparationWorkflow.ts`, `src/__tests__/convex/workflows/source-preparation-workflow.test.ts`. Modify research workflow, preparation/recovery owners, capacity/resource limits, workflow controls and manual-intake completion.

**Preserve:** Main approval workflow handle, one running slot, durable approval event and decisions. **Interfaces:** Preparation boundaries above; initial discovery and legacy review entry points.

Implementation increment verified offline: public review starts atomically claim the slot and preserve the waiting approval handle. The workflow processes two-source batches and one immutable supplement, with three search reservations, four candidates per result, twelve additions and sixty historical candidates. Cancellation and generation fences prevent late persistence. Forty regional tests passed after a conditional terminal-state wait replaced an incomplete test scheduler drain. Normal discovery and the existing legacy rebuild/recovery actions now enter preparation behind SOURCE_QUALIFICATION_ENABLED, disabled by default. Existing workflow arguments omit the optional preparation flag and preserve legacy replay. Manual intake starts a separate window for genuinely new content, preserves pending links when another dossier is running, and replays its successful response across generation changes. Never-started pending links may be grouped in the same new-content window when the slot becomes available. The latest public-start/manual, Phase 4/nested-cancellation and durable-workflow group passed nineteen tests. Intentional cancellation fences completion callbacks before cancelling their component handles, and a waiting manual link publishes its proposal against the installed preparation authority. The implementation steps below are complete offline. Activation and fresh live preparation acceptance remain Task 8 gates.

- [x] RED: Use the real Workflow component with external transport mocks. Existing inspection finishes before supplemental search. Search ≤3, supplement additions ≤12, historical count ≤60. Legacy main workflow handle remains unchanged. Test duplicate starts/replay, late results, rejection during reading, deadlines and cancellation. Run new workflow test plus existing rebuild and Phase 4 tests.
- [x] GREEN: Call preparation after normal discovery. Explicit legacy refresh/rebuild claims the slot atomically. Never trigger paid migration on page render. Reserve one immutable supplement plan per dossier and resume the same operation. Initial discovery stays 48.
- [x] Prepare manual additions automatically when the slot is available; retain source and expose recoverable state when another dossier is active. Finish with explicit partial results at deadlines/provider failure. Do not restart searches to erase warnings.
- [x] REFACTOR: Extend existing recovery and capacity owners, without a second recovery engine.

**Stop:** Reset allowances, approval racing unfinished preparation or unreachable legacy approval. **Handoff:** Persisted transition/call trace and replay/cancellation evidence. **Browser:** Task 8.

### Task 6: Approved Capture Reuse and Restricted Evidence Policy

**Outcome:** Approval materializes inspected bytes; restricted citations do not inflate factual support.

**Files:** Modify evidence actions/artifacts/workflow, claim generation/validation, evidence policy and policy evaluations. Add `src/__tests__/convex/evidence/inspected-source-materialization.test.ts` and extend policy/cleanup tests.

**Preserve:** Required accepted decisions, exact citations, structural blocks and historical approved corpora. **Interfaces:** Materialization resolves captures from the approved proposal, not caller IDs; usage restrictions travel into evidence policy.

- [x] RED: Materialize twice and assert same storage/hash, one version and zero new retrievals. Missing/corrupt capture fails explicitly. Restricted factual support is blocked. Adding contextual high-authority citations cannot increase authority/corroboration. Run materialization, evidence-policy and artifact-cleanup tests.
- [x] GREEN: Share version/passage insertion with separate authority checks. Never send shared capture storage through disposable losing-upload handling. Preserve historical approved-corpus retrieval explicitly.
- [x] Enforce attributed use of unverified arguments as Hypothesis. Construct attributed statements from validated records, rather than allowing a flag to unlock factual support. Apply restrictions to actual claim validation and policy inputs. Unavailable targeted factual verification remains blocked/unknown. Do not add a general live claim generator.
- [x] REFACTOR: Centralize insertion and restrictions at existing owning boundaries.

**Stop:** Rejected content contributes, overrides bypass restrictions or shared storage is deleted. **Handoff:** Hash/storage, idempotency and public policy proofs. **Browser:** Restrictions visible in Task 7.

### Task 7: Preparation Within Existing Review UI

**Outcome:** Understandable source proposal and grouped approval, with preserved interface.

**Files:** Modify `src/components/workspace/live-source-review.tsx`, `src/components/workspace/source-proposal-review.tsx`, `src/lib/presentation/research-copy.ts` and existing component/navigation tests.

**Preserve:** All controls, layout, URL and accessibility contracts above. **Interfaces:** Generated Convex projections and centralized presentation labels.

- [x] Capture authenticated desktop/mobile before-state using named agent-browser session, analyst-1 only.
- [x] RED: Use reference-routed hooks. Assert useful-with-limitations copy, actionable errors, disabled approval while preparing, ready grouped approval and absence of raw model/env/workflow/error details. Run both review component files plus source-review route/search tests. The seven-file regional pass is sixty tests before the separately verified approved-state copy regression. JSDOM scroll warnings are retained and actual protected desktop/mobile inspection, approval, captured materialization and reconnection are recorded.
- [x] GREEN: Add actual persisted preparation progress, passage explanations and restrictions within existing summary/inspection. After allowance exhaustion offer remaining-limit review, inspection and link intake, not a futile search action.
- [x] REFACTOR: Centralize labels; keep shared primitives neutral.

**Stop:** Interface replacement or technical errors in analyst copy. **Handoff:** Tests and desktop/mobile screenshots, keyboard/focus, previews, adjustment, browser history, reduced-motion and console evidence.

### Task 8: Integrated Protected Verification

**Outcome:** Fresh and legacy QA dossiers demonstrate preparation → review → grouped approval → exact captured materialization.

**Files:** Add bounded opt-in live contracts where needed and `docs/verification/2026-10-20-preapproval-source-qualification.md`. Extend the existing gated `convex/e2eFixtures.ts` owner and its tests for an explicitly illustrative inspected source. Keep file upload in its existing action-based storage pipeline and capture/qualification attachment in a guarded mutation. Preserve the real approval-waiting workflow handle and existing fixtures. Update this plan's completion state only after evidence exists.

- [x] Run focused checks during development; format task files after behavior stabilizes. Final runtime acceptance remains blocked as described below.
- [x] Ran `pnpm check` once. It stopped at an unchanged baseline lint violation. The separately executed substantial-change build and typecheck passed. Global acceptance remains failed, with exact results and later targeted failures retained in the verification report.
- [ ] Verify fresh and fixture-owned legacy waiting workflows using real anonymous authentication and access-code admission. Use existing local services and analyst-1. Never replace analyst-2 or approve the user's dossier.
- [ ] Verify logout/reconnection, desktop/mobile, keyboard, focus/hover, reduced motion, source adjustments, approval, progress and console.
- [x] Record candidate state, exact commands/results, failures, live costs, screenshots and unverified gates. The verification report preserves failed global checks and the open semantic activation gate.

## External-I/O and Durable Execution Matrix

Authorization precedes DNS/SDK/HTTP work. Retrieval validates every redirect and connects to the validated public address. Attempts bind run, workflow version, generation, corpus revision, preparation/step and attempt. Check fences before calling and before persistence. Resumes claim the visitor slot atomically. Cancellation invalidates generation, cancels main and active preparation handles, and aborts local calls where supported. Late results may close telemetry but cannot publish results or launch paid work. Unknown outcomes consume an attempt and never replay as a new identical attempt. Missing configuration, paid-work disablement and partial failure are explicit typed outcomes, never empty successes.

## Audience Copy

Use `Preparing source selection`, `Suitable documents available`, `Useful with limitations`, `Need not established`, `Source could not be read`, `Partially reviewed` and `Source selection ready with limitations`. Explain consequence and next action. Never display provider names, secrets, raw exceptions, quota counters, request IDs or workflow enums. Preserve illustrative/showcase disclosures.

## Verification and Rollout Gates

| Exit criterion | Deterministic evidence | Browser/live evidence | Blocking |
| --- | --- | --- | --- |
| Alternatives inspected before searches | Workflow order/dedup tests | Bounded preparation trace | Yes |
| Anchored content selection | Protocol/citation/proposal tests | Actual passage inspection | Yes |
| Selected model routes usable | Transport tests and frozen evaluation | Explicit bounded comparison | Critical failures |
| One supplement across resumes | Replay/cancel/capacity tests | Persisted events/counters | Yes |
| Legacy approval survives | Real Workflow test | Protected legacy journey | Yes |
| Inspected bytes reused | Storage/hash/cleanup tests | Approved QA source | Yes |
| Restricted evidence enforced | Claim/policy tests | Review disclosure | Yes |
| Existing interface preserved | Components and route tests | Desktop/mobile comparison | Yes |
| Honest partial failures | Missing-provider/deadline tests | Recoverable partial state | Yes |

Roll out additively: schema and cleanup safety, protocol implementation, then workflow activation after deterministic and bounded live gates. SOURCE_QUALIFICATION_ENABLED defaults to disabled and is snapshotted into each new main workflow's optional prepareSources argument. Existing workflows without that argument preserve their original step sequence. Public review starts reject while preparation is disabled. Do not set the runtime flag until the activation gates pass. Confirm secrets in the actual Convex runtime without exposing values. Refresh catalogs before activation. Preserve historical approved corpora. The investigator reference is single-company and is not independent ground truth. Page-aware PDFs, exhaustive factual verification and general live claim generation remain deferred. Completion requires the protected journey, artifact identity and restrictions, not merely passing isolated tests.


## Protocol 3 verification checkpoint

The homogeneous-contribution correction is implemented and locally checked as recorded in the verification report. The retained protocol-2 comparison remains historical. The current protocol-3 zero-I/O input audit requires thirty-eight new responses and reuses none of the old keys. At this pre-comparison checkpoint the ceiling was exhausted at 145 with USD 0.49142902524 conservatively reported or reserved. The subsequent authorization and completed protocol-3 comparison are recorded below.

A proposed additional envelope is forty attempts within the unchanged USD 1 cumulative budget: thirty-eight for the two-route nineteen-document comparison and at most two for one controlled local runtime source, including its possible technical fallback. The comparison would begin with one quarterly-presentation request per route to verify the actual structured format before continuing the other thirty-six. A common schema/transport defect stops that dispatch rather than repeating it across all documents. Runtime work remains conditional on semantic acceptance and the remaining applicable gates. No proposal here authorizes runtime activation, analyst corpus approval, publication or production deployment. Record the user's explicit answer before changing the ceiling or executing any of these calls.

The user explicitly authorized this forty-attempt envelope, raising the cumulative ceiling to 185 with USD 1 unchanged. The answer permits the bounded comparison and the conditional local single-source verification. It does not authorize an unconditional feature rollout, model-order change, production deployment or corpus approval. The additional two runtime attempts remain unused unless the applicable gates pass.


The authorized protocol-3 comparison completed thirty-eight calls at a cumulative 183 calls and USD 0.53658964396 conservatively reported or reserved. The two runtime attempts remain unused. All frozen forecast-use negative probes now pass. The attributed-use audit demonstrates a separate known-issue enforcement gap, including an allowed argument using the erroneous zero-debt premise. The user subsequently accepted targeted comparison and the persistent issue channel in `docs/designs/2026-10-20-known-source-issues-proposal.md`, with its bounded implementation delegated under the separate plan linked above. The broader goal remains paused and runtime activation remains unauthorized. The current model evaluation and nineteen documentary judgments are in `QUALIFICATION-V3-ASSESSMENT-2026-10-20.md` and the associated run artifacts.

The targeted-comparison increment is now implemented and independently checked with 171 relevant tests passing, client and Convex typechecks, focused Biome and a successful build. Its [verification report](../../verification/2026-10-20-targeted-source-comparison.md) preserves the global check failures, existing keyboard limitation and untested live semantic quality. The original counterexample remains historical evidence, and no paid comparison of the new input or preparation activation occurred. This checkpoint completes the delegated offline increment, not this broader plan or its protected runtime gates.

## Integrated verification continuation

The broader goal is active. The latest [live evaluation and protected verification report](../../verification/2026-10-20-source-comparison-live-evaluation.md) records two newly approved illustrative dossiers, exact capture materialization, preserved comparison restrictions, desktop/mobile inspection, keyboard return-focus repair, logout/readmission and navigation persistence. Fixture configuration was restored to absent and preparation remains disabled. Fresh live preparation is still unverified.

All four additional comparison attempts authorized at ceiling 189 are consumed, bringing cumulative accounting to 187 attempts and USD 0.54878789396 conservatively reported or reserved. The first two responses hit the output limit. Compact request-local primary aliases and explicit comparison instructions produce complete responses for the first article with both routes, preserve all exact provenance and retain all contribution groups and selected primary passages. Both detect the wrong cRPO amount. Sixteen investigator judgments record three semantic mismatches, including an unsupported clean comparison with an irrelevant citation. This is not semantic acceptance or authority to activate. The second article remains unexecuted.

A two-call second-article continuation is frozen and dry-run with zero provider requests. Authorization for that proposal is pending: cumulative ceiling 191, USD 1 unchanged, at most USD 0.08 new reservation. The two original conditional local-runtime attempts remain reserved. No paid dispatch may follow until an explicit answer, and none of these experiments authorizes corpus approval or unconditional activation.

The user explicitly authorized the two second-article comparison calls, cumulative ceiling 191 and USD 1 unchanged, preserving the two original conditional runtime attempts. The pending answer barrier is cleared. Fresh official selected-endpoint metadata confirms the same configured models/providers and prices within the existing caps. The original expired snapshot and zero-call prepared manifest remain preserved. A new manifest freezes exactly the same two debt-comparison payloads and includes the full 187-attempt paid lineage before dispatch. No feature activation or routing change follows from this authorization.
