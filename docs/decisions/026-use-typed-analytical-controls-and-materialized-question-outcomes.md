# ADR-026: Use Typed Analytical Controls and Materialized Question Outcomes

## Status

Accepted. The contracts are design authority for Phase 8 and Phase 9 implementation; this record does not claim that appraisal control, Synthesis control or the question-outcome projection is delivered.

## Date

2026-10-30

## Context

Investigation must judge reasoning from evidence through assumptions and mechanisms to a question-level interpretation. Synthesis must judge new relationships, transversal inferences and agreement between a mechanism diagram and its reasoned note. Deterministic structural validation alone cannot establish these semantic properties, while a model-issued pass/fail verdict would give an opaque model response direct workflow authority. A permanent critic, debate or model panel would add cost and variability without creating a stronger source of authority.

The current `deriveQuestionCoverage` and Evidence Matrix `questionCoverage` count structurally valid claims linked to current questions, including `Unknown`. These counts establish evidence presence only. They cannot establish that Investigation produced a defensible answer, that required control completed, that the analyst retained a reviewed appraisal or that Synthesis may use it.

Implementation note (2026-11-22): the test-only `deriveQuestionCoverage` helper was removed after its assertions moved to the Evidence Matrix query boundary. The evidence-presence projection remains in `evidenceMatrix.getSummary`; the analytical distinction and target in [TECH](../../context/TECH.md#analytical-control-and-question-outcome-contracts) are unchanged.

The product therefore needs two related contracts: controlled analytical submission whose model work remains subordinate to deterministic domain authority, and one question projection that preserves the difference between evidence presence, completed preparation, a proposed answer and a retained answer.

## Decision

### Use typed findings under deterministic domain disposition

Appraisal submission and Synthesis submission each expose one domain operation that owns input preparation, deterministic admission, bounded semantic examination, finding validation, disposition, exact-result reuse and affected-use restrictions. These are deep artifact-family operations, not caller-orchestrated validator chains.

Before model dispatch, the operation checks authority, artifact and evidence versions, schemas, references, hashes, prerequisites, permitted uses and applicable restrictions. The model then examines only the semantic questions that remain and returns closed, scoped findings tied to the affected assertions, assumptions, objections, unknowns, relationships or output elements. It cannot rewrite the proposal or issue workflow authority through a bare approval.

For a new appraisal or Synthesis proposal, the domain maps validated findings to either `admissible` or `revision_required`. Any material unresolved finding requires revision and returns precise diagnostics to the responsible mission. There is no accepted-with-warning path for a newly submitted artifact. A deliberately limited result can be admissible only when the limitation already constrains the submitted reasoning and the control finds no unresolved semantic defect.

Control execution remains separate from semantic disposition. Missing routing, timeout, interruption or unknown provider outcome produces technical incompleteness, never `revision_required`, justified insufficiency or an admissible result. Initial control cannot silently convert unfinished inquiry into an evidence-based limitation.

`restricted` applies only when a later adverse control calls into question an already retained or otherwise usable result. It restricts the affected use and flags known dependents without rewriting the historical result, erasing the earlier human decision or invalidating independent work.

Reuse requires an unchanged artifact or use together with unchanged evidence, rule and restriction versions. Modified reasoning, a new use or joint-output coherence requires a new examination. No model decides that differently worded analytical statements are semantically identical for reuse.

### Materialize one domain-owned question-outcome projection

Keep evidence-presence counts as a separate Evidence Matrix projection. Add a materialized question-outcome projection owned by the Investigation domain and rebuilt transactionally when an authoritative appraisal artifact, control result or analyst review decision changes. The source artifacts, controls and append-only human decisions remain authoritative; the projection is a reproducible read model and never a second judgment source. Clients do not reconstruct question status or workflow gates.

The projection preserves four distinct facts: evidence presence, analytical result kind, control state and human review state. Exact storage names may follow the implementation, but these meanings cannot be collapsed into a generic stored `answered` boolean.

A controlled substantive appraisal completes Investigation preparation for its question and makes a proposed answer available for grouped review. Only the exact appraisal version retained by the analyst becomes a retained answer and eligible Synthesis input. A controlled justified-insufficiency result also completes Investigation preparation, but it is not an answer, is not a retained appraisal and cannot provide positive Synthesis support. It remains visible as a limitation when Synthesis proceeds from other retained appraisals.

Technical incompleteness, unperformed work and `revision_required` do not complete preparation and cannot be projected as justified insufficiency. Grouped review becomes available only when every assigned question has an admissible substantive appraisal or admissible justified-insufficiency result. Synthesis requires at least one retained substantive appraisal; without one, the dossier remains at appraisal review.

## Alternatives Considered

### Deterministic analytical checks only

Rejected because schemas and reference checks cannot determine whether a mechanism follows from its assumptions, whether counter-evidence constrains a conclusion or whether a diagram and note express the same interpretation.

### One model-issued global verdict

Rejected because an opaque pass/fail result cannot localize the defect, gives model output direct authority and makes targeted revision and affected-use restriction unreliable.

### Multiple-model criticism or voting

Rejected for production because it increases cost, latency and variability without replacing deterministic authority. Independent models remain available for bounded evaluation of the selected control, not as a permanent runtime panel.

### Recompute question outcome in every query or client

Rejected because the same transition knowledge would be repeated across reads and interfaces, increasing inconsistency and change amplification.

### Make question-outcome events a new authority

Rejected because appraisal artifacts, control results and append-only analyst decisions already provide the authoritative history. A second event-sourced judgment model would duplicate ownership.

### Treat any completed analytical result as an answer

Rejected because justified insufficiency is an honest completion outcome but does not establish a substantive interpretation. Evidence presence, completed work and retained judgment must remain distinct.

## Consequences

- Analytical quality remains model-assisted, but workflow authority is deterministic and findings are inspectable at the affected object.
- Initial semantic defects return for revision; later adverse evidence uses the separate restriction and re-examination path.
- Evidence Matrix coverage can remain available without implying that questions are answered.
- Investigation completion can represent honest insufficiency without laundering technical failure or missing work into an analytical conclusion.
- Grouped review and Synthesis gates have one server-owned projection instead of UI-specific inference.
- Implementation requires versioned appraisal and Synthesis artifacts, typed control results, a materialized question-outcome read model, transactional rebuilding and focused evaluation fixtures. None of those capabilities is established by this documentation change.

## Current Owners

[PRODUCT.md](../../PRODUCT.md#evidence-matrix-and-analytical-review) owns analyst-visible meaning and transition prerequisites. [TECH](../../context/TECH.md#analytical-control-and-question-outcome-contracts) owns the executable target contract. [The roadmap](../ROADMAP.md#phase-8--investigation-and-grouped-appraisal-review) owns delivery state and sequence.
