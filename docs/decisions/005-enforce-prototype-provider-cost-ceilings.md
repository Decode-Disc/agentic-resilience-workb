# ADR-005: Enforce Prototype Provider Cost Ceilings

## Status

Superseded by ADR-006

## Date

2026-07-20

## Context

This record is retained to preserve the original decision history. The candidature context later showed that transaction-grade dollar reservation and settlement would be disproportionate to a five-visitor prototype. ADR-006 replaces this decision with lightweight usage guards.

The prototype admits at most five visitors and permits at most three analysis reservations per visitor, for a maximum of fifteen reserved analyses. Concurrent search, normalization, and model calls can overspend if each worker checks the budget independently or if retries create duplicate billing records.

Provider free tiers and Codex subscription access can make the cash invoice appear lower than the underlying resource use. A safe ceiling cannot depend on a temporary free balance, and subscription capacity cannot be represented honestly as a zero-cost unlimited provider.

## Decision

Set the initial configurable provider-cost ceilings to:

```text
Per research run: USD 10.00
Prototype global ceiling: USD 150.00
```

These values are configuration data and must not be embedded in domain logic, workflow code, or UI components.

Enforce the ceilings server-side in Convex. Before any concurrent fan-out, atomically reserve a conservative upper-bound cost for every paid operation. After completion, settle the actual or provider-reported amount and release the unused reservation. Retries and workflow resumes reuse the logical operation and idempotency key rather than creating duplicate reservations.

Budget availability is:

```text
available = ceiling - settled list-price cost - active reservations
```

Use current public list prices for reservation and ceiling enforcement even when account credits make the provider invoice lower. Record the billed amount and free-credit consumption separately. This prevents the application from becoming unsafe when a promotional or monthly allowance expires.

For Codex subscription calls, record dollar cost as unavailable or subscription-allocated rather than inventing a per-call price. Track and reserve available non-monetary capacity separately when the upstream exposes usable quota information. An OpenRouter fallback may proceed only after its priced upper bound has been reserved within both ceilings.

No reset schedule for the USD 150 global ceiling has been approved. The implementation must not invent an automatic daily or monthly reset. Changing or restoring the global budget requires an explicit, audited administrative decision.

When an operation would exceed a ceiling, the workflow must, in order of suitability:

1. stop marginal research;
2. reduce configured depth or document scope without violating evidence requirements;
3. remain in a visible needs-review state and request explicit authorization for a budget change.

It must never silently downgrade provenance, bypass the source checkpoint, or charge beyond the approved ceiling.

## Alternatives Considered

### USD 15 per run and USD 225 globally

- Pros: more headroom for PDF normalization and premium model fallback.
- Cons: higher maximum prototype exposure than required for the initial validation.
- Rejected in favor of the stricter approved ceiling.

### USD 25 per run and USD 375 globally

- Pros: less risk of stopping complex dossiers.
- Cons: weakens the cost discipline the prototype is intended to demonstrate.
- Rejected.

### Count only the amount actually invoiced

- Pros: matches immediate cash expenditure.
- Cons: depends on free-tier state and treats subscription capacity as unlimited and free.
- Rejected for enforcement; billed cost remains a separate reporting field.

### UI-only cost warnings

- Pros: simple implementation.
- Cons: concurrent server work can overspend despite a disabled button or warning.
- Rejected: cost enforcement must be atomic and server-side.

## Consequences

- The maximum configured variable provider exposure across fifteen analyses is USD 150 before an explicit budget change.
- A central dossier outside the Unstructured free allowance may spend more than half of its run ceiling on PDF normalization, leaving limited room for paid model fallback.
- Cost telemetry must distinguish list-price cost, provider-reported cost, billed cash, free credits, subscription allocation, unavailable cost, and non-monetary quota use.
- `ProviderCall` covers model, search, retrieval, and document-normalization services through an explicit service kind so the full external cost is auditable.
- Late results after cancellation cannot advance the workflow, but any billable cost they incurred must still be settled.
- The ceilings must be recalibrated from measured pilot distributions rather than optimistic estimates.
