# ADR-002: Use Convex for Reactive Persistence and Durable Workflows

> **Historical record.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

## Status

Accepted

## Date

2026-07-20

## Context

The application requires:

- durable state for multi-step AI research;
- live progress updates;
- human approval checkpoints that may pause indefinitely;
- retries and recovery after transient failures;
- an append-only audit trail;
- atomic visitor and analysis quotas;
- bounded operational complexity and cost.

The project preferences designate Convex as the preferred database and persistence layer. Eve and Vercel Workflow are available options for durable orchestration, but adding a separate workflow system would increase the number of state owners in the MVP.

## Decision

Use Convex as the application's database, reactive backend, artifact store, and audit-event store.

Use Convex Workflow as the default orchestration mechanism for research runs. Represent the mandatory corpus checkpoint with a durable awaited event. Expose workflow and domain progress through reactive Convex queries rather than a separate SSE or WebSocket service.

Do not include Eve or Vercel Workflow in the MVP unless implementation evidence demonstrates a requirement that Convex Workflow cannot satisfy cleanly.

## Alternatives Considered

### PostgreSQL plus a separate object store and workflow engine

- Pros: conventional relational model and broad ecosystem support.
- Cons: introduces separate persistence, artifact, event-stream, and workflow concerns for a tightly scoped prototype.
- Rejected: unnecessary operational surface for the current requirements.

### Convex plus Eve

- Pros: Eve is purpose-built for durable backend AI agents.
- Cons: duplicates orchestration ownership before an unmet requirement has been demonstrated.
- Deferred: reconsider if agent-specific runtime needs exceed Convex Workflow.

### Convex plus Vercel Workflow

- Pros: durable workflow primitives and natural alignment with Vercel deployment.
- Cons: adds a second workflow and state boundary and may introduce avoidable cost.
- Deferred: reconsider only with measured technical or deployment justification.

## Consequences

- Convex becomes the authoritative state owner for quotas, runs, sources, evidence, assessments, and audit events.
- The frontend receives live progress through reactive queries without a custom event transport.
- Workflow steps must be idempotent and use stable identifiers for external side effects.
- Long-running external calls must respect Convex action and workflow boundaries.
- Quotas can be enforced atomically before workflow launch.
- The team accepts tighter coupling to Convex for a faster, more coherent MVP.
- A migration would be non-trivial, so domain records and provider adapters should remain cleanly typed and separated from UI components.

