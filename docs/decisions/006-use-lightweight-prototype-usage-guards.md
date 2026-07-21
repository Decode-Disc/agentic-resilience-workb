# ADR-006: Use Lightweight Prototype Usage Guards

## Status

Accepted

## Date

2026-07-20

## Context

This project is a candidature prototype intended to demonstrate judgment, rigor, and useful execution to Raphaëlle d'Ornano and her analysts. It is not a production SaaS platform.

ADR-005 introduced transaction-grade dollar reservations, settlement, list-price accounting, and global budget administration. Those mechanisms would consume implementation time without materially improving the evidence-workbench demonstration. The prototype still needs protection against accidental loops, excessive fan-out, and unbounded external calls.

## Decision

Use lightweight, configurable usage guards:

- exactly five invitation records and no more than three analysis reservations per admitted visitor;
- bounded retries at every external boundary;
- configurable limits on discovered sources, approved document pages, and provider calls where useful;
- provider-side spending controls or credit limits when available;
- an emergency server-side switch that prevents new paid work;
- best-effort recording of provider usage, latency, and reported cost when available.

Visitor admission and analysis reservations remain atomic and server-side. Workflow idempotency remains mandatory so retries and resumes do not duplicate external work.

The prototype will not implement:

- transactional dollar reservations before each operation;
- a settlement ledger for predicted versus actual cost;
- list-price-equivalent accounting for free tiers or subscriptions;
- precise per-dossier cost enforcement;
- mandatory multi-dossier calibration before implementation or demonstration.

## Alternatives Considered

### Transaction-grade cost accounting

- Pros: precise concurrency-safe dollar ceilings and detailed allocation.
- Cons: disproportionate to a maximum of fifteen candidature-prototype analyses and invisible in the core demonstration.
- Rejected for the prototype; reconsider only if the project becomes a real multi-user product.

### No operational guards

- Pros: least implementation work.
- Cons: a retry loop or uncontrolled fan-out could still create avoidable usage and distract from the demo.
- Rejected in favor of small explicit limits.

## Consequences

- Engineering effort remains focused on evidence quality, provenance, analyst review, and the demonstration.
- Cost data is informative rather than a domain invariant.
- Provider calls remain observable and idempotent without creating a miniature FinOps subsystem.
- Exact guard values remain configuration and can be adjusted after one real showcase run.
- ADR-005 is superseded.
