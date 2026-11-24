# Final independent migration design and outline review

Date: 2026-11-24. Scope: pre-implementation review of the revised Sources harness efficiency design and its seven-phase migration outline against the current source. This report does not approve implementation, deployment, migration or deletion.

## Verdict and evidence

**REQUEST CHANGES: two distinct medium-severity compatibility gaps must be specified before implementation.** Oracle returned BLOCK for the shared open-stream transition; Code Reviewer independently reported that same gap and an additional completed-mission-result transition gap. Oracle also retained four nonblocking implementation watches. The additional Code Reviewer finding is not an explicit disagreement between reviewers.

The retained-text storage direction, internal-action preparation and atomic mutation adoption remain viable. Neither reviewer requests another executor, a generic storage framework, a permanent legacy reader, provider replay or reopening the approved storage choice. The user-selected sequence remains migration once, exact-data and functionality verification, then retirement of old storage.

Reviewed branch: `sources-workflow-no-legacy`; HEAD: `e8e32ec11983d06a91b582c820e6f097360a35f9`. Both reviewers verified unchanged document hashes and a clean tracked checkout before and after review.

| Document | SHA256 | Frozen review copy |
| --- | --- | --- |
| TDD 29 | `865ec50b63c5e294d1f5594a6dff82d3ce049cdbdc2ecc8a8fd697dd9741eb60` | [Reviewed TDD](validation/final-migration-design-review/29-reviewed.md) |
| Outline 31 | `89ab850e96104b4dcb7a4e6574bd6f107e34162581dc61d55981173ca9b9c02b` | [Reviewed outline](validation/final-migration-design-review/31-reviewed.md) |

The independent read-only lanes used Codex gpt-6-astra xhigh for Oracle and Codex gpt-6.1-sol xhigh for Code Reviewer. Code Reviewer applied the requested TDD and code-smell guardrails. Preserve the complete reports alongside this synthesis: [Oracle](validation/final-migration-design-review/oracle-report.md), [Code Reviewer](validation/final-migration-design-review/code-reviewer-report.md), and [review manifest](validation/final-migration-design-review/request.json).

## Blocking: upgrade existing open retained streams

**Medium; both reviewers.** The new finalizer requires fragment hashes and end offsets accumulated during append. Existing open streams persist packed fragments, a whole-content hash checkpoint, sequence information and a tail, but their manifest arrays remain empty until the current sealer rereads every fragment. Updating append does not reconstruct the missing prefix metadata; the aggregate hash cannot supply individual fragment hashes or UTF-16 boundaries. See [retainedText.ts](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/retainedText.ts:54).

A conversation/Pi worker hold is insufficient because one-shot Sources preparation also writes these streams, including invocations without a mission. See [preparationModel.ts](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sources/preparationModel.ts:159) and [invocationLifecycle.ts](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/invocationLifecycle.ts:124).

**Required design correction:** add a shared-stream upgrade prerequisite before deployment of the changed append/finalize protocol. Inventory old unsealed streams and their producers; specify either a verified fence/drain that leaves no incompatible stream requiring continuation, or a resumable bounded metadata backfill under a stable append frontier. Preserve stranded diagnostic content, text IDs, sequence acknowledgements, hash checkpoints and complete/incomplete status. Do not restore a whole-body transaction as the transition path.

**Acceptance:** start from baseline-produced persisted state containing a packed fragment and tail, then exercise conversion, append and finalization with interruption/retry and bounded transaction work. Include an active one-shot producer and an abandoned incomplete diagnostic. Verify exact text and unchanged identities. Fresh streams created solely by the new implementation do not establish upgrade compatibility.

This is a confirmed source-layout mismatch with a derived transition consequence. Whether the selected deployment contains affected records remains unknown.

## Blocking: convert existing completed textual mission outcomes

**Medium; Code Reviewer.** Existing completed missions store either an inline result containing text or a retained JSON result object through `resultTextId`. Migrating conversation deliveries alone does not convert either representation to the new compact final-text reference. See [missionData.ts](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/missionData.ts:188).

This matters after publication but before native acknowledgement: [publicationState](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/piControl.ts:1032) reads the mission result, and [Pi recovery](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/piMission.ts:1639) uses the rendered final prose to reconcile its transcript. Removing the old consumer can break inspection or settlement; retaining it indefinitely leaves the whole-body path and duplicate final-prose representation unresolved.

**Required design correction:** distinguish domain/model result validators from the new persisted outcome representation. Extend the migration inventory to inline and fragmented completed textual results, including completed-but-unsettled sessions. Reuse a migrated delivery's text reference only when exact equality and ownership permit. Preserve definition pins and immutable invocation/journal bytes, and specify recovery across conversion.

**Acceptance:** migrate baseline-produced inline and fragmented results, including a completed-but-unsettled session; reopen through the new handlers with Convex Agent absent. Verify exact prose and confirmations, one completion/delivery, unchanged effect/provider accounting, successful terminal settlement and retained-result inspection.

This is a source-derived design omission, not a reproduced runtime failure.

## Nonblocking implementation watches

### Preserve the complete Workbench response-control transaction

**Medium; Oracle.** Workbench completion includes current instructions, framing/research facts, adopted operations, deterministic confirmations and effectful response control. Response control can persist correction state, check continuation capacity and enqueue advisory work; it cannot move wholesale into a pure action. Its full review identity also includes active analyst messages, observations and framing receipts beyond the narrower `factsRevisionHash`. See [workbenchAgent.ts](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/workbenchAgent.ts:523) and [responseControl.ts](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/responseControl.ts:173).

Keep effects in the adoption mutation, bind preparation to all rendering/check dependencies, and preserve correction/unavailable/reserve behavior without hydrating large drafts in that mutation. Exercise changed facts between preparation/adoption, advisory completion, correction admission failure and lost acknowledgement. The TDD substantially requires these controls already.

### Own cleanup from the first staged fragment

**Medium; Oracle.** Staging creates keyed text and fragments, while purge discovers text through durable owning references. Linking only a completed preparation leaves a crash window; replacing a preparation can similarly lose its predecessor's cleanup reference. See [stageRetainedText](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/retainedText.ts:232) and [dossierPurge.ts](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/dossierPurge.ts:353).

Make incomplete and superseded preparations discoverable from initial staging. Define deletion ownership when mission results and deliveries share final text. Exercise first-fragment interruption, re-preparation after changed facts, purge restart and preservation of still-referenced text. No generic garbage collector is required.

### Bound component retirement by bytes as well as document count

**Low; Oracle.** Installed Convex Agent 0.7.9 thread deletion defaults to pages of 100 complete message documents. Pagination alone does not establish a safe transaction for large records. See [component deletion](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/node_modules/@convex-dev/agent/src/component/threads.ts:226).

Choose a demonstrably safe deletion limit from actual record sizes or a conservative platform-derived bound. Verify interruption/resumption before removing the component. Preserve the existing retirement gate; this does not require a component patch or a different storage choice.

### Keep retained-data performance acceptance open

**Medium; Oracle.** The retained preparation graph and legacy cursor ancestry inputs remain incomplete. Historical synthetic projection measurements and real history-payload replay do not cover those missing cases. See [research 43](43-research-conversation-capacity-and-purge.md).

Retain the open acceptance item until complete retained inputs and actual before/after row/byte measurements exist. Missing evidence does not invalidate the storage architecture, but prevents claiming full TDD acceptance or measured improvement for those paths.

## Conclusions without additional findings

Both reports support the separation between immutable action preparation and mutation-time authority/adoption, preservation of Sources atomic acceptance, exact conversation identity/text/publication metadata, and distinct application versus body hashes. The copy/verify/switch/functionality/retire sequence and prohibition on old-only rollback after new writes address the identified migration risks.

The seven purge traversals and both nested proposal-parent dimensions are explicitly covered. Pi remains the generation, replay and compaction owner. The planned testing strategy uses defect reproduction, observed characterization and falsification at real owning boundaries. No additional speculative abstraction or duplicate executor was identified.

## Disposition and verification limits

Revise [TDD 29](29-tdd-sources-harness-efficiency.md) and [outline 31](31-structure-outline-sources-harness-efficiency.md) to specify the two persisted-format transitions before treating the design as ready for implementation. Carry the four watches into implementation acceptance rather than reporting them as resolved by source inspection. This review did not select a transition mechanism or alter the approved documents.

Both lanes performed source and document inspection only. No tests, browser verification, migration, backend publication, provider calls, dependency changes or deletion ran. Historical probes were not rerun. Deployment contents, upgraded recovery, migrated journeys, action-memory behavior, cleanup capacity and retained-data performance remain unverified. Parent consolidation reread the shared-stream, stored-result and terminal-recovery owners; it did not reproduce the failures.
