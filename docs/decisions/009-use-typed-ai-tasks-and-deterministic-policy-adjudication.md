# ADR-009: Use Typed AI Tasks and Deterministic Policy Adjudication

## Status

Amended on 2026-10-20 by [ADR-024](024-qualify-source-content-before-corpus-approval.md). Its explicitly listed preparation, qualification and evidence-use clauses supersede the corresponding historical clauses below; all other decisions remain in force.

Accepted

## Date

2026-07-27

## Context

The workbench needs model intelligence for semantic extraction, entailment,
contradiction analysis, dimension relevance, assessment proposals, and grounded
synthesis. Letting the same model generate a result and declare its quality
would make workflow gates opaque, expensive, and difficult to reproduce.

Some checks are fully mechanical: schema validity, source approval, stable
locators, exact quotation presence, source counts, recency, authority metadata,
coverage, and duplicate identities. Other checks, such as source-to-claim
entailment or whether two passages materially contradict one another, require
semantic interpretation.

The application must remain responsible for quality gates even when a model
performs a semantic verification task.

## Decision

Represent every AI operation as a versioned typed task with an
application-owned input and output schema.

Generated task results may contain proposed claims, classifications, passage
references, dimension links, contradiction candidates, or bounded semantic
labels. They must not contain authoritative workflow fields such as
`approved`, final `confidence`, final `quality`, or permission to advance the
workflow.

Apply a two-tier validation and evaluation pipeline:

1. **Structural validation** enforces non-negotiable invariants such as schema
   validity, an approved source revision, resolvable stable locators, and
   required provenance. Structural failures cannot be overridden.
2. **Versioned policy evaluation** deterministically combines observable
   evidence characteristics and any typed semantic-verifier results into
   `pass`, `needs_review`, or `blocked` outcomes with explicit rule reasons.

Deterministic rules decide when a semantic verification task is necessary.
They do not call a second model for every result by default. A verifier task is
separate from the generator task, has its own schema and recorded execution,
and returns evidence-linked bounded labels. The application policy, not the
verifier, decides the resulting gate.

Store policies in code for the MVP. Each policy has an immutable version
identifier and deterministic tests. Persist the policy version, normalized
inputs, executed rules, rule outcomes, and final policy result. A policy change
never silently changes historical dossiers; an explicit re-evaluation creates a
new evaluation revision.

Every provider-backed task execution records the task version, input/output
schema version, model/provider resolution, attempt, latency, usage, available
reported cost, and references to validated structured input and output.

## Alternatives Considered

### Ask the generator to report its own confidence and risks

- Pros: one call and a simple payload.
- Cons: self-evaluation is opaque, poorly calibrated, and gives the model
  authority over workflow quality gates.
- Rejected.

### Verify every generated claim with a second model call

- Pros: uniform semantic coverage.
- Cons: doubles cost and latency even where deterministic checks are sufficient.
- Rejected: semantic verification is triggered selectively.

### Send every ambiguity directly to the analyst

- Pros: no verifier calls.
- Cons: recreates manual review work the product is intended to accelerate.
- Rejected: deterministic rules and targeted verifier tasks reduce the exception
  set before human review.

### Make policies runtime-editable

- Pros: rapid threshold tuning.
- Cons: weakens reproducibility and adds an administration surface without
  improving the candidature demonstration.
- Rejected for the MVP. Policies are code, tests, and explicit versions.

## Consequences

- Domain and workflow code consume application-owned task results, never
  provider SDK response types.
- Confidence is derived by policy from inspectable evidence characteristics,
  not model self-confidence.
- Structural invalidity and analytical uncertainty remain distinct in storage
  and UI.
- Analyst overrides may address analytical policy outcomes with a persisted
  reason, but cannot waive source approval, provenance, or locator validity.
- The CCC showcase can measure generator and verifier behavior against a
  manually approved corpus without encoding conclusions before source review.
