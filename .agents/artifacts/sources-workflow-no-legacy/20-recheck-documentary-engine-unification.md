---
type: design-review
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "2816370980accf0155c09d62054ca83511ca43d3"
reviewer: oracle
configured-model: gpt-6-astra
reasoning: xhigh
status: recheck-complete-final-parent-corrections-user-approved
---

# Oracle Recheck: Documentary Engine Unification

The authorized recheck used the same Codex provider with the configured GPT-6 Astra/xhigh profile, in a new read-only delegate. The complete result was delivered to the parent. Oracle verified repository identity and both review-input fingerprints, read the complete revised TDD and initial review, and inspected the relevant source contracts. It modified no files and ran no tests, browser checks, provider/network calls, deployments, dependency operations or environment reads. Earlier passing tests remain baseline evidence, not validation of the unimplemented target.

The exact reviewed input is [documentary-tdd-oracle-recheck-input.md](documentary-tdd-oracle-recheck-input.md), with its original fingerprint/delegate identity in [documentary-tdd-oracle-recheck-context.json](documentary-tdd-oracle-recheck-context.json). The current proposal is [18-tdd-documentary-engine-unification.md](18-tdd-documentary-engine-unification.md). The [initial review](19-review-documentary-engine-unification.md) remains preserved rather than having its BLOCK verdict rewritten.

## Recheck verdict

Oracle returned **BLOCK** for a first-acquisition ordering contradiction, plus **WATCH** for post-Start Workbench reading and offline native-profile variants. It judged the architecture and short reference interface viable. The parent verified these source paths and applied the three bounded corrections below without launching another delegate. The user subsequently approved the complete revised Program Design. These dispositions concern the design only; Oracle has not rechecked those final corrections, and its original verdict is not rewritten as an approval. This approval does not authorize implementation.

## First acquisition required a source before the design could create it

**Oracle impact: BLOCK.** The reviewed pin required `sourceId`, but pinning was query-safe. Public discovery and analyst-supplied URL admission do not require an existing source. `convex/execution/operations.ts:444` pins before admission, and reconstruction at line 335 compares the current pin with the retained identity. Creating a source later could not satisfy the original required field; changing the pin afterward would fail that identity check. The existing source-free target paths are visible in `convex/domain/workbenchContracts.ts:246` and `convex/workbenchPublicContext.ts:273`.

**Smallest corrective design applied:** Remove source ID from the acquisition target pin. Bind the observed canonical URL, cause/provenance and deterministic target hash, independent of source-row creation. After admission, the authorized capture reservation transaction creates or reuses the dossier source, validates it against that target and records the source/capture association in the existing reservation/effect receipt. Reconstruction remains stable before and after insertion; outcome validation checks the binding rather than requiring the source ID in the admitted pin. Existing known-source paths still validate their referenced identity.

**Required regression added:** No matching source row initially, for both discovery and analyst URL; successful target-only admission, transactional source creation/reuse, unchanged reconstructed pin, correct provider target and source/capture binding. Concurrent first reservations must not create duplicate sources or require pre-admission writes.

**Disposition:** Addressed in the proposed design by the parent, not implemented or re-reviewed by Oracle.

## Post-Start Workbench consultation needed its own explicit authority mapping

**Oracle impact: WATCH.** The closed scope listed framing, Sources and inspection without explaining the conversation caller after Start. Workbench currently offers saved-material tools when framing is fixed (`convex/domain/workbenchAgent.ts:255`); conversation authority is distinct from research progression (`convex/execution/authority.ts:152`), and capture access recognizes Workbench (`convex/sourceRetrieval.ts:740`). This was an underspecified mapping, not proof that the architecture could not support it.

**Smallest corrective design applied:** Add `workbench_read` to the closed documentary scope, retaining active-turn/message/instruction authority and a checked corpus/preparation material view. Use a shared conversation-cause type for Workbench references before and after Start. Consultation can proceed during research pause or settlement under the existing conversation authority; it grants no acquisition, qualification, membership or research progression. Both native offering and server admission deny acquisition in that scope. A local import under Workbench does not write Sources progression state; any later Sources registration uses its own active authority and the shared availability rule.

**Required regression added:** Real post-Start conversation search/read during pause and settlement, with unchanged research/work/receipt/qualification/membership state, plus manual acquisition and stale-reference refusals. Add the caller explicitly to the consumer matrix.

**Disposition:** Addressed in the proposed design by the parent, preserving an existing caller rather than adding product authority.

## Prepared tool-set variants must select the same result contracts as runtime

**Oracle impact: WATCH.** `convex/integrations/piModelProfiles.ts:170` supplies explicit `nativeToolSets` variants to `agentToolSchemas`. The latter bypasses `modelOperation` when a variant exists (`convex/execution/agentDefinition.ts:158`). A variant lacking the selected result validator would still hash the widened canonical result validator, despite correct runtime projection.

**Smallest corrective design applied:** Require `nativeToolSets` to consume the same domain input/result selector, for all phase/message/material variants. Extend the existing private projection shape to carry its selected result validator on both routes, then emit only final schema fields and the derived result key. The canonical fallback applies to unchanged operations, not an affected variant missing its selection. This is one selector and one key calculation, without an offline schema implementation or registry.

**Required regression added:** Compare matching runtime snapshots and every prepared variant across retained/new bindings: operation names, inputs and result-contract keys must agree. Retain already-admitted old-invocation replay and old prepared fingerprints. Profile generation remains with the existing owner.

**Disposition:** Addressed in the proposed design by the parent, not executable profile-compatibility evidence.

## Disposition of the nine initial concerns at recheck

| Initial concern | Oracle recheck assessment | Final bounded correction |
| --- | --- | --- |
| Message/revision authority | Partial: multi-message cause is explicit; first-acquisition identity still blocked. | Target-only acquisition pin and transactional source binding above. |
| Sources eligibility after Start | Resolved as design: existing capture ledger initialized and reused. | No additional change required by the recheck. |
| Import recovery | Resolved as design: ownership, revision checks and reconciliation distinguish local recovery. | No additional change required by the recheck. |
| Historical uncertainty/provenance | Resolved as design: explicit unknown and immutable date/provenance metadata. | No additional change required by the recheck. |
| Normalization/qualification | Resolved as design: existing normalization sequence with downstream preparation-owned selection. | No additional change required by the recheck. |
| Closed compatibility/versioning | Resolved as design with WATCH for native variants. | Explicit `nativeToolSets` selector and runtime/prepared-key equivalence above. |
| Focal continuation | Resolved as design: forward extent with explicit next-reference reading. | No additional change required by the recheck. |
| Namespace/inventory consumers | Partial: post-Start Workbench access not explicit. | Checked read-only conversation scope and consumer coverage above. |
| Admission/settlement/policy tests | Resolved as design; first-acquisition/post-Start scenarios still required. | Both integration scenarios added above. |

## Complexity and guarantees

Oracle found knowledge localized in reference resolution, one access owner, capture mutations and retrieval policy. The pin, finite compatibility branches and import-attempt fields represent actual authority/lifecycle distinctions. The simplified model input hides mechanics without giving permission to a reference. No generic handle registry, second parser, retry coordinator, history store or policy framework is needed. The final corrections preserve that structure: source creation moves to its existing transactional owner; post-Start conversation access is a concrete existing scope; profile variants reuse the same selector.

No concern was suppressed or rejected. The remaining BLOCK was an execution-order contradiction, not a design preference; the parent changed the proposed pin/order explicitly rather than adding a pre-admission mutation. All validation of the target's runtime behavior, crash/OCC recovery, actual profile compatibility, native serialized requests, deployed data and retrieval relevance remains pending implementation and its separately authorized checks.
