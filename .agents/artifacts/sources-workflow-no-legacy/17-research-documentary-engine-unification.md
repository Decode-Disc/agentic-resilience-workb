---
date: "2026-11-20T13:42:00+01:00"
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "2816370980accf0155c09d62054ca83511ca43d3"
topic: "Current documentary storage, retrieval and agent access"
type: research
flow: tdd
tags: [research, documentary-engine, framing, retrieval, native-context]
status: complete
---

# Research: Documentary Engine Unification

## Research questions and method

This research answers the six questions in [16-research-questions-documentary-engine-unification.md](16-research-questions-documentary-engine-unification.md): document representations and owners; retrieval consumers; phase authority; coverage and limits; native model input; and existing test/compatibility coverage. The scope is the current implementation, not the target architecture. The user selected research followed by technical design.

The parent traced authority and native delivery; one read-only codebase-analysis agent traced storage, indexing, consumers and cleanup. Its completed findings were checked at the material boundaries. No production code, configuration, dependency or deployed data changed. No application-provider inference, embeddings or documentary acquisition was dispatched. Repository code and installed integration paths supplied the required evidence; no external library capability recommendation required web research.

The existing [long-document probe](../../../docs/verification/2026-11-20-long-document-local-probe.md) and its [verified archive](../../../scripts/evaluations/archives/20261120T122604301Z-long-document-local-probe/record.json) supply real captured bytes and native serialization evidence. All eighteen module fingerprints listed by that probe still match the current files despite the newer repository HEAD. The earlier probe was not rerun. New checks below exercised existing deterministic tests.

## Summary

Framing reads retain complete acquired text as an operation observation. They expose sequential pages, without creating a Sources capture or searchable index. Sources stores immutable normalized capture blobs and derives a passage index. Existing agent search/context tools already share that capture/index implementation across Sources, Workbench and saved-material inspection. Retained analytical workflows additionally materialize selected passages into source versions.

These are related representations with different authority and lifecycle contracts. Public framing access is tied to the active turn, message, instruction version and framing revision. Capture access derives from the dossier, corpus and preparation or retained approval. The current tool projection exposes capture search only when available captures are listed; pre-Start public text does not enter that list. Successful sequential continuation after a save therefore does not imply targeted capture search is available before Start.

Active Sources explicitly indexes lexically, and its shared passage tools use lexical search. The optional hybrid pipeline shares extraction/index storage but adds embedding completion, vector search and rank fusion for retained preparation/comparison callers. Hosted semantic search is implemented, not established as active on the current Sources tool path. Pi already owns model history and compaction; current state carries compact operation status while returned reading text enters the native transcript.

## Framing text, searchable captures and analytical versions remain distinct

```text
Framing read_public_context
  public/SEC acquisition and normalization
  stageObservationText
  retainedTexts + retainedTextFragments, keyed by operation
  readingPage → excerpt + range + root read ID + continuation

Sources make_source_consultable
  inspectSource → sourceCaptures + normalized storage blob
  retainCapture → ensureSourceCaptureIndex(mode: lexical)
  sourceSearchCaptures + sourceSearchPassages
    ├─ agent search_available_material / read_in_context
    ├─ Sources reader excerpts
    └─ retained preparation/comparison lexical or hybrid retrieval

Retained approved evidence workflow
  inspected capture → selected materialized passages
  sourceVersions + sourcePassages → evidence/claim consumers
```

Public acquisition uses existing Exa Contents, public URL and SEC integration code. The public-read owner stages normalized text through the operation executor; `operationObservationRange` looks up `operation:<requestId>:observation`, verifies the retained hash and reads the requested range. The manifest has a UTF-8 content hash, byte size, UTF-16 length and fragment identities. Public read results retain document/root read ID, hash, acquisition completeness, visible offsets, date evidence and continuation. They do not create `sources`, `sourceCaptures` or preparation records. See [workbenchPublicContextActions.ts:704](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/workbenchPublicContextActions.ts:704), [retainedText.ts:449](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/retainedText.ts:449) and [workbenchPublicContext.ts:432](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/workbenchPublicContext.ts:432).

Capture reservation requires a preparation and its execution fence. Its request hash binds source, canonical URL, origin, company/SEC identity and normalization protocol. A committed capture with the same source/input hash is reused before constructing a new preparation-specific capture key. Rows bind dossier, corpus, source, preparation, execution generation, storage, URLs, hashes, versions and completeness. The search scope is `${runId}:${corpusRevisionId}:structured-v1`; rows preserve exact offsets and quotation hashes. See [sourceCaptures.ts:64](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourceCaptures.ts:64), [schema.ts:497](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/schema.ts:497) and [sourceRetrieval.ts:42](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourceRetrieval.ts:42).

Follow-up schema and launch inspection during the TDD confirms that `sources` belongs directly to `runId`, with no required corpus or preparation field. `researchLaunch.ts:192` already creates a draft corpus revision and makes it active on the framing-only path. The pre-Start obstacle is therefore not absence of a dossier source identity or draft corpus; it is capture/preparation fencing and capture-access policy. This permits evaluating an extension of the existing tables without assuming that a new corpus must be approved or a Sources preparation fabricated.

The stored capture blob contains the entire returned normalized text. Capture reading/qualification selection can nevertheless be partial; active Sources separately records representation completeness. Consequently, a partial qualification does not by itself mean the stored bytes are truncated. Acquisition time is also separate from documentary publication, filing and event dates. Both reading paths derive supported date evidence from acquired text while returning only the displayed range. See [sourceCaptureActions.ts:332](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourceCaptureActions.ts:332) and [sourceRetrievalPolicy.ts:32](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sourceRetrievalPolicy.ts:32).

Retained evidence materialization reuses inspected capture bytes and preserves required cited spans while selecting analytical passages. `sourceVersions` and `sourcePassages` remain distinct consumers, rather than aliases for the complete search index. No general migration/backfill between public observations and captures was found in these paths. See [evidenceActions.ts:120](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/evidenceActions.ts:120).

## Agent capture tools share lexical reading; hybrid retrieval has separate callers

| Current consumer | Registered or called path | Effective mechanism |
| --- | --- | --- |
| Workbench before Start | Public search/read operations | Discovery, then sequential retained-text pages. |
| Current Sources mission | Shared saved-material operations | Lexical passage search and exact contextual reading. Acquisition explicitly requests lexical indexing. |
| Workbench with authorized available material | Same saved-material operations | Same capture reader; availability derives from current capture authority. |
| Saved-material inspection | Same operations | Same reader under retained approved-corpus authority. |
| Sources document UI | `sourcesWorkspace.getSource` | Direct indexed excerpts: cited passages with neighbors, otherwise the opening passages. |
| Retained preparation/comparison and retrieval evaluation | `ensureSourceCaptureIndex` / `retrieveSourcePassages` | Lexical or optional hybrid retrieval, selected by the caller and snapshotted policy. |

The two agent tools are declared once and included by Sources, Workbench and inspection. `domain/savedMaterial.ts` calls `readApprovedMaterialForMission`, which verifies storage/hash, ensures the structured index, rechecks capture identity and returns search or context results. Its search branch calls Convex `withSearchIndex` scoped to one capture. It does not call vector search or rank fusion. The Sources acquisition caller explicitly passes `mode: "lexical"`. See [savedMaterialAgentOperations.ts:118](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/savedMaterialAgentOperations.ts:118), [sourceRetrievalActions.ts:766](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourceRetrievalActions.ts:766), [sourceRetrieval.ts:923](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourceRetrieval.ts:923) and [sourcesMissionActions.ts:83](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourcesMissionActions.ts:83).

The optional hybrid route normalizes queries, searches eligible capture indexes, obtains compatible query embeddings, applies capture/profile filters before vector top-k, and fuses rankings. Native index rows and the parser are shared; query orchestration differs from the single-capture paginated reader. Lexical indexing can complete while embedding completion remains unavailable. Missing configuration, denied provider work or embedding failures produce explicit degradation metadata with requested/effective mode. Cached vectors can satisfy work without a new provider call. The existing profile uses Workers AI BGE-M3, 1024 dimensions; this describes the local adapter, not a fresh vendor compatibility check. See [sourceRetrievalActions.ts:153](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourceRetrievalActions.ts:153), [sourceRetrievalActions.ts:324](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourceRetrievalActions.ts:324), [sourcePreparationActions.ts:399](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourcePreparationActions.ts:399) and [sourceEmbeddings.ts:11](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/sourceEmbeddings.ts:11).

The Sources reader does not invoke the agent tool wrappers: it selects cited indexed passages with one neighbor on either side, or the first twelve passages when no qualification cites any. Public approved-search endpoints remain implemented/tested, but the traced current frontend has no caller for them. See [sourcesWorkspace.ts:555](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourcesWorkspace.ts:555).

## Tool projection and server authorization both enforce the phase boundary

Workbench offers framing operations only for an unfixed scope under a suitable active instruction. It offers saved-material operations only when `availableMaterials` is nonempty. That list is computed through `requireSavedMaterialScope` and capture availability, not from public retained-text observations. In a new framing dossier without an accessible corpus/capture, capture search is therefore absent. See [workbenchAgent.ts:255](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/workbenchAgent.ts:255), [workbenchAgent.ts:665](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/workbenchAgent.ts:665) and [workbenchContext.ts:27](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/workbenchContext.ts:27).

Public execution independently requires an active Workbench mission/turn, current instruction version, framing lifecycle, no research start and a request pinned to the current revision. A prior search/read can survive an agent save if it was successfully adopted under the same dossier, mission, message and instruction version. Continuation also verifies the same target and previous continuation identity. Historical reading associations can still be projected without granting current access. See [workbenchPublicContext.ts:82](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/workbenchPublicContext.ts:82), [workbenchContracts.ts:272](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/workbenchContracts.ts:272) and [framingProvenance.ts:40](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/framingProvenance.ts:40).

An analyst save increments the active turn's instruction version; an agent save does not. New instructions/steering and other authority changes remain distinct from a mere agent revision. Start fixes the framing, changes the lifecycle and creates Sources authority; subsequent framing writes are refused. Shared mission access checks dossier ownership, active turn or research generation, deadline, resource-policy identity and terminal states. These are independent of offered tool names. See [framing.ts:342](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/framing.ts:342), [framing.ts:186](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/framing.ts:186), [framing.ts:257](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/framing.ts:257) and [authority.ts:137](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/authority.ts:137).

Capture tools bind an existing capture/hash at admission and recheck authorization/identity at execution. Current Sources allows retained preparation captures without requiring the retired corpus approval; the inspection definition retains the approved-corpus prerequisite. Continuations bind mission/run/generation, source, capture, content hash and query or context range. See [savedMaterialInspection.ts:32](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/savedMaterialInspection.ts:32), [savedMaterialAgentOperations.ts:74](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/savedMaterialAgentOperations.ts:74) and [savedMaterial.ts:27](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/savedMaterial.ts:27).

## Reading completeness, indexed coverage and response pagination are separate

| Current bound | Unit and scope | Behavior |
| --- | --- | --- |
| Acquired normalized artifact | 16 MiB bytes; Exa additionally requests up to one million characters | Explicit failure or representation limitation; not model context capacity. |
| Structured parser | 100,000 blocks / 20,000 searchable units; quotations up to 4,000 UTF-16 units | Scans the bounded representation; overflow fails explicitly rather than silently retaining a complete-looking prefix. |
| Saved search query/result | 512 query characters / 16 whitespace terms; 64 database hits/page; 30 KiB response packing | Scope-bound continuation; no-match is not documentary absence. |
| Capture context | Focal quotation plus 512-character neighbors by default; at most 6,000 characters/page | Explicit wider ranges can be continued while retaining focal passage and immutable identity. |
| Framing sequential read | 8,192 UTF-16 units/page, derived from the operation-result envelope | Next offset comes from the adopted page; continuation reads retained text. |
| Operation result | 64 KiB serialized output | Explicit capacity result; distinct from cumulative mission or provider limits. |

The structured parser returns all candidates unless `maxPassages` is explicitly supplied; materialization remains a separate selection. Stored-text verification compares exact quotation offsets and hashes before returning context. Responses distinguish capture omissions, response omissions and more-result pagination. Missing/corrupt capture or an invalid continuation yields a typed result; it does not fetch a replacement. See [sourcePassages.ts:506](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/sourcePassages.ts:506), [sourceRetrievalActions.ts:648](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourceRetrievalActions.ts:648), [sourceRetrievalActions.ts:928](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/sourceRetrievalActions.ts:928), [savedMaterial.ts:207](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/savedMaterial.ts:207) and [resourcePolicy.ts:95](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/resourcePolicy.ts:95).

The scoped-retrieval paragraph in [TECH.md:242](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/context/TECH.md:242) inaccurately groups “512 passages/source, 4,096 chars/passage” with approved indexed search. Current indexing is not globally limited to 512 and uses 4,000-character quotations. The 512 default/selection remains in retained materialization; 4,096 is the claim-input passage count, not current quotation width. The executed approved-search test indexes 551 passages and finds the final one without provider I/O. This is a documentation-to-code discrepancy, not a reason to reinstate old limits. No reference was edited during research.

## Pi already separates compact current state from retrievable document bytes

`buildMissionContext` rebuilds authoritative domain state, active instructions, obligations, pending work and references to prior observations. `operationContextObservation` includes operation kind/status, adoption, identifiers or refusal guidance; it does not copy the full successful value into the current-state projection. Detailed returned text remains in tool history and immutable journal payloads. Framing's persisted public references can additionally project cited excerpts into authoritative domain state, so not every excerpt occurrence is transcript-only. See [context.ts:98](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/context.ts:98), [journal.ts:115](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/journal.ts:115), [workbenchContext.ts:85](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/workbenchContext.ts:85) and [framingProvenance.ts:384](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/domain/framingProvenance.ts:384).

The native tool wrapper converts canonical outcomes into structured readable JSON and commits them to Pi's transcript. Confirmed application observations enter the same durable conversation with ordering/acknowledgement proof; they remain data rather than analyst instructions. `workbench_current_state` is re-rendered as a required prompt section. Pi's own estimator checks that required state and current tool declarations fit the model window. Native compaction is enabled; its calls use the same admitted lifecycle/accounting, and the application does not replace it with a documentary summary store. See [agentDefinition.ts:184](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/agentDefinition.ts:184), [piNativeInput.ts:133](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/piNativeInput.ts:133), [piMission.ts:388](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/piMission.ts:388) and [piMission.ts:1387](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/integrations/piMission.ts:1387).

The preserved long-file probe serialized no complete 372,714-byte normalized document. Its sequential framing pages never reached H20; targeted capture search brought the deeper passage into the next actual request. A read-only check of the final request bodies found a marker from the latest page/context once, in the tool result, for each path. This small sample does not prove universal deduplication: earlier read pages remain in transcript history until native compaction, and cited passages can appear in current state. Request byte counts are not token costs, cache-hit measurements or a guarantee about a future unified workflow.

## Cleanup and compatibility are part of current ownership

Dossier purge removes analytical passages before versions, derived search passages before index metadata, then capture/source rows. Storage release checks for remaining captures, upload leases and source versions; a shared blob survives while referenced. The artifact reconciler handles upload/reservation/orphaned storage lifecycles separately. See [dossierPurge.ts:29](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/dossierPurge.ts:29), [dossierPurge.ts:150](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/dossierPurge.ts:150) and [evidenceArtifacts.ts:1144](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/evidenceArtifacts.ts:1144).

The traced dossier-purge path deletes operation request rows directly and explicitly cleans invocation visible-output retained text. A repository-wide search found no call deleting `operation:<requestId>:observation` retained texts, and no purge enumeration of the shared embedding cache. The latter is keyed by profile/text hash rather than dossier. These are static ownership findings; this research did not execute a public-read purge or measure deployed orphan population. See [dossierPurge.ts:337](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/dossierPurge.ts:337) and [retainedText.ts:449](/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/convex/execution/retainedText.ts:449).

Persisted identities still distinguish approved-corpus inspection, current Sources preparation, old combined/public read versions and source-version materialization. The historical `sourcePreparationActions.inspectSource` export remains for workflow handles. Optional schema fields and parser/ranking/normalizer versions preserve old records; the traced code contains no general conversion from framing observations into captures. Existing public provenance is still represented by adopted operation read IDs. These facts describe compatibility dependencies; a migration strategy is a later design decision.

## Historical public reading coupled acquisition to an observed passage

Follow-up inspection during the TDD interview traced the first-page behavior through commit `bf5f055a` and the directed-reading implementation in `cf757669`. The earlier combined public lookup eagerly acquired text and returned a prefix. The [directed-framing plan](../../../.implementation-plans/2026-11-18-workbench-directed-framing-research.md), Tasks 2–4, separated discovery from selected reading, required a returned excerpt and adopted read identity, and explicitly required continuation when a decisive passage followed the first excerpt. It did not introduce a metadata-only acquisition operation. These are historical implementation requirements, not renewed execution instructions.

The [execution record](../../../.implementation-plans/2026-11-18-workbench-directed-framing-research.execution.md), Task 3 reading design, explains the separate retained-text representation: Pi's reader required a filesystem environment, while the existing capture reader required launched Sources authority. Retained text provided immutable bytes and continuation without creating a Sources preparation. The record explicitly describes initial and continuation calls as readings, each with its own attributable passage. This supports the original separation of framing authority from Sources; it does not establish a permanent technical requirement for two documentary storage engines.

Current `readingPage` starts at zero when no previous adopted reading exists, otherwise at the previous range end. Both initial and continuation calls use the same page projection. The inspected plan, execution record and commits contain no separate argument that the document's opening is necessarily relevant, that an automatic first page improves model judgment, or that metadata-only acquisition is technically impossible. Starting at zero follows the selected sequential-reader contract; no comparative provider experiment for that default was found in these sources.

The consequential dependency is provenance: `framingProvenance.ts` resolves public basis read IDs to returned references, and only an actually displayed nonblank passage can support a new public framing association. A metadata-only acquisition must therefore remain distinct from a reading; a later search or read may establish passage visibility under the target contract, but stored bytes or extracted metadata alone must not become observed passage evidence. This dependency must be designed explicitly rather than renaming the current read result as an acquisition.

## Existing tests cover both paths, not their missing pre-Start connection

| Evidence | Coverage and result in this research |
| --- | --- |
| `workbench-documentary-continuity.test.ts` | Executed: search/read/save/unread candidate/continue/new citation; foreign/unadopted/stale authority and invalid selectors. |
| `saved-material-progress.test.ts` | Executed: capture corruption/access failures, cold/warm reads, search pagination, Unicode range continuation and restricted documentary use. |
| `pi-context-capacity.test.ts` | Executed: compact current-state references and native compaction retaining active instructions. |
| `structured-retrieval.test.ts` | Executed: late structured evidence, required references, table context, rank ties and explicit parser overflow. |
| `source-retrieval.test.ts` | Executed: lexical and vector capture scope, index idempotency, cancellation, embedding reservations/cache and degraded/limited retrieval, using mocked providers. |
| `approved-source-search.test.ts` | Executed: 551-passages indexing, shared public/mission results, warm reuse and access/index publication boundaries. |
| `native-state-observations.test.ts`, `workbench-native-interface.test.ts` | Read selected assertions for native rereading/reopen/compaction and public reading serialization; these suites were not rerun. |
| `inspected-source-materialization.test.ts`, `dossier-purge.test.ts` | Read relevant coverage for retained capture reuse, corruption, storage/purge; not rerun. Public-operation observation cleanup is not established by the inspected tests. |

The four continuity/context/structured files passed 29 tests; `source-retrieval.test.ts` passed 14; `approved-source-search.test.ts` passed 10: **53 deterministic tests passed**. Exact commands and outputs are retained beside this document in `documentary-unification-research-tests.log`, `documentary-unification-hybrid-tests.log` and `documentary-unification-approved-search-tests.log`. They use `pnpm exec vitest run <listed files> --maxWorkers=1`. These are focused checks, not a full suite, build, browser validation or hosted search benchmark.

The ordinary missing chain is targeted capture search → contextual reading → successful provisional framing save → contextual continuation → new citation in one pre-Start mission. Existing `seedWorkbench`, real operation enqueue/dispatch, `seedInspectedEvidence`/`seedCapturedSources` and native SSE fixtures already support its constituent tests. The archived long-document probe exercised both real paths with captured bytes and native serialization, but its capture half used the retained approved-inspection definition. Merely combining those fixtures by granting artificial preparation/approval would not establish the new boundary. No test or implementation currently connects that authority/representation gap.

Follow-up program-design inspection found a material-inventory limitation relevant to the selected all-captures availability: `domain/workbenchContext.ts` reads 61 source rows and blocks above 60; `domain/sourcesAgent.ts` reads only 61 candidates. The former additionally projects captures by source rather than enumerating every stored capture. These are code findings, not a measured provider-capacity limit or a claim that the current dossier already exceeds them. The target inventory must not silently preserve those counts as a new documentary-access policy; actual native input capacity remains a separate constraint.

## Code reference map

- **Acquisition and immutable identity:** `workbenchPublicContextActions.ts`, `sourceCaptureActions.ts`, `sourceCaptures.ts`, `execution/retainedText.ts`, capture/storage schema.
- **Shared capture engine:** `domain/sourcePassages.ts`, `domain/sourceRetrievalPolicy.ts`, `sourceRetrieval.ts`, `sourceRetrievalActions.ts`, `integrations/sourceEmbeddings.ts`.
- **Consumers and permissions:** `domain/savedMaterial.ts`, `domain/savedMaterialAgentOperations.ts`, `domain/savedMaterialInspection.ts`, `domain/workbenchAgent.ts`, `domain/workbenchContext.ts`, `sourcesMissionActions.ts`, `sourcesWorkspace.ts`, retained `sourcePreparationActions.ts`/`evidenceActions.ts`.
- **Native context and persisted evidence:** `execution/context.ts`, `execution/journal.ts`, `integrations/modelInput.ts`, `integrations/piNativeInput.ts`, `integrations/piMission.ts`, `domain/framingProvenance.ts`.
- **Lifecycle cleanup:** `dossierPurge.ts`, `evidenceArtifacts.ts` and immutable-text deletion helpers.

These are key traced owners and consumers, not an exhaustive audit of every evidence or analytical feature. The current technical reference remains `context/TECH.md`; the limit discrepancy above needs explicit treatment in the following design. No new normative reference or architecture decision was created.

## Remaining uncertainty

No missing code trace blocks technical design. Live deployment configuration, existing record counts/versions, actual hosted lexical/vector relevance and deployed orphan population were not inspected. Those are runtime or migration-verification inputs if the selected design needs them; they are not established by simulated providers. No API-mode or embedding dependency change is recommended here.

The unified representation, phase-neutral document interface, compatibility strategy and any change in retrieval selection remain undecided. They belong to the next TDD phase. Existing findings establish the ownership and authority boundaries that phase must resolve without inferring a single-capture tool's semantic-search capability or treating optional hybrid code as current activation.
