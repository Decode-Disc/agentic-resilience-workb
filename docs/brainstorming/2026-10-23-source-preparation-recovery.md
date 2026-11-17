# Recovering Interrupted Source Preparation

**Status: accepted design, 2026-10-23; implemented and locally verified, 2026-10-24; provider-backed acceptance pending.** The user accepted explicit recovery within the same dossier and the bounded additional-attempt policy below after an independent Oracle consultation. This dated brainstorming record preserves the decision and rationale. It is not an implementation plan or authorization to modify production behavior, deploy, or make provider calls. Current obligations remain in the [document owners](../../AGENTS.md#document-authority-and-required-reading); those references were amended for the subsequently authorized implementation. The roadmap owns its delivery state and verification limits.

## Destination

Let an analyst continue an interrupted preparation in the same editable dossier, preserving useful evidence and decisions, with bounded external work and an actionable explanation of what can resume. Preparation need not produce exhaustive research or perfect selection; a partial, inspectable result remains useful.

## Research foundation

The investigation read [source preparation](../../convex/sourcePreparation.ts), its [actions](../../convex/sourcePreparationActions.ts) and [workflow](../../convex/sourcePreparationWorkflow.ts), [execution authority](../../convex/domain/sourcePreparationAuthority.ts), [provider attempts](../../convex/providerCalls.ts), [capture reuse](../../convex/sourceCaptures.ts), [recovery planning](../../convex/domain/sourceDiscoveryRecovery.ts), [review projection](../../convex/sourceSelectionProposals.ts), and [presentation copy](../../src/lib/presentation/research-copy.ts), alongside Product, Tech and Roadmap. The diagnosis and Oracle review used the implementation at checkpoint `444d320`; later working-tree changes are not evidence that this recovery design has shipped.

The local ServiceNow dossier `k979t5nzs6bmkxbp7eref2bkzx8bag4f` provided these observations on 2026-10-23. The database and workflow journal are local-only evidence, not a committed fixture or a reproducibility promise for another deployment.

| Observation | Evidence and implication |
| --- | --- |
| Initial preparation stopped at approximately 17:33 UTC. | Two captures were committed, both qualification actions returned `missing_configuration`, no model attempt was recorded, and 46 of 48 sources remained unprocessed. This was not a measured model-quality failure. |
| Credential access had a stale-environment risk. | The former Node action read the generated `env` export, which retains the object assigned at module load. Commit `7a98114` changed action-side reads to invocation-time `process.env` and added a pre-acquisition check. The credential was present during diagnosis; its precise historical availability was not established. |
| A subsequent annual-report search failed at approximately 17:39 UTC. | Its durable journal recorded `request_invalid`: the old recovery planner produced no regulatory query. Commit `7a98114` added regulatory planning and SEC routing. Neither correction replayed the failed dossier. |
| Recovery became unavailable at approximately 17:48 UTC. | The original fifteen-minute deadline expired. The mutation rejected continuation and the projection disabled its button, even though retained work remained useful. |
| Renewing time alone would not recover every transient failure. | Model attempts are deduplicated by dossier, operation, input hash and attempt; initial attempt indices are limited to 1 and 2. The qualification-action test proves that two HTTP 503 responses prevent another call for the same input in a later preparation. Capture history also prevents many repeats. |
| Existing protections can be extended. | The application already persists captures and decisions, counts model attempts cumulatively, reserves supplemental searches, claims one visitor execution slot, and fences stale generations. A new workflow engine is unnecessary. |

Two focused tests for invocation-time credentials and expired continuation, plus ten regulatory-search tests, passed during diagnosis. These offline checks confirm specific behavior, not successful live qualification or end-to-end recovery. Provider health after the correction remains unverified. Oracle performed a read-only architectural review and independently identified the attempt-deduplication constraint.

## System assessment

**System type — Complicated.** The failure chain is deterministic and discoverable across configuration, durable execution, attempt records and presentation. This calls for causal analysis and bounded validation rather than a replacement architecture.

| Participant | Intended outcome | Existing pressure or misleading proxy |
| --- | --- | --- |
| Analyst | Continue useful research with retained evidence. | Creating another dossier becomes the only apparent escape from expiry. |
| Application | Bound expenditure and prevent duplicate work. | An execution deadline also prevents legitimate later recovery. |
| Engineering and verification | Deliver a usable protected workflow. | Passing isolated tests can be mistaken for recovery of the real interrupted dossier. |
| External providers | Return requested content or model output. | Availability and billing are external; a timeout does not prove that work was not executed or charged. |

**Stocks and flows —** Captures, qualifications, decisions and consumed allowances accumulate durably. Eligibility to execute the unfinished steps is the blocked flow; deleting or recreating those stocks is unnecessary.

**Consequences —** Reusing retained evidence reduces repeated acquisition. Unbounded retries would create a reinforcing failure-and-spend loop; cumulative limits and per-input recovery limits dampen it. Delayed responses can arrive after cancellation or a new generation and must remain unable to advance current state.

**Protocol and smallest test —** Extend the existing recovery owner. Simulate missing configuration, let the execution expire, restore configuration, then request continuation. Verify preserved captures and decisions, unchanged consumed counters before new work, one execution slot and no duplicate dispatch. Failure to resume under these conditions would invalidate the proposed separation of execution time from recovery authority.

## Alternatives considered

| Approach | Mechanism and structural difference | When it wins | Limitation and disposition |
| --- | --- | --- | --- |
| Extend bounded dossier recovery | Keep the existing durable workflow; create a new fenced operation for admissible unfinished work with its own execution window. | The current prototype and existing persistence model. | Requires consistent failure classification and attempt accounting. Recommended by the assistant and Oracle, then accepted by the user. |
| Independent durable processing per source | Give each source an independent recovery lifecycle and assemble dossier progress from those branches. Changes scheduling granularity and coordination ownership. | Frequent long outages, greater scale or genuinely independent processing schedules. | More states and coordination than justified here. Not selected for this correction; reconsider if measured workload requires it. |
| Make model qualification optional | Expose saved content and lexical retrieval as the primary preparation result; add qualification as optional enrichment. Removes a mandatory processing dependency. | Minimum model spend and willingness to perform more analyst reading. | Changes the product and leaves documentary contributions unassessed until enrichment. Not selected for this correction; requires a separate product decision. |

Oracle also considered measuring only active processing time and administrator-only recovery. Neither was selected: active-time accounting introduces coordination complexity, while an administrator repair does not provide the accepted analyst-facing recovery path.

## Accepted direction

1. **Explicit continuation.** After an interruption requiring intervention, prolonged unavailability or expiry, the analyst uses a `Resume` action in the same dossier. Small transient incidents retain bounded automatic handling; there is no indefinite background restart after service restoration.
2. **Execution time is separate from lifetime allowances.** A new operation receives a fifteen-minute execution window. It does not reset dossier counters, replenish supplemental searches, erase past attempts or change approved corpus membership. The existing 120-attempt limit is a volume bound, not an exact monetary ceiling; transport size, token and price limits remain relevant.
3. **Reuse completed work.** Preserve intact captures, matching valid qualifications, provenance, restrictions and analyst decisions. Schedule only eligible unfinished work. Definitively unavailable sources remain visible without blocking unrelated eligible sources. Corrupt content must not be silently replaced or treated as valid.
4. **One recovery policy owns availability.** Classify never-dispatched work, confirmed transient failure, terminal failure and unknown outcome. Use the same policy for server enforcement and the UI's available action. Missing configuration is not proof of an irrelevant source; merely having unresolved sources is not proof that a paid retry is authorized.
5. **Bound additional attempts.** Permit at most one additional attempt per operation and logical input after a confirmed transient failure or a received invalid model output, beyond the initial attempts and within cumulative limits. Replaying the same user request returns the same operation rather than authorizing another attempt. Reserve a genuinely new attempt atomically and retain previous receipts. Do not obtain new allowance by changing generation, request identity or route position. An unknown outcome does not authorize automatic replay; timeout handling must not promise absence of duplicate charges.
6. **Preserve existing execution authority.** Claim the visitor's execution slot atomically, advance generation, enforce ownership and draft scope, and reject cancelled, superseded or late results. Approval remains a separate analyst checkpoint. Manual additions and targeted searches retain their bounded scope and shared allowance history.
7. **Explain failures at the appropriate boundary.** Analyst copy identifies the interrupted stage, retained work, available action and any condition preventing it. Existing protected administration surfaces retain precise cause, configuration-check outcome and associated attempts, without exposing credentials. Preserve typed causes rather than reducing every failure to a generic terminal label.

The intended implementation extends the existing preparation, capture, provider-attempt and presentation owners. No new service, workflow engine, provider, embedding model or administration application was selected.

## Validation and unresolved details

The design was explicitly ratified, including the additional-attempt ceiling. Empirical evidence supports reuse of the existing owners; it does not establish current provider health. The implementation planning decision permits recovery after explicit HTTP 408/429/500/502/503/504 responses and received invalid model output, with a minimum fifteen-second cooldown and any longer valid Retry-After. Generic historical transport outcomes remain blocked individually when dispatch outcome cannot be established. A confirmed failed supplemental query may be retried once using another unconsumed call within the existing three-call dossier allowance. Logical attempt identity excludes execution generation, request identity and route position. These details must preserve the accepted ceilings rather than silently broaden retry authority. The classification must distinguish a confirmed failure from an ambiguous dispatch outcome; a generic `retryable` flag alone is insufficient.

Offline acceptance must cover configuration restored after expiry; initial transient failures followed by the permitted recovery attempt; exhaustion of that additional attempt; unknown outcome; corrupt capture; repeated clicks; competing dossiers; cancellation and late completion; approved read-only revisions; and manual/targeted scope preservation. Vary stable company identities and SEC/web sources instead of encoding one issuer's behavior. Assert retained capture identities, quotations, decisions, request deduplication and cumulative counters, not just successful return values.

Protected desktop/mobile verification must exercise interruption, continuation, visible progress, keyboard access, refresh/reconnection and unchanged corpus approval authority. Provider-backed validation remains a separately authorized bounded check; offline or illustrative success cannot substitute for it. This record authorizes neither that check nor a replay of the real dossier.

## Documentation and implementation handoff

At design acceptance, the implementation handoff required amendments to the existing passages in [Product: source preparation](../../PRODUCT.md#source-preparation-and-corpus-review), [Tech: captures and qualification](../../context/TECH.md#captures-and-qualification) and its resource/provider contracts, and [Roadmap](../ROADMAP.md). Those amendments replaced obsolete deadline and new-dossier-only statements in place while preserving cumulative allowances. This record preserves the rationale without overriding the reference owners as executable authority; delivery requires implementation evidence beyond the design discussion.

The subsequently authorized implementation and local recovery checks are recorded in the roadmap. Fresh provider usefulness remains a separately authorized check. Planning, implementation, deployment, commits and paid verification remain separate authorization boundaries. No production change was made during the original brainstorming, and the interrupted real dossier was not replayed during implementation.
