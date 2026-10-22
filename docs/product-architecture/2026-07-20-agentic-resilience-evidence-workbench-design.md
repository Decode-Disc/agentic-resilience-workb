# Agentic Resilience Evidence Workbench — Product Design

## Status

Validated design. Refined for Roadmap Phases 4–8 on 2026-07-27, deterministic source-proposal review on 2026-08-07, ephemeral visual preview on 2026-08-09, and decision-anchored Phase 5 evidence workflow on 2026-08-15. Reconciled on 2026-10-22 with ADR-024 pre-approval content preparation, ADR-025 scoped retrieval and the recorded evaluation limits. This product contract does not certify implementation or activation; see the [recorded delivery state](../ROADMAP.md#recorded-delivery-state-2026-10-22).

## Date

2026-07-20; revised 2026-07-27, 2026-08-07, 2026-08-09, and 2026-08-15

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
Company preflight and confirmation
→ Quota reservation and authoritative revalidation
→ Public-evidence sufficiency checkpoint when needed
→ Source discovery
→ Mandatory source review
→ Evidence extraction
→ Typed validation and targeted semantic verification
→ Exception-driven claim and dimension review
→ Progressive architecture map and draft brief
```

### 1. Company resolution

The analyst searches by partial company name, ticker, CIK, or SEC URL and may add an optional research angle. The angle prioritizes discovery and presentation; it cannot change the ten dimensions, evidence rules, or deliverables.

The system returns a bounded list of matching public companies and requires the analyst to select one explicitly. It then performs a non-billable preflight revalidation of the selected CIK while keeping the populated composer available so the analyst can finish the research direction and references. Only an explicit Continue action replaces the composer with an in-place confirmation surface showing the legal entity, ticker, exchange, and SEC identity. Neither surface adds numbered steps or explanatory headings when the controls and company record already communicate the action.

Non-billable means that preflight reserves no visitor analysis and creates no research run. It may use bounded Exa credits to resolve commercial website metadata for favicons. That enrichment is cached by CIK, remains visual only, never changes SEC identity, and never blocks a valid SEC preflight. The display falls back to the SEC investor-relations website and then the existing company icon.

This Start search and preflight are available before workspace access under a browser-bound anonymous Auth session. On confirmation, an unadmitted visitor enters a reusable four-digit access code in a top drawer; the system then links the corresponding stable visitor, atomically reserves the analysis and authoritatively revalidates the canonical company identity before paid research.

The system then estimates whether enough public material is available. If the evidence base appears insufficient, the workflow pauses instead of failing. The analyst may add public HTTPS URLs and rerun the check, end with `insufficient_public_evidence`, or force continuation with a required, append-only rationale. A forced continuation never relaxes corpus approval, provenance, claim classification, or confidence rules.

### 2. Source discovery

The system creates a research plan tailored to the company and searches by source category and assessment dimension. It displays real progress based on persisted workflow events.

### 3. Mandatory source checkpoint

The workflow reads and qualifies bounded public candidates after discovery, inspecting existing alternatives before one finite supplement. It creates a versioned `SourceSelectionProposal` backed by immutable captured content. Deterministic selection consumes typed, passage-anchored qualification without promoting provenance or asserting that document claims are true. Explicit analyst approval remains mandatory before analytical source versions, passages, claims or assessments. ADR-024 defines the exact preparation boundary and amends earlier metadata-only clauses.

This stage prepares enough useful, inspectable material for subsequent analysis at bounded cost. It need not resolve every research question or make every selection judgment correctly. Preserve useful imperfect sources with attribution, restrictions and visible gaps. An unavailable read, low rank or incomplete qualification does not establish that a source is irrelevant. Retaining a source, covering a documentary need and verifying a factual assertion are distinct outcomes.

The policy first removes exact duplicates and identifies demonstrated duplicate artifacts, then preserves analyst-supplied sources, evaluates inspected content, covers preset-specific document roles, and adds only candidates that contribute a new document type, normalized period, material event, qualified independent producer, or research-angle match. A missing role remains a visible gap; the system never recommends a low-value source merely to fill a slot.

The server-owned `SOURCE_RECOMMENDATION_CEILING` defaults to half of `SOURCE_CANDIDATE_LIMIT`, rounded up, remains configurable, and cannot exceed the candidate limit. It is a circuit breaker rather than a quota: the adaptive policy stops when no candidate adds a distinct document role, period, event, qualified independent producer, or research-angle contribution. Proposal items are `recommended`, `needs_attention`, or `alternative`; `needs_attention` is reserved for rare identity or provenance conflicts.

Each proposal item records the basis used to link it to the selected company. Structural linkage comes from confirmed CIK, official company domains, or the approved decoded-path checks. A candidate on a declared institutional publisher or shared IR host may instead use `discovery_metadata` linkage when its discovery title contains the complete normalized legal name or an exact confirmed domain alias of at least five characters. That bounded signal may place the candidate in `Recommended`, but it cannot establish document kind, duplicate identity, claim evidence, or automatic coverage. The item preserves registry-declared roles separately from candidate-specific eligible roles. Under ADR-024, anchored inspected content can establish candidate relevance and purpose; discovery metadata alone cannot. Authority remains provenance-based. Each documentary need distinguishes suitable documents, useful contributions with limitations and a need not established, including unavailable reading and analyst exclusion. Two domains do not establish independent corroboration.

The default source-checkpoint surface summarizes the proposed corpus, source-family coverage, visible gaps, exceptions, and analyst adjustments. `DiscreteTabs` switches among `Recommended`, `Needs attention`, and `Alternatives`. The analyst may approve the proposal without opening every source, adjust it through separate `Included` and `Available` working sets, inspect every candidate in the preserved master-detail view, or add public HTTPS URLs.

The Start composer validates an attached public HTTPS reference immediately and holds only an expiring server-owned preparation receipt. Dossier creation atomically converts valid receipts into pending candidates in the first draft corpus revision. The same intake action adds a pending candidate directly when the analyst is already reviewing an active dossier. A prepared or pending URL still requires the normal corpus decision and cannot contribute downstream. Once it becomes a valid candidate, an analyst-supplied source is recommended by default before and outside the recommendation ceiling, which counts only automatically discovered candidates, and remains removable before approval.

System recommendations never become human decisions by themselves. Analyst adjustments use append-only source decisions. `Approve proposed corpus` atomically preserves those overrides, writes an individual accepted decision for every still-pending recommended source, leaves all other candidates pending, approves the corpus revision, and resumes the workflow. A changed candidate set makes the proposal stale and requires recomputation without overwriting analyst decisions. A draft created by an older policy displays `Improved proposal method available`, blocks approval, and requires an explicit rebuild that preserves analyst decisions; approved corpora remain unchanged. A rebuild that refreshes only part of discovery creates a reviewable proposal with the affected source families and coverage consequence visible before approval. A blocked rebuild keeps the outdated draft in place and tells the analyst that the existing draft and decisions are unchanged.

An editable draft `CorpusRevision` may receive several source additions or decisions without a new revision for each URL. An approved revision contains accepted sources only and is immutable. Changing its membership creates a new draft and reopens the source checkpoint; several changes may be grouped before approval. Pending sources remain visible and may receive bounded preparation, but cannot contribute analytical evidence. Unchanged captures may be reused under their identity and version rules; complete incremental downstream recomputation is not established by this contract. Local file and PDF upload is outside the MVP. Public PDFs use bounded Exa text for preparation and exact captured-text materialization after approval, with no invented page locators. Page-aware PDF parsing remains deferred.

Useful arguments from imperfect publications retain attribution and enforceable restrictions. An argument depending on an identified false premise is excluded for that use. Unverified arguments remain hypotheses, and contextual or opposing citations cannot inflate factual authority or corroboration. Preparation is capped at the initial 48 candidates plus one supplement of at most 3 searches and 12 additions, with a 60-candidate historical ceiling and unchanged 24-source automatic recommendation ceiling. See ADR-024 for input, attempt and deadline limits.

### 4. Evidence matrix

For prepared dossiers, approval pins the inspected captures and qualification references. Analytical source versions reuse those exact normalized bytes after hash, locator and accepted-source validation. Missing or corrupt captures fail explicitly rather than silently substituting a fresh download. Legacy approved corpora without captures retain their acquisition path. The system derives atomic claims from precisely locatable approved passages and classifies each as:

- `Fact`: explicitly established by a source.
- `Inference`: a reasoned conclusion derived from cited facts.
- `Hypothesis`: a plausible proposition requiring investigation.
- `Unknown`: a material question without sufficient evidence.

Each claim links to exact source passages. One canonical claim may inform several dimensions; claim approval and dimension-link decisions remain separate.

Retained captures, search candidates, selected model context and analytical passages have different limits and purposes. Later claim extraction, counter-evidence search, policy checks and analyst review refine the dossier, but only from material those stages can actually access. Preservation of a full capture does not alone establish downstream retrieval of an unselected passage. That handoff remains an explicit verification item in the roadmap, alongside the unfinished general live claim pipeline.

The default review is exception-driven. Typed AI tasks propose complete claim packages, while application-owned deterministic policies validate provenance, coverage, corroboration, and rule outcomes. The analyst may approve a reviewed group in one action; the server still persists individual append-only decisions. A correction produces a cited replacement claim and visible diff instead of mutating the original.

### 5. Architectural assessment

The system proposes a position, evidence confidence, and three-year direction for each dimension. It must show supporting claims, counter-evidence, and critical unknowns before presenting a score. A dimension becomes reviewable when the claims and dimension links feeding that proposal have decisions; unrelated dimensions may remain locked.

### 6. Analyst review

The analyst makes one atomic decision per dimension covering position, confidence, and three-year direction. Field-level overrides require a written justification. The AI proposal, deterministic policy inputs and outcomes, analyst decision, and full revision history remain visible.

### 7. Derived outputs

The architecture map and draft brief are progressive projections of validated evidence. After each dimension decision, the application updates only the affected relationships and sections, displays the new persisted contribution, and keeps incomplete coverage visible. They cannot introduce unsupported entities, relationships, or assertions and become final only after all ten dimension decisions.

## Information Architecture

The main screens are:

1. Workspace access
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

The research workspace uses a persistent navigation rail showing `Progress`, `Sources`, `Evidence`, `Assessment`, `Map`, and `Brief`. All sections remain visible; completed sections remain revisitable, and locked sections explain their exact persisted prerequisite. On desktop, the selected item opens in a retractable contextual panel beside the primary workspace. On smaller screens, that panel becomes a drawer.

Source review is a dedicated, summary-first workspace mode. The proposal summary and corpus-approval action occupy the primary decision surface. The existing source-specific master list, source detail, pagination, filters, responsive drawer, and preview remain available through proposal adjustment and full-candidate inspection. The matrix is never shown as if unapproved sources had already produced evidence.

### Ephemeral visual preview

A candidate source may display an ephemeral visual preview — a fixed-viewport screenshot of the public HTTPS URL — inside the Preview tab of the source context panel. This preview exists to reduce context-switching during review and is available only for pending (undecided) candidates.

The preview is a **visual convenience, not evidence**. It is not source retrieval, content normalization, structured extraction, or a substitute for the mandatory corpus-approval checkpoint. A preview never contributes to a corpus, claim, assessment, map, or brief. The screenshot is transient and never persisted.

Previews carry a visible `Preview — for visual reference only` label and use distinct visual treatment from accepted evidence. A rendering failure or unreachable service falls back cleanly to the existing `Open original` external link without blocking review or approval.

See ADR-019 for the full boundary and security contract.

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
SourceSelectionProposal
SourceSelectionProposalItem
SourceDecision
CorpusRevision
SourceCapture
SourceVersion
SourcePassage
Claim
ClaimEvidence
ClaimDecision
ClaimDimensionDecision
Relationship
AssessmentDimension
ScoreProposal
AssessmentDecision
BriefRevision
ProviderCall
AITaskResult
PolicyEvaluation
```

Important invariants:

- A claim must reference one or more precisely locatable passages.
- A source rejected at the checkpoint cannot contribute to later claims or scores.
- A generated brief can use only analyst-approved claims.
- Human decisions are append-only audit events, not destructive replacements.
- Corpus, claim, dimension-link, assessment, map, and brief history is revision-aware.
- A map relationship must be backed by validated claims.
- A retry must not duplicate claims, quota reservations, or billing records.
- AI results are typed proposals. Application-owned, versioned policy determines structural validity and quality gates.
- Source-selection proposals never replace append-only analyst decisions or approve a corpus without an explicit human checkpoint.

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
| ---: | --- |
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

The source checkpoint shows why each source was recommended or deferred, its likely source-family contribution, date and authority, duplicate or superseding versions, extraction restrictions, and whether the analyst changed the proposal. Metadata-derived family labels are estimates and never claim that a source establishes a fact before extraction.

For a discovery-metadata recommendation, the checkpoint labels that linkage basis explicitly while keeping publisher authority, document kind, declared role capability, and automatic role eligibility separate. Analyst acceptance authorizes the normal approved-corpus flow but never rewrites the linkage basis as structural.

The start surface offers three coverage presets: `Balanced` by default, `First-party depth`, and `Independent scrutiny`. They adjust discovery priority and bounded query budgets; they cannot disable regulatory coverage, provenance, extraction validation, or counter-evidence work. Pipeline stages are not presented as optional "evidence layer" switches.

## Orchestration

The workflow is deterministic and staged. Specialized model calls are used where they provide a clear separation of concerns; the product does not expose a theatrical swarm of agents.

```text
Preflight-resolve company
→ Confirm company and reserve analysis
→ Revalidate canonical identity
→ Check public-evidence sufficiency
→ Await evidence decision when insufficient
→ Build research plan
→ Discover sources in parallel
→ Capture, normalize and qualify bounded public candidates
→ Compare scoped contributions and inspect one finite supplement when needed
→ Persist proposed CorpusRevision and SourceSelectionProposal
→ Await corpus-revision approval
→ Materialize exact approved captures (retrieve legacy approved sources without captures)
→ Extract analytical passages and atomic claims
→ Validate typed results and run targeted semantic checks
→ Search for counter-evidence within the approved corpus
→ Propose dimension assessments
→ Await exception-driven analyst decisions by dimension
→ Incrementally update derived views
→ Finalize after all ten dimensions
```

The progress interface displays only real persisted events. It may show stages, counts, durations, failures, and retries, but never hidden chain-of-thought or simulated agent conversations.

Workflow step states:

- `queued`
- `running`
- `completed`
- `needs_review`
- `failed`
- `skipped`

Research run lifecycle remains a product projection rather than a log of every provider call. It must distinguish evidence-sufficiency review from corpus review and preserve a completion outcome:

```text
draft
→ checking_public_evidence
→ awaiting_evidence_sufficiency_review (when required)
→ discovering_sources
→ awaiting_source_review
→ corpus_approved
→ extracting_evidence
→ evidence_ready
→ assessing_dimensions
→ awaiting_assessment_review
→ completed
```

`completionOutcome` is `completed_assessment` or `insufficient_public_evidence`. A later explicit corpus revision may start a new workflow execution generation for the same dossier without erasing the previous completed revision.

`corpus_approved` is an honest vertical-slice handoff. The approved revision is immutable. New approvals automatically continue through an atomic server handoff into the separate Phase 5 workflow on the same Convex Workflow engine. The shared protected start implementation freezes effective accepted `SourceDecision` heads, claims the execution slot once, and transitions to `extracting_evidence + running`. Historical idle approved dossiers retain the owner-authorized start boundary. Sources remain inspectable read-only during and after preparation. See the 2026-10-19 amendment to ADR-023.

`evidence_ready` is a strong handoff between Phase 5 and Phase 6. It requires every frozen source branch to be terminal, at least one structurally valid reproducible passage, a terminal claim pipeline, and at least one structurally valid claim visible in the matrix. Individual sources may have failed, and policy outcomes may remain `needs_review` or `blocked`; those limitations remain visible without preventing the matrix from being ready. When a live dossier has valid retrieved passages but the deterministic claim adapter is not authorized for their hashes, the run pauses at `extracting_evidence + paused + claim_generation_unavailable` without fabricating claims, `Unknown`, or Phase 6 access. See ADR-023.

The run stores the active workflow ID only while a workflow is running; Phase 4 `onComplete` success compare-and-clears the stored ID when it still matches the completed handle, so a newer execution cannot be erased by a late completion.

Execution status is tracked separately as `idle`, `running`, `paused`, `failed`, `cancelled`, or `completed`; a pause identifies the pending human checkpoint or the `claim_generation_unavailable` technical stop. Operational `WorkflowStep`, `AuditEvent`, and `CheckpointDecision` records support this lifecycle without becoming analytical artifacts.

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
claim-entailment      → bounded semantic verification
contradiction-verification → bounded semantic verification
dimension-relevance   → bounded semantic verification
claim-correction      → grounded replacement proposal
dimension-assessment  → strongest suitable reasoning
brief-generation      → grounded synthesis and writing
```

The deterministic Phase 4 source-selection proposal does not call the `source-relevance` capability. That capability remains an optional future path only if measured metadata-policy failures justify its additional cost and provider boundary.

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

The application owns routing, bounded retry, and fallback. OpenRouter uses `@openrouter/ai-sdk-provider`; private CLIProxyAPI transport uses `@ai-sdk/openai-compatible`. SEC uses direct HTTP. Exa discovery uses metadata-only search. Exa Contents retrieval is permitted for eligible candidates under ADR-024 preparation authority and for legacy approved sources without captures. Approval reuses the exact prepared content. Optional hosted embeddings under ADR-025 support retrieval without a local embedding model or another persistence owner. The planned page-aware PDF adapter uses the Unstructured Pipeline Jobs HTTP API; real integration remains deferred.

Each configured task declares its primary provider and optional fallback. Provider-internal routing may preserve the same configured model under explicit parameter and privacy constraints, but it may not silently change the application-selected task or model. Every retry and fallback attempt is a separate `ProviderCall`.

## Access and Prototype Guards

The research workbench is private and access-code protected. The Start surface and non-billable company preflight are publicly accessible under a browser-bound anonymous Auth session; they do not create a dossier or consume quota.

- Exactly five stable access-slot records are created.
- One access code belongs to the administrator and four to analysts. Convex Auth anonymous sessions are linked to stable visitors through reusable four-digit codes whose plaintext is never persisted. The server limits attempts to five per anonymous Auth identity and 25 deployment-wide in a 15-minute window.
- Workspace access is requested in a top drawer when an unadmitted visitor confirms a resolved company or directly visits a protected workspace route.
- Reusing a code from a new anonymous session preserves the visitor, role, dossiers, quotas, and audit history while invalidating the previous session's protected access.
- Dossier routes and administration remain withheld until the server resolves an active admitted visitor.
- Each admitted visitor may reserve at most three analyses in total.
- Limits are enforced in server-side Convex mutations and persist across sessions.
- Analysis reservations are atomic.
- Technical retries and workflow resumes do not consume another analysis.
- Abandoned or voluntarily deleted analyses remain counted.
- Administrative quota restoration requires an audited reason.
- A visitor may have only one workflow with `executionStatus = running`. Dossiers paused at a human checkpoint do not block another launch.

The workflow also uses simple configurable safety guards: bounded retries, limits on research breadth and document pages, provider-call limits where useful, provider-side spending controls when available, and an emergency switch that prevents new paid work. Provider usage, latency, and reported cost are recorded when available, but the prototype does not implement transactional dollar reservations, settlement accounting, or precise per-dossier cost enforcement.

The administrator receives a minimal operational view for active workflows, human checkpoints, failures, provider calls, available usage/cost, audited quota restoration, and the paid-work emergency switch. It is not a dynamic provider or policy configuration console.

## Error Handling

- An inaccessible source remains visible with a specific failure state.
- Failure to retrieve one source does not stop unrelated retrieval tasks.
- A passage without a stable source location is rejected.
- An insufficiently supported claim is downgraded to `Hypothesis` or `Unknown`.
- A weak evidence base produces `0 / Mixed or unclear`, not a forced directional score.
- Provider output that fails schema validation is retried under bounded policy and never persisted as validated evidence.
- Structural failures such as rejected-source provenance or an unresolved locator cannot be overridden. Analytical policy outcomes may be overridden with a persisted reason.
- An insufficient-evidence result pauses for URL addition, justified continuation, or explicit completion; it is not rendered as a generic error.
- Human decisions are never overwritten by a workflow retry or later provider response.
- Cancellation may allow an already-running external request to finish, but its result must not advance a cancelled run.
- A proposal with no eligible recommendation disables corpus approval and directs the analyst to inspect candidates or add a source.
- A changed candidate set marks the proposal stale; approval cannot continue until deterministic recomputation succeeds.

## Demonstration Strategy

The demonstration exists to let Raphaëlle evaluate the author's technical-economic judgment and ability to accelerate analyst preparation. Infrastructure details should appear only when they reinforce that proof.

The Loom demonstration uses two paths:

1. A completed, carefully evaluated showcase dossier demonstrates the evidence matrix, assessment, architecture map, and analyst override.
2. A real new assessment demonstrates company resolution, source discovery, live progress, and the mandatory human checkpoint.

The recording must not present cached or precomputed output as live work.

## Evaluation Strategy

CCC Intelligent Solutions remains the primary curated showcase under its accepted bounded scope. Expected claims, known contradictions, and deliberately unresolved questions for that showcase are defined after manual corpus approval. Reuse that dossier for analytical regression instead of creating a parallel "golden" CCC dossier.

Small deterministic fixtures isolate policy rules such as rejected-source exclusion, locator validity, contradiction handling, duplicate detection, and coverage thresholds. Evaluate source preparation across multiple companies, source families and dossier types independently of showcase curation. Broad research, targeted questions, supplied references and uncertain arguments exercise different needs without requiring several completed showcase dossiers.

Judge preparation by useful retained material, visible limitations, exact provenance, bounded cost and the analyst's ability to continue. It is not required to answer all questions or reproduce one evaluator-selected passage. Distinguish source inclusion, exact-reference retention, equivalent useful evidence, displayed qualification and later analytical correctness. The [Snowflake interpretation correction](../verification/2026-10-21-evidence-retrieval-repair.md#interpretation-correction-2026-10-22) shows why reference-location scores alone cannot select a retrieval architecture. Existing multi-company replays remain illustrative, historically observed and investigator-adjudicated. New quality thresholds and a definitive technology choice require an explicit decision rather than retrospective adjustment of the reference.

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
- deterministic source-proposal targeting, dynamic family coverage, stale detection, and grouped approval writing individual decisions;
- exclusion of rejected sources;
- provider schema validation;
- preservation of analyst decisions;
- brief generation from approved claims only;
- correct local handling of partial source failures.

The application exposes a concise Methodology & Limitations page with measured results only. Detailed evaluation material may live in a linked technical note.

## MVP Scope

Included:

- access-code admission and persistent quotas;
- US-listed technology company resolution;
- automated source discovery and research planning;
- manual public HTTPS URL addition;
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
- local file and PDF upload;
- model fine-tuning;
- general-purpose web crawling;
- autonomous publication without review;
- claims of reproducing Decoding Discontinuity's proprietary framework.

## Critical Uncertainties

1. Search and document-extraction quality, especially reproducible web and PDF locators.
2. Whether the bounded CCC public corpus can distinguish economic orchestration from carrier-owned rules, network participation, and replaceable workflow modules.
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
2. Confirm the preflight company identity before quota reservation.
3. Resolve an evidence-sufficiency checkpoint through URL addition, explicit completion, or a justified override.
4. Observe real source-discovery progress.
5. Review a deterministic, versioned source proposal, adjust only when needed, and approve the corpus in one action while leaving unselected candidates pending.
6. Resume a durable workflow after that approval.
7. Review typed, policy-evaluated claims through an exception-driven surface with precise citations and counter-evidence.
8. Review atomic dimension decisions for position, confidence, and three-year direction.
9. Correct or override a proposal with an audited justification.
10. Observe the architecture map and draft brief evolve from approved claims without hiding incomplete coverage.
11. Inspect the methodology, limitations, provider usage, and duration.
12. Allow an administrator to inspect operations and stop new paid work.

## Related Decisions

- [ADR-001: Build an evidence-first analyst workbench](../decisions/001-evidence-first-analyst-workbench.md)
- [ADR-002: Use Convex for reactive persistence and durable workflows](../decisions/002-convex-reactive-persistence-and-workflows.md)
- [ADR-003: Use upstream CLIProxyAPI for Codex subscription transport](../decisions/003-use-upstream-cliproxyapi-for-codex-subscription-transport.md)
- [ADR-004: Use SEC, Exa, and Unstructured for source acquisition](../decisions/004-use-sec-exa-and-unstructured-for-source-acquisition.md)
- [ADR-005: Enforce prototype provider cost ceilings (superseded)](../decisions/005-enforce-prototype-provider-cost-ceilings.md)
- [ADR-006: Use lightweight prototype usage guards](../decisions/006-use-lightweight-prototype-usage-guards.md)
- [ADR-007: Use anonymous Convex Auth with one-time invitations](../decisions/007-use-anonymous-convex-auth-with-one-time-invitations.md)
- [ADR-008: Use versioned research revisions and exception-driven review](../decisions/008-use-versioned-research-revisions-and-exception-driven-review.md)
- [ADR-009: Use typed AI tasks and deterministic policy adjudication](../decisions/009-use-typed-ai-tasks-and-deterministic-policy-adjudication.md)
- [ADR-010: Keep provider routing, retries, and fallback application-controlled](../decisions/010-keep-provider-routing-retries-and-fallback-application-controlled.md)
- [ADR-011: Restrict manual source intake to public HTTPS URLs](../decisions/011-restrict-manual-source-intake-to-public-https-urls.md)
- [ADR-012: Expose company preflight before invitation admission](../decisions/012-expose-company-preflight-before-invitation-admission.md)
- [ADR-013: Use rate-limited four-digit invitation OTPs](../decisions/013-use-rate-limited-four-digit-invitation-otps.md)
- [ADR-014: Use reusable access codes for stable visitors](../decisions/014-use-reusable-access-codes-for-stable-visitors.md)
- [ADR-015: Use bounded Exa company website enrichment before admission](../decisions/015-use-bounded-exa-company-website-enrichment-before-admission.md)
- [ADR-016: Centralize manual source intake with expiring preparations](../decisions/016-centralize-manual-source-intake-with-expiring-preparations.md)
- [ADR-017: Use deterministic source selection proposals](../decisions/017-use-deterministic-source-selection-proposals.md)
- [ADR-018: Use an adaptive source selection policy](../decisions/018-use-adaptive-source-selection-policy.md)
- [ADR-019: Ephemeral visual preview of candidate sources](../decisions/019-ephemeral-visual-preview-candidate-sources.md)
- [ADR-020: Historical counter-evidence selection (superseded)](../decisions/020-admit-inspectable-counter-evidence-without-publisher-whitelist.md)
- [ADR-021: Separate source provenance from automatic role eligibility](../decisions/021-separate-source-provenance-from-automatic-role-eligibility.md)
- [ADR-022: Persist company linkage basis for source recommendations](../decisions/022-persist-company-linkage-basis-for-source-recommendations.md)
- [ADR-023: Use a decision-anchored Phase 5 evidence workflow](../decisions/023-use-decision-anchored-phase-5-evidence-workflow.md)
- [ADR-024: Qualify source content before corpus approval](../decisions/024-qualify-source-content-before-corpus-approval.md)
- [ADR-025: Use versioned, scoped evidence retrieval](../decisions/025-use-versioned-scoped-evidence-retrieval.md)


## Source review recovery clarification, 2026-10-19

The source proposal distinguishes failed searches from unconfirmed source requirements. Failed searches retain previously found candidates and offer Retry failed searches. Unconfirmed requirements explain that the included sources have not established coverage and offer Review candidates and Search sources. Review uses the existing candidate inspector with requirement context. The existing Add source link action opens the same HTTPS intake dialog on desktop and through Source actions on mobile. Searches are explicit, bounded, metadata-only, and subject to the normal authorization and resource controls.

Coverage feedback follows current inclusion, removal, undo, and proposal refresh without rewriting the immutable recommendation. Adding a link or including an unverified candidate does not establish automatic coverage. Empty discovery results, unavailable searches, and source-capacity limits provide a consequence and next action. Approval remains available with unresolved coverage limitations once the existing approval conditions are satisfied and no recovery is active. Approved source sets remain read-only and preserve their limitations.
