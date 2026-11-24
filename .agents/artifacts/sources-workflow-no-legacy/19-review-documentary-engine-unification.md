---
type: design-review
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "2816370980accf0155c09d62054ca83511ca43d3"
reviewer: native-oracle
model: gpt-6-astra
reasoning: xhigh
status: initial-review-complete-see-follow-up
---

# Oracle Review: Documentary Engine Unification

The user requested an independent Oracle review of the proposed TDD under `code-smell-guardrails` and `workbench-harness-development`. Oracle read the complete target, its request/research inputs, required skills and relevant product/technical contracts, then verified material findings in source. It changed no files and ran no tests, providers, network calls, deployment, dependency operations or environment inspection. This is a pre-implementation design review, not evidence that the target runs correctly.

The exact reviewed document is preserved in [documentary-tdd-oracle-input.md](documentary-tdd-oracle-input.md), with its SHA-256 and baseline in [documentary-tdd-oracle-review-context.json](documentary-tdd-oracle-review-context.json). The revised target is [18-tdd-documentary-engine-unification.md](18-tdd-documentary-engine-unification.md). Source paths below refer to the baseline repository; target line references in Oracle's report refer to the preserved input, not the subsequently edited target.

Follow-up: a [targeted Oracle recheck](20-recheck-documentary-engine-unification.md) subsequently assessed the first revision and led to three final bounded corrections. Statements below describe the initial review stage; neither its verdict nor its reviewed snapshot has been rewritten as an approval.

## Verdict and interpretation

Oracle returned **BLOCK**, with four blocking contract findings and five watch findings. It judged the selected architecture feasible and explicitly supported the shared capture engine, short `read_in_context({reference})` input, query-safe displayed receipts, canonical descriptor reuse, lexical agent retrieval, retained hybrid consumers and native Pi history. None of its findings requires abandoning those decisions.

The parent inspected the cited critical paths, revised all nine concerns in the design, and requested the user's decision on the continuation extent. The user selected a next reference continuing from the opened match to the document end, with pages loaded only on request. The dispositions below mean **addressed in proposed design**, not implemented, reproduced, independently re-reviewed or approved by Oracle. The original BLOCK verdict is preserved; Oracle has not reviewed the revised document.

## Blocking findings

### Short tools lacked a precise causing-message authority bridge

**Verified mechanism:** `convex/domain/workbenchContracts.ts:272` requires a framing pin and `input.messageId` for framing observations; `convex/domain/savedMaterialAgentOperations.ts:74` records only capture/hash. `convex/domain/workbenchAgent.ts:724` derives a message only when one is active. A mission ID alone does not preserve the current message/instruction contract.

**Affected behavior:** Acquisition, search, reading, new citations, continuation after an agent save and provider admission in multi-message turns.

**Revision:** Introduce a closed documentary pin containing the verified scope/cause and acquisition or capture identity. The shared framing authority resolver interprets historical and new pins once. Operation references inherit the issuer's verified cause; inventory and ambiguous supplied-URL references are issued for an explicit active-message context. Search now takes a document reference instead of bare capture ID, preserving the short schema and its authority. No first-message fallback or model-supplied authority flag is allowed.

**Required proof:** Real multi-message acquisition/search/read/save/steer operations retain the correct cause and reject mixed/stale causes without changing the saved revision. No target runtime behavior was executed during review.

### Capture visibility after Start did not satisfy Sources evidence eligibility

**Verified mechanism:** `convex/domain/sourceUsage.ts:662` and qualification reservation in `convex/sourcesMission.ts:448` require membership in `sourcesMission.captureIds`. `sourcesMission.retainCapture` at line 876 previously populated it only for `make_source_consultable`.

**Affected behavior:** Reading and qualifying an uncited framing capture after Start, documentary controls, coverage and materialization.

**Revision:** Initialize the existing Sources available-capture ledger during the actual Start/preparation transition with eligible committed dossier captures. Do not create acquisition work, qualification or retained membership. Generalize common acquisition reservation/registration at the same existing owner for later acquisitions, preserving work allowances and idempotency. Do not require a redundant acquisition just to register an existing document.

**Required proof:** Two pre-Start captures, only one cited; real Start exposes both; the uncited one can subsequently be read, qualified and materialized with no new provider acquisition. No automatic qualification or membership appears at Start.

### Existing capture lifecycle supplied cleanup, not import recovery

**Verified mechanism:** `convex/sourceCaptures.ts:112` returns `shouldExecute: false` for an existing key regardless of status. Attachment at line 311 requires the expected reserved/identical state; `convex/evidenceArtifacts.ts:1169` can reconcile stale uploaded/orphaned storage. These facts do not establish resumable import.

**Affected behavior:** Interruption before upload, after upload/attachment, after commit and during concurrent reuse.

**Revision:** Define local-import recovery transitions within the capture owner. Preserve one root/hash key and capture identity. Record exclusive authorized attempt ownership/revision; reuse committed imports, verify/finalize attached bytes, reclaim abandoned or reconciled imports under new authority, refuse stale writes, and coordinate reconciliation with the current attachment/owner. This local deterministic recovery does not loosen provider unknown-dispatch rules or add a second ledger.

**Required proof:** Concurrent/import interruption cases yield one canonical identity, protect active attachments, reclaim abandoned storage, preserve historical results and never fall back to network acquisition.

### Historical completeness, dates and normalization provenance were under-specified

**Verified mechanism:** `convex/workbenchPublicContextActions.ts:730` can record acquisition completeness as unknown. Existing captures permit only complete/partial, while `convex/domain/sourceCaptureState.ts:53` maps a committed nonpartial capture to full. The capture schema at `convex/schema.ts:538` lacks an immutable documentary-date snapshot and explicit unknown original-normalizer provenance.

**Affected behavior:** Imported availability, later date/provenance checks and analyst-facing completeness labels.

**Revision:** Store immutable metadata using existing date validators; support explicit unknown representation completeness; distinguish qualification extent and stored representation. Preserve known acquisition/document dates and conflicts, leave missing original retrieval/normalizer identities unknown, and identify the import's identity-preservation protocol separately. Update the domain/presentation mapping so unknown is never shown as complete. Import time is not acquisition/publication time.

**Required proof:** Unknown-completeness and conflicting/metadata-only-date imports retain exact bytes and metadata through search/read/provenance and the existing workspace projection.

## Watch findings

### Canonical normalization and qualification selection needed an exact boundary

**Verified mechanism:** `convex/sourceCaptureActions.ts:341` stores text returned by `prepareQualificationInput`; `normalizeQualificationText` already exists separately at `convex/integrations/evidenceNormalization.ts:280`. Retained qualification at `convex/sourcePreparationActions.ts:378` uses capture selection-policy/completeness fields.

**Revision:** Specify the actual existing normalization sequence for new captures: protocol normalization followed by `normalizeQualificationText`, storing its full text/hash/byte result and real composed identity. Move selection to qualification consumers and explicitly choose their preparation policy for new canonical captures. Preserve legacy field semantics and never re-normalize historical import bytes.

**Required proof:** New byte/hash equivalence and preparation-policy selection, separately from historical compatibility. No new normalizer or qualification framework is justified.

### Canonical descriptors were understood, but old/new inputs and results needed concrete branches

**Verified mechanism:** `convex/execution/agentCatalog.ts:160` requires the same descriptor instance per name. The descriptor input is `VObject` in `executionProtocol.ts:74`; model input projection does not automatically project result JSON (`agentDefinition.ts:172`, line 184). Sources 6 is occupied by the retained-method binding in `convex/qualificationAgentMethods.ts:11`.

**Revision:** Specify closed historical/new request branches, exact definition-specific native objects and pre-dispatch mixed-form rejection. Select the old/new closed result constructor at the shared operation owner before retaining the outcome. Extend the existing native projection to select the matching result validator/key as well as its input, preserving historical nested wire validators and prepared fingerprints instead of broadening their keys in place. Preserve old continuation/result semantics and already-admitted invocation replay, with no new registry. Correct the next expected Sources binding to 7; Workbench 10 and inspection 3 remain expected at this baseline.

**Required proof:** Registry/profile conformance, mixed and wrong-definition refusals, and exact replay of a previously admitted old invocation rather than only newly seeding an old mission.

### A focal context could not produce the promised continuation by default

**Verified mechanism:** `convex/sourceRetrievalActions.ts:939` defaults to a quotation plus 512 characters on either side, under a 6,000-character page. Quotations are at most 4,000 characters (`sourceRetrieval.ts:89`), so that extent normally fits in one page.

**User decision and revision:** New match references select a forward-readable extent from the focal context start to capture end; the first page includes the quote, later pages require explicit next-reference calls. Beginning references select the whole captured extent from zero. Historical focal-window semantics remain for pinned calls. The regression must continue the actual opened match after save rather than silently substitute an unrelated beginning read.

**Required proof:** Genuine multi-page match-context continuation, final-page termination, immutable identity and no reacquisition.

### Namespace and inventory changes omitted several consumers

**Verified mechanism:** Corpus namespace construction also exists in `domain/sourceRetrievalPolicy.ts:223`, vector filtering in `sourceRetrievalActions.ts:465`, and reader selection in `sourcesWorkspace.ts:555`. `sourceRetrieval.ts:856` independently rejects more than 60 source IDs.

**Revision:** Centralize namespace construction in existing retrieval policy and update index publishers/readers, state checks, embeddings/vector scope, `SourceReviewReads`, Sources UI backend, evaluation fixtures and purge together. Remove the complete inventory path's cutoffs, enumerate multiple captures per source and keep native/platform capacity checks explicit. No global index registry or new inventory service is justified.

**Required proof:** Cross-consumer namespace equivalence, multiple captures and more-than-60 inventory, preserving real capacity enforcement and optional hybrid scope.

### Regression coverage omitted changed admission, settlement and policy projections

**Verified mechanism:** `convex/providerCalls.ts:687` currently excludes preparation/source grant fields from Workbench framing receipts; the new capture source identity must not change that grant mapping. `executeScheduledOperation` is the real durable boundary at `convex/execution/operations.ts:82`. `conversationTurnForAnalyst` at `convex/execution/conversations.ts:589` currently removes only response-control policy, so a newly stored citation field would leak unless explicitly omitted.

**Revision:** Add real scheduled-operation admission/settlement tests, not helper-only tests: refuse foreign/invalid targets before DNS/reservation, keep Workbench and Sources grants distinct, record no receipt for cached reuse, preserve known costs under cancellation/unknown dispatch/ack loss and prevent stale adoption/another paid call. Cover event and conditional citations in both modes, historical/new missing snapshots, inherited associations after policy change and omission from analyst projections. Add the explicit authority, ledger, import, metadata, compatibility and inventory regressions described above. Raw ranges without indexed quotations remain ineligible for Sources qualification.

**Required proof:** Planned integration assertions against actual state, effects and serialized requests. Existing research tests are not implementation evidence for these changes.

## Complexity arbitration

Oracle's proposed corrections localize actual existing knowledge rather than introducing speculative abstractions. The authority receipt reuses message/pin/observation identities; the Start bridge reuses the capture ledger; import recovery remains in capture mutations; compatibility is finite wire translation; namespace construction has one existing policy owner. The model-facing interface remains smaller than the mechanics it hides. These changes target real current consumers, make future edits more local and avoid extra service chains, parser copies, provider retry loops and generic registries.

The parent accepted all nine concerns; none was suppressed or rejected. Expanding contextual extent was the only additional user choice requested, and the user selected forward continuation. The policy remains optional, server-enforced, default false and fixed for the active turn. No production behavior was changed to claim a finding resolved.

## Coverage limits and next gate

Oracle did not exhaustively inspect every evaluation fixture, generated native profile, frontend rendering path or installed Pi serializer. Live relevance, deployed data population, crash/OCC behavior and target runtime correctness remain unverified. The 53 earlier research tests remain baseline evidence. Oracle's design-revision effort estimate was short, not an implementation estimate or measured duration.

At this initial review stage, the parent verified source evidence for the critical authority, ledger, import, metadata and projection paths and revised the proposed contracts; recheck and user approval were pending. The later recheck and final user-approved state are recorded in the follow-up linked above. Implementation, live provider work, deployment, qualification, commit and push are not authorized by this record.
