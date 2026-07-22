# Agentic Resilience Evidence Workbench — Product Design

## Status

Validated baseline design.

## Date

2026-07-20

## Purpose

Build the central proof for an original unsolicited application to Raphaëlle d'Ornano: a focused prototype demonstrating how a technical entrepreneur can accelerate an analyst's assessment of a public technology company's architectural resilience in the agentic economy.

The product is not an autonomous investment analyst and does not attempt to reproduce Decoding Discontinuity's proprietary methodology. It is an evidence workbench: it discovers sources, structures claims, proposes inspectable dimension-level assessments, and preserves human judgment as the final authority.

## Product Thesis

The prototype should prove two things:

1. A structured research system can materially accelerate analysts' architectural assessment work.
2. An evidence-first workflow can make AI-assisted research traceable, reproducible, contestable, and safe to revise.

Within the first minute, Raphaëlle should see judgment, rigor, and execution rather than a generic developer profile or an accumulation of AI tools.

The central demonstration is not "the AI produced an answer." It is:

> Every conclusion can be inspected, challenged, and revised without losing its provenance.

## Target User and Market Scope

The initial user is a strategy, finance, or investment analyst assessing a technology company through an agentic-resilience lens.

The MVP supports technology companies listed in the United States. This scope provides a reasonably standardized regulatory source base through SEC filings. Other exchanges, languages, and regulatory regimes are explicitly deferred.

## Core User Journey

```text
Company
→ Source discovery
→ Mandatory source review
→ Evidence extraction
→ Contradiction search
→ Dimension assessment
→ Analyst review
→ Architecture map and draft brief
```

### 1. Company resolution

The analyst enters a company name or ticker. The system resolves the legal entity, ticker, exchange, investor-relations presence, and SEC identity. Before starting paid research, it estimates whether enough public material is available.

The system may return `insufficient public evidence` rather than promise a low-quality assessment.

### 2. Source discovery

The system creates a research plan tailored to the company and searches by source category and assessment dimension. It displays real progress based on persisted workflow events.

### 3. Mandatory source checkpoint

The workflow stops after discovery. The analyst reviews the proposed corpus, accepts or rejects individual sources, adds URLs, or uploads PDFs. No evidence extraction or scoring starts before explicit approval.

The approved corpus is versioned. Later additions create a new assessment revision rather than silently mutating an existing result.

### 4. Evidence matrix

Approved documents are normalized into precisely locatable passages. The system derives atomic claims and classifies each as:

- `Fact`: explicitly established by a source.
- `Inference`: a reasoned conclusion derived from cited facts.
- `Hypothesis`: a plausible proposition requiring investigation.
- `Unknown`: a material question without sufficient evidence.

Each claim links to exact source passages and is marked as supporting or challenging an assessment dimension.

### 5. Architectural assessment

The system proposes a position, evidence confidence, and three-year direction for each dimension. It must show supporting claims, counter-evidence, and critical unknowns before presenting a score.

### 6. Analyst review

The analyst may accept or override a proposed score. Overrides require a written justification. The AI proposal, analyst decision, and full revision history remain visible.

### 7. Derived outputs

The architecture map and draft brief are projections of validated evidence. They cannot introduce unsupported entities, relationships, or assertions.

## Information Architecture

The main screens are:

1. Invitation access
2. Research workspace
3. New assessment
4. Research progress
5. Source checkpoint
6. Evidence matrix
7. Architectural assessment
8. Architecture map
9. Draft brief
10. Methodology and limitations

The product should look like an institutional research tool, not a generic AI chat application. A chat interface may be added later as a secondary navigation mechanism, but it is not the primary interaction model.

## Evidence Model

The evidence matrix is the primary interface over an underlying evidence graph.

Core entities:

```text
Visitor
Invitation
Company
ResearchRun
ResearchPlan
RunEvent
Source
SourceVersion
SourcePassage
Claim
ClaimEvidence
Relationship
AssessmentDimension
ScoreProposal
AnalystDecision
BriefRevision
ProviderCall
```

Important invariants:

- A claim must reference one or more precisely locatable passages.
- A source rejected at the checkpoint cannot contribute to later claims or scores.
- A generated brief can use only analyst-approved claims.
- Human decisions are append-only audit events, not destructive replacements.
- A map relationship must be backed by validated claims.
- A retry must not duplicate claims, quota reservations, or billing records.

## Assessment Dimensions

The initial framework contains ten dimensions:

1. Context ownership
2. Workflow control
3. System-of-action capability
4. Orchestration position
5. Model and platform dependency
6. Data defensibility
7. Switching costs
8. Pricing resilience
9. Learning loops
10. Abstraction exposure

The summary view should emphasize no more than five priority dimensions at once. The full matrix remains available for detailed review.

## Scoring Method

Each dimension receives three separate outputs:

```text
Position:   -2, -1, 0, +1, or +2
Confidence: Low, Medium, or High
Direction:  Declining, Stable, or Improving over three years
```

Position meanings:

| Score | Meaning |
|---:|---|
| -2 | Strongly exposed |
| -1 | Exposed |
| 0 | Mixed or unclear |
| +1 | Resilient |
| +2 | Strongly resilient |

Confidence must be derived from observable evidence characteristics rather than model self-confidence:

- question coverage;
- source authority;
- recency;
- independent corroboration;
- unresolved counter-evidence;
- proportion of facts versus inferences.

There is no aggregate score. Adding heterogeneous dimensions would create false precision. A radar or profile visualization may compare dimensions without implying a meaningful total.

## Source Policy

Sources are prioritized as follows:

1. Regulatory filings and financial results
2. Investor-relations and earnings materials
3. Official product, API, security, and integration documentation
4. Official pricing, terms, contracts, and support documentation
5. Official company-owned source repositories
6. Executive interviews and official communications
7. Reputable secondary reporting and analysis
8. Other pages used only as research leads

A source receives a relevance estimate, not a truth score. Truth is evaluated at the claim level through provenance, corroboration, and counter-evidence.

The source checkpoint shows why each source was selected, which dimensions it may inform, its date and authority, duplicate or superseding versions, and extraction restrictions.

## Orchestration

The workflow is deterministic and staged. Specialized model calls are used where they provide a clear separation of concerns; the product does not expose a theatrical swarm of agents.

```text
Resolve company
→ Build research plan
→ Discover sources in parallel
→ Persist proposed corpus
→ Await source approval
→ Retrieve and normalize approved sources
→ Extract passages and atomic claims
→ Search for counter-evidence
→ Propose dimension assessments
→ Await analyst review
→ Generate derived views
```

The progress interface displays only real persisted events. It may show stages, counts, durations, failures, and retries, but never hidden chain-of-thought or simulated agent conversations.

Workflow step states:

- `queued`
- `running`
- `completed`
- `needs_review`
- `failed`
- `skipped`

Research run states:

```text
draft
→ discovering_sources
→ awaiting_source_review
→ extracting_evidence
→ assessing_dimensions
→ awaiting_assessment_review
→ completed
```

Execution status is tracked separately as `idle`, `running`, `paused`, `failed`, `cancelled`, or `completed`; a pause identifies the pending human checkpoint. Operational `WorkflowStep`, `AuditEvent`, and `CheckpointDecision` records support this lifecycle without becoming analytical artifacts.

## Technical Architecture

```text
TanStack Start
      ↕ Convex reactive queries and mutations
Convex
├── structured application data
├── document and normalized artifact storage
├── progress events and audit trail
└── Convex Workflow
    ├── durable steps
    ├── retries
    ├── human approval events
    └── cancellation and completion
```

Convex is the preferred persistence and real-time layer. Convex Workflow is the default durable orchestrator because it can pause without consuming resources while awaiting a human event and exposes reactive workflow status.

Eve and Vercel Workflow are not part of the MVP baseline. They may be reconsidered only if a demonstrated requirement cannot be expressed cleanly with Convex Workflow.

## Model Provider Architecture

Workflow code requests capabilities rather than concrete model names:

```text
source-relevance      → fast, low-cost, structured
claim-extraction      → precise, long-context
contradiction-search  → strong reasoning
dimension-assessment  → strongest suitable reasoning
brief-generation      → grounded synthesis and writing
```

A provider-agnostic `ModelRouter` resolves each request based on capability, quality, approximate cost, configured resource guards, availability, and prior failures.

Required adapters include:

- Codex subscription access
- OpenRouter
- an extension contract for future providers

Specific model names are configuration data, not business-logic dependencies. DeepSeek V4 Pro and Momo 2.5 Pro are candidate examples only when available.

The upstream CLIProxyAPI distribution is the prototype-only experimental transport for Codex subscription access. It remains behind the provider boundary and is not presented as an officially endorsed or permanent production integration.

Every provider call records:

- requested capability profile;
- resolved provider and model;
- prompt/schema version;
- usage and available cost data;
- latency;
- status and retry number;
- structured input/output references.

Provider selection remains automatic. Provider details are inspectable in run details but are not exposed as a primary user control.

## Access and Prototype Guards

The prototype is private and invitation-only.

- Exactly five invitation records are created.
- One invitation belongs to the administrator and four to analysts. Convex Auth anonymous sessions are admitted through high-entropy, single-use invitation codes whose plaintext is never persisted.
- Each admitted visitor may reserve at most three analyses in total.
- Limits are enforced in server-side Convex mutations and persist across sessions.
- Analysis reservations are atomic.
- Technical retries and workflow resumes do not consume another analysis.
- Abandoned or voluntarily deleted analyses remain counted.
- Administrative quota restoration requires an audited reason.

The workflow also uses simple configurable safety guards: bounded retries, limits on research breadth and document pages, provider-call limits where useful, provider-side spending controls when available, and an emergency switch that prevents new paid work. Provider usage, latency, and reported cost are recorded when available, but the prototype does not implement transactional dollar reservations, settlement accounting, or precise per-dossier cost enforcement.

## Error Handling

- An inaccessible source remains visible with a specific failure state.
- Failure to retrieve one source does not stop unrelated retrieval tasks.
- A passage without a stable source location is rejected.
- An insufficiently supported claim is downgraded to `Hypothesis` or `Unknown`.
- A weak evidence base produces `0 / Mixed or unclear`, not a forced directional score.
- Provider output that fails schema validation is retried under bounded policy and never persisted as validated evidence.
- Human decisions are never overwritten by a workflow retry or later provider response.
- Cancellation may allow an already-running external request to finish, but its result must not advance a cancelled run.

## Demonstration Strategy

The demonstration exists to let Raphaëlle evaluate the author's technical-economic judgment and ability to accelerate analyst preparation. Infrastructure details should appear only when they reinforce that proof.

The Loom demonstration uses two paths:

1. A completed, carefully evaluated showcase dossier demonstrates the evidence matrix, assessment, architecture map, and analyst override.
2. A real new assessment demonstrates company resolution, source discovery, live progress, and the mandatory human checkpoint.

The recording must not present cached or precomputed output as live work.

## Evaluation Strategy

A small, manually curated evaluation set will cover two or three companies with different architectural profiles. Each case includes an approved corpus, expected claims, known contradictions, and deliberately unresolved questions.

Evaluation dimensions:

- citation validity;
- source-to-claim entailment;
- fact/inference/hypothesis/unknown classification;
- contradiction retrieval;
- assessment-question coverage;
- unsupported-claim rate;
- elapsed research time;
- provider usage or reported cost when available;
- analyst correction rate and correction type.

Software verification includes:

- atomic quota reservation under concurrency;
- workflow resumption and idempotency;
- mandatory source checkpoint enforcement;
- exclusion of rejected sources;
- provider schema validation;
- preservation of analyst decisions;
- brief generation from approved claims only;
- correct local handling of partial source failures.

The application exposes a concise Methodology & Limitations page with measured results only. Detailed evaluation material may live in a linked technical note.

## MVP Scope

Included:

- invitation access and persistent quotas;
- US-listed technology company resolution;
- automated source discovery and research planning;
- manual URL and PDF addition;
- mandatory corpus approval;
- passage and claim extraction;
- counter-evidence discovery;
- dimension-level assessment proposals;
- analyst overrides and audit trail;
- evidence matrix;
- secondary architecture map;
- validated-evidence-only draft brief;
- reactive progress and durable workflows;
- provider routing and best-effort usage telemetry;
- one completed showcase dossier;
- methodology and limitations page.

Explicitly excluded:

- investment recommendations or trade execution;
- aggregate resilience score;
- non-US markets;
- continuous company monitoring;
- simultaneous analyst collaboration;
- model fine-tuning;
- general-purpose web crawling;
- autonomous publication without review;
- claims of reproducing Decoding Discontinuity's proprietary framework.

## Critical Uncertainties

1. Search and document-extraction quality, especially reproducible web and PDF locators.
2. The showcase company that best demonstrates original, nuanced architectural judgment to Raphaëlle.
3. The minimum evidence-question set needed for each assessment dimension.

## Failure Conditions

The prototype fails its purpose if any of the following are true:

- It produces a plausible narrative whose reasoning cannot be audited.
- It resembles a general web-answer engine with a custom prompt.
- Its architecture map contains relationships unsupported by evidence.
- Its scores imply precision that the evidence cannot support.
- Its progress UI simulates activity rather than reflecting persisted work.
- It automates judgment rather than accelerating and structuring analyst preparation.
- Its technical safeguards and operational machinery overshadow the analytical demonstration.

## Definition of Done

The MVP is complete when an invited analyst can:

1. Start an analysis for a supported company within enforced quotas.
2. Observe real source-discovery progress.
3. Review and approve a proposed source corpus.
4. Resume a durable workflow after that approval.
5. Inspect atomic claims with precise citations and counter-evidence.
6. Review dimension scores, confidence, and three-year direction.
7. Override a score with an audited justification.
8. View an evidence-backed architecture map.
9. Generate a draft brief containing only approved claims.
10. Inspect the methodology, limitations, provider usage, and duration.

## Related Decisions

- [ADR-001: Build an evidence-first analyst workbench](../decisions/001-evidence-first-analyst-workbench.md)
- [ADR-002: Use Convex for reactive persistence and durable workflows](../decisions/002-convex-reactive-persistence-and-workflows.md)
- [ADR-003: Use upstream CLIProxyAPI for Codex subscription transport](../decisions/003-use-upstream-cliproxyapi-for-codex-subscription-transport.md)
- [ADR-004: Use SEC, Exa, and Unstructured for source acquisition](../decisions/004-use-sec-exa-and-unstructured-for-source-acquisition.md)
- [ADR-005: Enforce prototype provider cost ceilings (superseded)](../decisions/005-enforce-prototype-provider-cost-ceilings.md)
- [ADR-006: Use lightweight prototype usage guards](../decisions/006-use-lightweight-prototype-usage-guards.md)
- [ADR-007: Use anonymous Convex Auth with one-time invitations](../decisions/007-use-anonymous-convex-auth-with-one-time-invitations.md)
