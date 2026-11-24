---
date: "2026-11-24"
repos:
  - identifier: "agentic-resilience-workbench-proto"
    sha: "e8e32ec11983d06a91b582c820e6f097360a35f9"
topic: "Conversation capacity, dossier purge traversal and Sources measurement gaps"
type: research
flow: tdd
status: complete
---

# Research: Conversation Capacity and Complete Dossier Purge

## Scope and method

The user authorized targeted research following the [independent implementation review](42-review-current-sources-implementation.md): reproduce the conversation and purge defects, inspect their complete paths, and establish what performance evidence remains missing before revising the technical design. Production changes and implementation remain outside this phase. Current source and installed dependencies were inspected directly; temporary integration probes exercised real application handlers and storage without mocking internal collaborators. The probe source and logs are retained in [validation evidence](validation/review-corrections-research/request.json); the temporary test was removed from the executable test tree afterward.

The two reported defects reproduce. The conversation problem also affects writing one sufficiently large logical response. Purge has seven steps with the same incomplete parent traversal, beyond invocation payloads and Pi sessions. Existing synthetic projection measurements remain useful, but do not establish the required retained-preparation or legacy-ancestry cost.

## Fragmented records still share one transaction

The [storage adapter](../../../convex/integrations/agentStorage.ts:12) splits text into component messages and saves every part inside the caller's mutation. One application delivery stores either a component message ID or a JSON array of IDs. Its reader flattens all requested groups into one `getMessagesByIds` component query, then reconstructs complete strings.

```text
Publication mutation
  saveConversationMessage
    saveMessage(part 1), saveMessage(part 2), ... in the same transaction

Public history query
  paginate delivery metadata by number of records
  readConversationMessages(all selected storage references)
    component getMessagesByIds(all fragments)
  return complete text for every selected delivery
```

Installed Convex Agent 0.7.9 stores both `message.content` and extracted `text` for these messages (`src/component/messages.ts:348`), and its reader fetches complete documents (`:874`). Eight texts of 1,100,001 UTF-8 bytes therefore require at least 17,600,016 document bytes, before metadata. Fragmentation protects individual document size; it does not separate transaction accounting. Installed convex-test 0.0.62 accumulates nested-call reads into their parent transaction.

Both authenticated public readers reproduce the error `Read too much data in a single function execution (limit: 16777216 bytes)`: [conversation listing](../../../convex/execution/conversations.ts:665) and [Workbench history](../../../convex/workbench.ts:799). The probe first saves each of eight replies separately and verifies an exact single-reply read, then requests twenty deliveries. Failure occurs in `readConversationMessages`, not during authorization or fixture insertion. The stored text is not shown to be lost; the requested page cannot be returned.

A separate probe calls the real storage writer with one 8,400,001-byte ASCII response. It also fails on **read capacity**, inside the component save path. This is an owning-storage-boundary reproduction, not an end-to-end paid generation or proof that a deployed model has emitted that size. The size is a diagnostic example, not a proposed cutoff or measured exact threshold. It proves that shrinking history pages alone would leave a publication failure.

The [official Convex limits](https://docs.convex.dev/production/state/limits), checked on November 24, distinguish the 1 MiB document limit, transaction read/write capacity and 16 MiB function argument/return limits. Paging delivery metadata cannot bound later body hydration, and splitting calls within one query does not reset its transaction accounting. No generation-size ceiling is justified by these findings.

## Consumer boundaries require different treatment

| Consumer | Current behavior | Research conclusion |
| --- | --- | --- |
| `workbench.history`, `conversations.listMessages` | Select up to twenty delivery records, then hydrate all bodies. History descends, listing ascends. | Both capacity failures reproduced. Pagination and body retrieval must preserve identities, order and continuation without dropping unreturned deliveries. |
| Frontend `connected-start-workspace.tsx:474` | Converts every `m.text` into a complete text part; requests twenty more records at line 804. | A fragmented body contract affects its consumer; returning an unlabelled prefix would violate current semantics. No browser change or verification occurred. |
| `history.ts:598`, `consult_conversation` | Loads one complete message before applying the operation-result fragment capacity. | A small output page does not bound input reads. Same shared mechanism, source-derived; no new dispatcher reproduction in this phase. |
| `readTurnInstructions`, `conversations.ts:738` | Reads user deliveries in batches of twenty within one caller transaction; only nonnative context checks its old aggregate context bound. | Subqueries do not create independent transaction budgets. Aggregate active-turn capacity needs coverage; assistant-history failures do not themselves reproduce this branch. |
| Context, instruction validation, control replay and Pi control input | Other adapter consumers read one or two user/control messages. | Preserve authority, content identity and exact control text; do not force display pagination into these contracts. Call sites were inventoried with `rg`. |
| Publication and settlement | Response publication uses the shared writer; `piControl.publicationState:1014` restores mission result and returns complete published text. | Follow-through must include acknowledgement/recovery and result transport, not only the visible history query. Publication storage failure reproduced; settlement-size behavior remains source-derived. |

The current delivery schema has no body-byte manifest. The existing retained-text owner already has fragment metadata and capacity-aware deletion; it is an available mechanism to evaluate in design. This research does not choose a new store, schema, transport or automatic migration.

## Seven purge steps mistake an empty parent window for completion

[The purge action](../../../convex/dossierPurge.ts:600) repeatedly invokes each ordered step while it returns `true`, then permanently advances to the next step. The affected steps inspect the first `DOSSIER_PURGE_BATCH` parents, delete their children, and leave those parents in place until a later step. Once these first parents have no children, the step returns `false` without visiting later parents. Parent deletion then destroys the route to the skipped children; rerunning the action does not repair that loss.

```text
first 100 parents: no remaining children
later parents: children still exist
  -> child-cleanup step returns false
  -> later parent-cleanup step deletes all parents
  -> dossier deletion succeeds with orphaned children
```

| Step in `dossierPurge.ts` | Skipped descendants | Evidence this phase |
| --- | --- | --- |
| `claimEvidence:68` | Evidence under later claims | Source-confirmed traversal defect. |
| `sourcePassages:107` | Passages under later source versions | Source-confirmed traversal defect. |
| `proposalItemsAndReviewItems:173` | Review items under later revisions; proposal items under later revisions **or later proposals within one revision** | Source-confirmed at both parent levels. |
| `proposalsAndPreparations:203` | Proposals and preparations under later revisions | Source-confirmed traversal defect. |
| `sourceCapturesAndPreviews:226` | Captures and previews under later sources | Orphaned capture reproduced after 200 empty source parents. |
| `piCommitsAndSessions:291` | Sessions and commits under later missions or conversations | Orphaned mission session reproduced after 200 empty missions; conversation sibling source-confirmed. |
| `agentInvocationPayloads:316` | Payload rows and their retained text under later invocations | Orphans reproduced after 100 and 200 empty invocation parents, including a repeated full purge. |

This is not a universal defect in every batch loop. Direct run-indexed deletion removes selected parents and therefore advances naturally. [Operation cleanup](../../../convex/execution/operations.ts:83) drains an observation and then deletes its request before advancing. Invocation-owned response cleanup and mission-result cleanup also delete their parents after draining references. These existing mechanisms should be evaluated before introducing another traversal abstraction.

The purge comment separately permits retaining some shared/component state. Pi commit rows may reference retained texts under a session-owned key, while `dropSession` deletes commit rows without deleting those texts. This is a separate physical-retention policy question, not evidence that the parent-window correction covers all stored bytes. Existing component/shared-state policy was not changed or silently included in this correction mandate.

## Child batches and quota retry already behave differently

The final diagnostic run contains thirteen cases: seven fail for investigated defects and six pass. Passing controls include payload cleanup with no empty-parent prefix; session cleanup with zero, exactly 100, 101 and 201 commits; and a purge interrupted after a step, restarted, then invoked again after completion. The last control retains one audit event and restores one reserved analysis exactly once. The payload cases also verify that a second dossier remains present.

Thus a child count of 101 alone does not expose the parent traversal defect: the session child loop already drains multiple batches. Future regressions need independent parent and child dimensions, empty and populated prefixes, multiple parent levels, interruption after actual child deletion, repeated completion, cross-dossier data preservation and retained-fragment capacity. The new probes do not claim full rollback, concurrent-worker fencing or every failure branch is covered.

## Retained-data performance acceptance remains open

The original [projection measurements](validation/sources-harness-efficiency-impl/projection-after.json) exercise real handlers over synthetic five-capture fixtures. Their logical counts include reads outside `SourceReviewReads`, but do not measure a retained live preparation. The [November 22 follow-up](../../../docs/verification/2026-11-22-independent-review-followup.md) provides additional five- and sixty-source cache measurements. Its fixture-based capture-index scope excludes direct gets and other tables; it does not replace the broader retained-data acceptance check.

The retained traversal file contains projected event payloads and source provenance, not the persisted legacy predecessor-request graph. Current `mission-history.test.ts:244` exercises a synthetic three-plus-page legacy chain, including divergence and cycles. The resolver in `history.ts:244` reads predecessor requests until it finds a frontier-bearing pin, then validates legacy fragments. Correctness coverage does not establish its row/byte cost on an archived chain.

Archived data is available locally at `/home/abdwhb/.cache/workbench-evaluations/framing-v9-qualification-20261120-ready`. The inspected `sources-interrupted-preparation/retained-after.json` contains real preparation and mission records, but its top-level export does not contain the complete captures, qualifications, contributions and operation graph needed for faithful query replay. The archive's historical history measurement concerns payload traversal; it is not a current before/after measurement of legacy ancestry. No matching completed retained-preparation/ancestry benchmark was found in the inspected task artifacts and verification report. No new benchmark, backend export or provider call was performed.

## Verification and next design boundary

### November 24 follow-up: audit the proposed storage reuse before choosing

The user requested a storage audit before accepting a TDD direction. The [audit and comparison](validation/storage-choice-audit/audit.md) distinguish existing immutable staging from whole-body convenience paths. Four new capacity/API probes and seven selected existing regressions passed. A text of 18,874,369 bytes can be staged and published through the real Pi storage handlers, read by a bounded range and deleted in separate transactions. At that size, `retainCompleteText`, `readRetainedText` and streaming `sealRetainedText` each fail their whole-body transaction. Reusing the module without selecting and integrating its staged/range path would therefore repeat the problem.

The installed Convex Agent component also supports `hideFromUserIdSearch`: a probe confirms it avoids the additional extracted-text copy while preserving the original content. This flag is not forwarded by the application's current high-level save helper. Duplication is consequently configurable, not a technical impossibility of the component. Both options still require bounded preparation, atomic application publication, caller authority, recovery and cleanup. The recommendation favors the existing immutable staged/range primitives because they already localize these storage mechanics; no choice has been approved and the TDD is unchanged. The new measurements are synthetic capacity probes, not the outstanding retained-preparation or ancestry benchmark.

Run command: `pnpm exec vitest run src/__tests__/convex/execution/review-research-probe.test.ts --maxWorkers=1`. The [final log](validation/review-corrections-research/probe-final.log) records seven expected diagnostic failures and six passing controls. [Probe source](validation/review-corrections-research/review-research-probe.test.ts) can be copied back to that test path for reproduction. The first run had three invalid fixture-status errors, preserved in `probe-first.log`; these are not counted as defect evidence. All final cases ran again after correcting that fixture. Conversation probes enforce actual convex-test transaction limits; purge probes establish traversal semantics, not deployed resource measurements.

No production code, persistent test suite, dependency, schema, backend or archived evidence was changed. No qualification, browser test, build, typecheck or full regression suite ran. The diagnostic failures remain unfixed by design.

The next TDD revision must settle bounded publication/body retrieval and caller compatibility, then localize complete purge traversal across all seven affected steps. Retained-data measurement remains an explicit acceptance obligation. The existing approved Sources completion, Pi ownership, authority and no-`repetition_stop` decisions need not be reopened. Design must distinguish observed transaction failures from untested recovery/transport branches and decide the separate physical-retention policy explicitly if that policy is brought into scope.


## November 24 follow-up: completion and deletion dependencies

The user subsequently selected progressive retained-text storage, deletion of old conversations without conversion or a legacy reader, and removal of Convex Agent. [TDD 29](29-tdd-sources-harness-efficiency.md) records that decision. This supersedes the earlier audit subsection's statement that no storage choice had been made. The following source inspection prepares the remaining program decisions; it does not establish their implementation or approve a new validation boundary.

### Finalization still transports and validates full bodies

[Invocation finalization](../../../convex/execution/invocationLifecycle.ts:1394) parses the original completion arguments and validates the pinned definition's schema inside the mutation. It calls the domain completion, validates the resulting artifact, publishes the conversation reply and stores the mission result in that transaction. [Mission result storage](../../../convex/execution/missionData.ts:188) switches from inline JSON to `retainCompleteText`, but that helper does not split the transaction. [Publication recovery](../../../convex/execution/piControl.ts:1014) reads the whole result and renders it again. Replacing only the three storage helpers would leave large mutation arguments, full JSON validation and reply rendering at the same capacity boundary.

The catalogue exposes different actual requirements; no generic streaming JSON framework follows from this finding:

| Domain | Content work and current-state work |
| --- | --- |
| Workbench | [Completion](../../../convex/domain/workbenchAgent.ts:523) checks nonblank prose, obtains current instructions and operation receipts, runs response control, and combines explanation with deterministic confirmations. [Response control](../../../convex/responseControl.ts:197) binds the draft hash to authoritative fact hashes and may require a correction or an advisory operation. Moving text work cannot discard these dependencies or publish the raw draft instead of the rendered reply. |
| Sources | [Completion](../../../convex/domain/sourcesAgent.ts:499) checks admitted preparation/revision/work, outstanding work and instruction treatment. [Handoff](../../../convex/domain/sources.ts:1395) resolves current captures, controls and restrictions and persists the prepared material. Its [capacity owner](../../../convex/domain/sources.ts:1148) already constrains the domain artifact separately from transport capacity; large-text support does not authorize removing that invariant. |
| Documentary inspection | [Completion](../../../convex/domain/savedMaterialInspection.ts:179) checks unique inspected capture references and their current ownership, storage and authorization. Those checks require current database state. |
| Validation fixtures | [Conversation validation](../../../convex/domain/conversationValidation.ts:45) preserves exact nonblank text; [execution validation](../../../convex/domain/executionValidationAgent.ts:103) compares the total with the mission scope and completed work. They must exercise the same production completion boundary. |

An internal Convex action is server code, not a browser or model assertion. It can read immutable fragments through bounded queries and use the existing validators for content preparation, while a mutation retains live authority and effect adoption. This is a design option, not a tested new path: exact content/projection binding, database-backed ID validation, unchanged current-state dependencies, rendering identity and action memory must be specified. The alternative is progressive validation inside mutations, which would require more adaptation of the current full-object validators. No new dependency was selected or evaluated.

### Deleting chat rows alone breaks surviving dossier consumers

[Instruction projection](../../../convex/domain/workbenchInstructions.ts:73) resolves each instruction's original delivery and raises `conversation_message_unavailable` if the text is absent. Both Sources and Workbench context call this projection. The instruction record already owns its interpreted need, treatment, framing reference and preparation/need references; deleting a chat must not silently erase an already transmitted need or reinterpret that field as the analyst's exact wording. The normal product contract retains original wording. The explicitly requested one-time reset is an exception, not a reason to weaken normal integrity handling of missing messages.

[Approval status](../../../convex/execution/approvals.ts:94) derives supersession from research generation, not from conversation existence. Deleting an originating message therefore does not invalidate an old pending approval. Conversely, changing the whole run generation merely to retire chat would affect independent research. The reset design must distinguish pending conversation-origin requests from recorded analyst decisions and standing grants.

[Pi publication hold](../../../convex/execution/piControl.ts:74) fences worker admission, and recovery can revoke expired writer leases. It does not by itself fence all public conversation creation or writes. [Conversation lookup and creation](../../../convex/execution/conversations.ts:338) can recreate a missing conversation. Existing authority checks require an active turn for conversation missions, but staging, retained observation, settlement and public writers must all be covered during cutover.

[Provider billing correlation](../../../convex/providerCalls.ts:240) requires the invocation and complete request-payload record as well as the provider receipt. Deleting conversation-owned execution records before billing settlement could prevent factual cost settlement. No new paid model call is needed to resolve this design issue; existing receipt and billing owners remain authoritative. The deletion manifest must distinguish execution records still needed by accounting, documentary provenance or durable operations from disposable conversation transport and transcripts.

These findings come from current source at `e8e32ec11983d06a91b582c820e6f097360a35f9`. No additional runtime probe, test, provider call, data deletion or production modification was performed in this follow-up. The earlier capacity probes remain the runtime evidence for the storage defects; they do not prove the proposed completion or reset protocol.


The user then accepted immutable-content validation in an internal Convex action followed by atomic mutation-time adoption. They also clarified that the reset deletes old messages to remove the legacy reader; it must preserve conversation functionality and existing documentary requests, results and decisions. TDD 29 now narrows the earlier deletion-graph proposal accordingly. No broader execution-graph purge is part of that reset.


### Latest decision: migrate once before retiring old storage

The user superseded the deletion/reset choice with a one-time migration preserving message content and application references, followed by functional verification before removing obsolete copies and Convex Agent. The prior source findings remain valid; deleted-original projection and execution-graph cleanup are no longer proposed remedies. [TDD 29](29-tdd-sources-harness-efficiency.md) now requires unchanged delivery/conversation/turn identities, exact-body verification, continuation compatibility and end-to-end verification before retirement.

The inspected [storage adapter](../../../convex/integrations/agentStorage.ts:12) already identifies the ordered component records for each logical delivery. A temporary migration reader can retrieve those records in separate bounded queries, preserving the adapter's exact content extraction without its aggregate hydration. [Published replies](../../../convex/execution/conversations.ts:818) bind delivery and turn to a content hash, while control exchanges can use request identity hashes; migration must compare independently derived body hashes rather than overwrite those identities. Keeping delivery rows preserves incoming domain references. This is source-supported design feasibility, not an executed migration or proof of all cursor/runtime behavior. No data has been migrated or removed.
