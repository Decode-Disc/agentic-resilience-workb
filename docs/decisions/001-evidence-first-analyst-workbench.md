# ADR-001: Build an Evidence-First Analyst Workbench

## Status

Accepted

## Date

2026-07-20

## Context

The prototype is the central proof in an original unsolicited application to Raphaëlle d'Ornano. It must demonstrate that the author can combine technical and economic judgment and accelerate analysts assessing the architectural resilience of US-listed technology companies.

Three product shapes were considered:

1. an evidence workbench with staged human review;
2. an architecture-map-first visual product;
3. an autonomous research analyst that immediately generates a report.

The primary risk is producing a polished but weakly supported AI narrative. The prototype must demonstrate judgment, provenance, and reproducibility rather than model spectacle.

## Decision

Build an evidence-first analyst workbench.

The primary artifact is an evidence matrix containing atomic claims, exact source passages, classifications, counter-evidence, and unknowns. Dimension-level assessments are derived from that matrix and remain proposals until reviewed by an analyst.

Source discovery and assessment are separated by a mandatory human approval checkpoint. The architecture map and draft brief are secondary projections that may use only validated evidence.

The system proposes dimension-level position scores, evidence confidence, and three-year direction. It does not compute a global resilience score or make investment recommendations.

## Alternatives Considered

### Architecture-map-first product

- Pros: visually memorable and well suited to a short demonstration.
- Cons: public sources rarely expose a complete internal architecture; the visualization could imply unsupported certainty.
- Rejected as the primary product: retained only as a derived view over validated claims.

### Autonomous research analyst

- Pros: simple interaction and strong initial wow effect.
- Cons: encourages premature conclusions, variable quality, and weak human control; easily resembles a general answer engine with a custom prompt.
- Rejected for the MVP: retained as a possible long-term direction after the evidence workflow is validated.

## Consequences

- The product optimizes for analyst trust and acceleration rather than instant answers.
- Every material conclusion requires inspectable provenance.
- Human checkpoints and overrides are first-class domain concepts.
- The data model must preserve evidence and decisions as structured records.
- The UI must prioritize matrices, review states, and audit history over chat.
- The prototype may feel slower than a one-shot report generator, but its progress and quality controls are materially more credible.
