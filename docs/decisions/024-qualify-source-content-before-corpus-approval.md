# ADR-024: Qualify Source Content Before Corpus Approval

> **Historical record.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

## Status

Accepted for implementation. This record defines intended behavior; it is not an implementation acceptance report. See the implementation plan (historical checkpoint: `git show c4f0d24:docs/superpowers/plans/2026-10-20-preapproval-source-qualification.md`), [recorded delivery state](../ROADMAP.md#recorded-delivery-state-2026-10-22) and [source-review corrections](../verification/2026-10-22-source-review-corrections.md). The implementation and bounded experiments do not establish accepted general activation or completed live analytical work. Historical call allowances are not renewed by this document.

## Date

2026-10-20

## Context

The ServiceNow source audit found useful arguments among alternatives, obsolete destinations, content-dependent classification errors and factual discrepancies. Metadata alone cannot establish documentary purpose or substantive relevance. Analyst acceptance changes inclusion but cannot establish provenance or verify assertions. Requiring analysts to read and certify each need would transfer routine preparation work back to them.

The recorded comparison preserves nineteen documents and ninety-nine expected judgments written by the investigating assistant before inference. It supports bounded semantic qualification, not universal accuracy, factual verification or independent human ground truth. The exact inputs, historical failures and judgments remain under `scripts/evaluations/source-selection/`.

## Decision

### Separate preparation authority from analytical evidence authority

Allow bounded retrieval, normalization and qualification of public candidates before corpus approval. Store immutable `SourceCapture` artifacts and typed qualification results. These are preparation material, not accepted analytical passages or claims. Corpus approval remains mandatory before accepted captures become `SourceVersion` and `SourcePassage` evidence. Keep analytical accepted-decision fields and fences required.

Pin capture and qualification references on each immutable proposal. Approval fixes those references. Materialization reuses the same normalized storage object and hash, without silently retrieving replacement content. Missing or corrupt captures fail explicitly. Existing historical approved corpora retain their original retrieval path.

The objective is useful, inspectable preparation at bounded cost, not exhaustive research or error-free selection by one model. Preserve useful sources with explicit uncertainty and contribution-level restrictions. Source retention does not establish documentary coverage, and documentary coverage does not verify each assertion. Later stages refine the analysis, but capture preservation alone does not demonstrate access to every unselected passage through the unfinished analytical pipeline.

Several sources may be added within the same editable draft revision. Changing an approved source set requires a new draft and a new durable approval, with changes grouped where appropriate. Reuse unchanged captures and exact-input qualifications under their versioned cache rules; do not infer that all later analytical outputs already support incremental recomputation. ADR-008 retains ownership of revision history.

### Inspect existing candidates, then permit one finite supplement

Inspect all existing non-rejected candidates, including alternatives. Skip retrieval only for demonstrated duplicates, such as canonical URL or exact artifact identity, not a title or old recommendation rank. Reuse unchanged captures and qualified logical inputs. Group questions about a document into one task.

Where usable coverage remains unestablished, reserve one immutable automatic supplement per dossier before paid work. Its maximum is three searches, four additions per search and twelve additions overall. Initial discovery stays at forty-eight. The historical candidate ceiling is sixty, retaining manual additions, rejected sources and previous decisions. Keep the automatic recommendation ceiling at twenty-four. Resume the same plan and counters; a new generation or revision cannot grant another automatic supplement. Stop at the envelope, deadline, satisfied needs or a condition additional authorized work cannot resolve.

### Separate documentary availability, provenance and truth

Each documentary role distinguishes suitable documents available, useful contributions with limitations, and need not established. Persist the precise reason, including unavailable reading, no relevant material found, insufficient period/provenance, or analyst exclusion. An inaccessible or partially read document is not proven irrelevant. A positive narrow finding may be established from a passage without asserting full-document review.

Qualification records company relationship, document purpose, period, exact passages, asserted facts, attributed arguments, forecasts, reported outcomes and limitations. The model cannot assign final selection, provenance authority, factual verification or evidence confidence. Two domains do not prove editorial independence or corroboration. Discovery metadata remains a lead, never factual evidence.

The model selects bounded documentary choices and identifiers of inspected passages. The application resolves these identifiers within the exact hashed input and materializes their complete quotations and presentation excerpts. Excerpts are not analytical summaries. A nullable contribution means no positive contribution was established from inspected content, not proven absence from a partially read document. Provenance validation and semantic evaluation remain separate gates.

The technical response representation permits up to two homogeneous contributions per role within the existing overall fifteen-finding bound. Each contribution retains its own nature, period and exact passages. A passage containing inseparable or uncertain kinds is explicitly mixed or uncertain and cannot support factual use. Role-level documentary availability does not grant factual eligibility to every cited passage. The existing citation-use policy applies each contribution's restrictions separately. This is a representation correction within the same grouped call, not a claim that model classifications or source assertions are verified. Historical approved pins remain readable under their recorded protocol without being relabelled as current-model evidence.

### Retain useful contributions with enforceable restrictions

An imperfect article may contribute an argument that does not depend on an identified error. Preserve attribution and restrictions. An argument dependent on a contradicted premise is ineligible for that use. Unverified arguments remain attributed hypotheses. They cannot corroborate an asserted fact, manufacture authority, or become realized outcomes because a model found their text. Apply restrictions in claim validation and evidence policy, not only badges or prompts. Context and counter citations cannot improve the authority, recency or corroboration of a supporting factual assertion. Issuer filings, corporate documents and hosted investor-relations material share one issuer identity. Unverified or partner provenance cannot establish editorial independence merely through a different hostname. Required targeted factual verification that is unavailable remains blocked or unknown.

### Compare proposed arguments with captured primary evidence

The 2026-10-20 extension accepts a bounded targeted comparison during preparation. Group the otherwise usable attributed arguments and forecasts from one captured source and compare their material premises with relevant primary passages already captured for the same dossier. Preserve current source decisions and authority classification. New manual content may use older captured primary context without reacquiring or requalifying those older sources. Do not add a human confirmation for every comparison or coverage need.

Keep raw qualification immutable and persist separate evidence-bound comparison results through the existing task-result and preparation owners. Outcomes are no conflict observed in compared passages, possible conflict, or inconclusive. Require exact comparable primary references for the first outcome without claiming factual truth or complete-document verification. Missing evidence or allowance cannot count as agreement. Possible issues remain model concerns, not proven errors.

Apply restrictions by exact capture, content hash and overlapping passage span across qualification retries. A later positive result cannot silently remove an earlier applicable issue. A missing, stale, inconclusive or conflicted check cannot authorize a new automatic attributed hypothesis. Independent useful contributions remain eligible under their own restrictions. Pin applicable results and history in the immutable proposal and approval fingerprint. Rejecting or losing a primary evidence pin removes its authorizing effect. Legacy journal sequences and readable historical pins remain compatible, while absent checks do not confer new attributed-use permission.

Use the same provider routes, shared 120-attempt dossier allowance, deadlines, validation, telemetry and execution fences. Do not add a general fact-checking engine or silently call a model when reading a page. The targeted comparison plan (historical checkpoint: `git show c4f0d24:docs/superpowers/plans/2026-10-20-targeted-source-comparison.md`) recorded the exact retrieval, persistence and verification contracts at that checkpoint. The original acceptance authorized bounded implementation under one worker's delegated scope. It does not resume the broader goal, activate runtime inference or authorize additional paid experiments.

### Application-controlled inexpensive model routing

Use DeepSeek V4 Flash 0731 first and MiMo V2.6 Flash as fallback, with provider/model identifiers confined to server configuration. Initial provider routes are `reka` and `deepinfra/fp8`. Revalidate capabilities and pricing before activation. Require structured output and supported parameters. Disable hidden model/provider fallback and SDK/workflow automatic model-action retries. Route ceilings are $0.15 per million input tokens and $0.60 per million output tokens.

Permit at most one primary attempt and one technical fallback per logical input. Valid uncertainty does not justify escalation. Missing configuration, cancellation, disabled paid work and account-wide billing failure do not trigger another model. MiMo remains the selected fallback unless the reproducible evaluation identifies a blocking transport or unsafe semantic failure. Do not add Jev or a more expensive model as a speculative gate.

### Bounded reading and durable execution

Retain the existing sixteen-MiB acquisition/normalized-artifact limit. Qualification inputs, including instructions, context and the serialized response schema, are bounded to 128 KiB, output to 6,144 tokens and each attempt to sixty seconds. Use two concurrent source operations and a persisted fifteen-minute preparation deadline. The initial preparation envelope is sixty candidates and 120 model attempts. Resume never resets the deadline or consumed attempts. A genuinely new manual source opens a separate fifteen-minute window for that new content only, including when the earlier window has expired. It does not reopen older documents, reset dossier-wide candidate or model-attempt limits, or authorize another automatic search series. Resuming that manual preparation retains its own deadline. If another dossier owns the execution slot, retain new links with an explicit continuation state. Group only those never-started new links in a bounded reading window when execution becomes available, without consuming their reading time while waiting.

Strip non-text payloads deterministically, retain reproducible passages and record omissions. An oversized input selects bounded passages using structure and research questions, never silently claiming full reading. Public PDFs use Exa text for this tranche, with locators in that exact representation. Do not invent page numbers. Page-aware Unstructured integration remains deferred.

Extend the existing Convex Workflow engine and preparation/rebuild owner. A legacy draft retains the main workflow handle waiting for corpus approval; its separate preparation handle belongs to the preparation operation. Any resume claims the visitor execution slot atomically. Authorize and check operation, generation, revision, source decision and paid-work controls before I/O and before persistence. Cancel both active handles where applicable. Reject late work and prevent subsequent paid calls.

### Preserve analyst experience and history

Preparation advances automatically for new runs. Existing drafts upgrade through their existing explicit refresh/rebuild interaction rather than paid work on page render. New manual sources enter the same bounded preparation. Preserve the existing summary, tabs, adjustment board, inspector, preview, public-HTTPS intake, URL behavior and grouped approval. No per-need human confirmation is introduced. Partial preparation remains reviewable with clear limitations.

## Superseded Clauses

- ADR-004: the absolute pre-approval document-retrieval prohibition. Acquisition and analytical extraction remain separate; rejected sources still cannot feed analytical outputs.
- ADR-008: the prohibition on retrieving eligible pending counter-evidence leads before a new corpus approval. Bounded preparation is permitted; approved-corpus immutability and analytical-use restrictions remain unchanged.
- ADR-009: source relevance only through metadata unless a later decision authorizes a typed task. This record authorizes `source_qualification`, not general live analytical generation.
- ADR-010: adds the concrete selected qualification routes and bounds while preserving application-controlled routing and retries.
- ADR-016: the blanket no-pre-approval-content premise. Expiring pre-launch receipts remain metadata-only; documentary capture belongs to dossier preparation after intake.
- ADR-017: metadata-only preparation and the rejected pre-approval-reading option. Proposal composition and analyst decisions retain their deterministic owners.
- ADR-018: metadata-only selection, prohibition of source-reading calls and the single forty-eight-candidate total. Preserve adaptive selection, history and a separate initial discovery ceiling.
- ADR-019: the premise that visual preview is the sole permitted pre-approval reading boundary. Its transient screenshot remains separate from captured text and analytical evidence.
- ADR-021: registry-only automatic role eligibility. Content can establish candidate-specific relevance; it cannot promote provenance authority or prove publisher independence.
- ADR-022: metadata-only linkage as the strongest non-structural basis. Add an anchored inspected-content basis without rewriting prior decisions.
- ADR-023: newly prepared proposals materialize captured content after approval instead of reacquiring it. Keep required accepted-decision authority, structural validation, cleanup and the honest unavailable live-claim boundary.

## Alternatives

Metadata-only preparation leaves observed content errors unresolved. Mandatory individual source certification increases analyst coordination. Excluding every imperfect article discards useful arguments. Treating every adverse argument as verified counter-evidence launders uncertainty into fact. Repeated searches until every warning disappears are unbounded. A second workflow engine or generic agent layer adds no required capability.

## Verification and Consequences

Use focused RED/GREEN tests at actual module boundaries, an additive schema, capture-aware cleanup, immutable evaluation records and explicit bounded live contracts. Verify fresh and legacy protected analyst journeys on desktop/mobile, including reconnection, accessibility and actual subscription updates. Preserve failed historical evidence. No recorded evaluation or passing component test substitutes for runtime acceptance. Default tests invoke no paid provider.

This decision authorizes preparation and constrained evidence use. General live claim generation, exhaustive fact checking, page-aware PDF parsing, production deployment and publication are separate work.

Cross-company experiments and their provisional model preferences do not automatically replace the configured routes in this decision. Exact-reference retrieval scores do not establish useful-evidence completeness; see the [2026-10-22 interpretation correction](../verification/2026-10-21-evidence-retrieval-repair.md#interpretation-correction-2026-10-22). The separate 600-character comparison explanation limit remains unchanged and its repair is deferred until the evidence-preservation investigation is addressed.

## Staged activation

The initial implementation is disabled unless SOURCE_QUALIFICATION_ENABLED is explicitly true in the runtime. New main workflows snapshot this setting into an optional prepareSources argument. Existing workflows without that argument retain their prior journal sequence and approval wait. Explicit review starts also reject while disabled. This gate permits additive installation and offline verification before model and protected-journey acceptance; it does not authorize changing the runtime setting before those gates pass.

## Retrieval amendment (2026-10-21)

[ADR-025](025-use-versioned-scoped-evidence-retrieval.md) adds versioned structured candidates, scoped native retrieval and a bounded optional embedding provider. It distinguishes whole-capture search candidates from the unchanged 512 approved-passage materialization ceiling, and introduces a cumulative conservative input-byte allowance for embeddings rather than a money settlement ledger. Historical preparation identities and human corpus approval remain unchanged. Local activation remains conditional on the recorded evaluation and verification gates.
