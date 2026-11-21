# Atomic one-shot result retention and billing scheduling — 2026-11-21

## Confirmed defect

A structured model attempt could return a known failure, yet leave its invocation marked `started`. `executePreparationModel` requested billing in a `finally` block before calling `finishOneShot`. Losing the acknowledgement of that billing mutation prevented the already received result and its terminal receipt from being retained. This is a reproduced harness ordering defect; it is not established as the cause of the earlier live whitespace-generation incident.

The RED regression uses the real source qualification action, transport, database mutations and scheduling. Only provider HTTP and loss of an RPC acknowledgement are simulated. The fake provider returns an identified incomplete structured response without cost. The test lets the real billing effect commit, then loses that acknowledgement. Before correction, the invocation remains `started`; after correction, the failure and receipt are retained while billing remains pending. No qualification artifact is adopted and only the original model request occurs. The first fixture attempts failed for unrelated setup assumptions (selecting all provider receipts as unique and omitting the provider generation header); those runs are not defect evidence.

## Correction and ownership

`finishOneShot` now commits the terminal receipt, retained result and eligible billing scheduling together. The existing `requestBilling` mutation owns eligibility, identity validation, accounting changes and the idempotency check. It skips ineligible requests before validating the observation needed for a real billing effect; eligible calls still pass the same authority/identity checks before mutation or scheduling. `executePreparationModel` retains its separate interrupted-call billing path only when execution never returned a result.

The correction changes three existing production owners. It adds no coordinator, retry loop, policy configuration, agent-specific branch or duplicated billing rule. Qualification, comparison and documentary control use the same finalization path. No model-output limit, generation deadline, provider route or semantic permission rule changes.

Under the code-smell guardrails, the removed smell is temporal coupling: callers no longer have to complete an auxiliary billing RPC before preserving a known result. Lifecycle knowledge stays in finalization and billing knowledge stays in the existing provider-call owner. The existing internal mutation is reused directly; no forwarding wrapper or generic recovery abstraction was introduced.

## Verification

- RED: the new source-action regression failed with invocation status `started` instead of `returned` after the real billing effect committed and its acknowledgement was lost.
- GREEN: the same regression passes after correction, retaining the failure code, generation identity, pending billing state and absent domain adoption.
- Native documentary-control coverage: missing cost schedules billing; known fractional cost `0.0002137` remains exact and skips billing; cancellation remains in force; repeating finalization creates no duplicate scheduled job or qualification artifact.
- Falsification: removing atomic billing scheduling fails the missing-cost assertion; removing billing idempotency fails the single-scheduled-job invariant. Both mutations were restored before final checks.
- Final regression run: 134 tests passed in seven files covering qualification actions, comparison actions, journal/finalization, retained one-shot execution, billing, registered-operation conformance and Sources qualification authority. Backend and focused test TypeScript, focused Biome lint, execution ownership and imports passed.
- Local publication: `pnpm convex:sync --url http://127.0.0.1:3210` verified the primary checkout's `local:local-aboul_panga-dd_proto` instance and successfully published the corrected functions. It did not start/stop a server or change environment files. The installed CLI emitted its existing Node experimental localStorage warning; publication and schema validation succeeded.

Fault injection ran in `convex-test`, not against the deployed database. No new paid model call, browser qualification, dependency change, commit or push was performed. Local publication does not prove that the upstream model will stop repeating whitespace. The earlier live qualification remains failed, and the semantic mismatch between free-text guidance and a structured permission is not repaired by this settlement change. The current technical contract is maintained in [TECH](../../context/TECH.md#agentic-missions-and-shared-operations).

The [verified local evidence archive](../../scripts/evaluations/archives/20261121T191031310Z-one-shot-atomic-billing/record.json) preserves the exact production/test changes, technical contract, this report before its archive link, RED/setup/ GREEN logs, both falsification failures, final regression/type/ownership checks and local publication receipt: 25 files and 334,479 bytes. Storage is machine-local; preservation does not establish a fresh paid qualification.
