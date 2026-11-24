---
type: research-questions
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "2816370980accf0155c09d62054ca83511ca43d3"
flow: tdd
---

# Research Questions: Documentary Engine Unification

## Key Context Pointers

The desired change and scope are in `15-request-documentary-engine-unification.md`. The completed evidence is in `docs/verification/2026-11-20-long-document-local-probe.md`, with exact inputs and code preserved by `scripts/evaluations/archives/20261120T122604301Z-long-document-local-probe/record.json`. Read the current `PRODUCT.md` and relevant `context/TECH.md` contracts; compare current code with the archived fingerprints before reusing observations.

The local probe exercised these separate paths:

```text
Framing:       public search → retained document pages → save → next page
Saved capture: passage search → contextual read → contextual continuation
```

These paths are starting evidence, not a prescribed architecture or proof of a unified workflow. Research current behavior without production changes, new inference, embeddings or external documentary acquisition. Use existing captures and tests when an executable check resolves a remaining factual question.

## Questions

1. **Where do acquired documents and their derived representations live today?** Trace framing reads and Sources captures through acquisition, normalization, storage, parsing, indexing, reuse and cleanup. Which identities bind URL, bytes, hash, dates, parser version and passages, and which records require a preparation or corpus owner? Start with `convex/workbenchPublicContextActions.ts`, `convex/execution/retainedText.ts`, `convex/sourceCaptureActions.ts`, `convex/domain/sourcePassages.ts` and the capture/index tables in `convex/schema.ts`.

2. **Which consumers use each retrieval implementation?** Follow `search_available_material` and `read_in_context` through `convex/domain/savedMaterialAgentOperations.ts`, `convex/domain/savedMaterial.ts`, `convex/sourceRetrievalActions.ts` and `convex/sourceRetrieval.ts`. Compare current Sources, Workbench, reader UI, inspection and retained workflow callers. Where do lexical search, vector search, rank fusion, index construction and policy differ or share an implementation? Verify actual configuration and degradation behavior without treating an implemented hybrid branch as evidence of current use.

3. **How does phase authority govern access and continuation?** Identify offered-tool checks and server-side authorization before Start, during Sources and after handoff. Trace provisional saves, Start, analyst edits, steering, cancellation and generation changes through `convex/domain/workbenchAgent.ts`, `convex/domain/savedMaterialInspection.ts`, `convex/domain/framingProvenance.ts` and `convex/workbenchPublicContext.ts`. Which retained observations can currently support further reads and citations, and which transitions revoke them?

4. **What does each search/read response establish about coverage?** Compare exact quotations, contextual offsets, section metadata, pagination, whole-document reading, acquisition completeness, omitted passages and empty results. Which limits bound transport, indexing, returned context or cumulative authority, and what happens at exhaustion? Start with `convex/domain/savedMaterialOperations.ts`, `convex/domain/sourceRetrievalPolicy.ts`, `convex/domain/sourcePassages.ts` and `convex/resourcePolicy.ts`; distinguish measured behavior from undocumented assumptions.

5. **What reaches the actual native model request as reading accumulates?** Trace tool outcomes, authoritative projections and retained history through `convex/execution/context.ts`, `convex/integrations/modelInput.ts` and `convex/integrations/piMission.ts`. What remains outside the context, what is repeated, and how do native recovery and compaction retain access to exact evidence? Use the local probe's request bodies and module hashes, and state what they do not establish about hosted token usage or long-running compaction.

6. **What coverage already protects the shared behavior and where is the cross-phase gap?** Map tests for saved-material search/context, public continuation after save, stale authority, capture corruption, omissions and native serialization. Check `src/__tests__/convex/execution/workbench-documentary-continuity.test.ts`, `src/__tests__/convex/execution/saved-material-progress.test.ts`, related retrieval tests and the archived local probe. Which existing harness can exercise targeted search → context → provisional save → continuation → citation once access is connected, without bypassing Start or manufacturing source approval? Identify current migration/compatibility and cleanup obligations for already persisted documents.

## Research Handoff

Answer with current owners, concrete call/data paths, relevant test evidence and explicit unknowns. Distinguish delivered current paths from retained compatibility code and implemented but unexercised options. Record any factual conflict between current references and runtime consumers. Leave the target interface, representation changes and rollout strategy to the following technical-design phase.
