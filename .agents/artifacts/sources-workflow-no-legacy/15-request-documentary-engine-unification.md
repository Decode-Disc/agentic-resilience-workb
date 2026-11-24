---
type: request
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "2816370980accf0155c09d62054ca83511ca43d3"
flow: tdd
---

# Original Request: Documentary Engine Unification

Unify document access behind one responsible domain so maintenance and future improvements reach Workbench framing, Sources and existing saved-material consumers. The user explicitly requires one owner of the documentary engine, rather than separate agent-specific implementations of parsing, indexing, search and reading.

Make documents acquired during framing available to targeted passage search and contextual reading through that shared owner. Preserve complete reading when useful, exact quotations, document identity, dates, restrictions and valid continuation after a provisional save. Keep native Pi history and compaction as the conversation mechanism. Do not assume semantic search is required: the current lexical and optional hybrid paths must first be mapped to their actual consumers.

The user approved the RPI flow of targeted research followed by a technical design document. Start from the completed local long-document probe rather than repeating provider calls. That probe separately verified public-reading continuation after a save and targeted search/contextual continuation on an authorized capture; it did not join these into one pre-Start workflow or qualify live model judgment. This request authorizes preparation of research questions; subsequent RPI phases remain separate steps.

## Source Pointers

- `docs/verification/2026-11-20-long-document-local-probe.md` and `scripts/evaluations/archives/20261120T122604301Z-long-document-local-probe/record.json`: measured behavior, exact source snapshots and preserved probe.
- `/home/abdwhb/.cache/workbench-evaluations/long-document-local-probe-20261120`: local serialized requests, results, probe source, fingerprints and logs; archived equivalents are identified by the archive record.
- `PRODUCT.md` and `context/TECH.md`: current product and technical contracts, particularly public context during framing, Sources, scoped retrieval and native context recovery.
- `convex/workbenchPublicContext.ts`, `convex/workbenchPublicContextActions.ts`, `convex/domain/savedMaterial.ts`, `convex/sourceRetrieval.ts`, `convex/sourceRetrievalActions.ts`, `convex/domain/sourcePassages.ts`: current document paths and engine owners.
- `search_available_material`, `read_in_context`, `search_public_context`, `read_public_context`: exact agent tool names under discussion.

