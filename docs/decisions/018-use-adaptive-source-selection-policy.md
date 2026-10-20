# ADR-018: Use an Adaptive Source Selection Policy

## Status

Accepted

## Date

2026-08-07

## Context

The source-selection policy introduced by ADR-017 reduced repetitive analyst review, but the live 110-candidate corpus exposed a structural reliability problem: discovery categories were treated as evidence classes, open web searches could return regulatory indexes and aggregators, publisher diversity could outrank primary authority, and the fixed default of twelve encouraged low-value filling. In the ServiceNow run `k979t5nzs6bmkxbp7eref2bkzx8bag4f`, this caused valid SEC filings and official sources to be deferred beside low-authority alternatives.

The prototype must correct the policy generally rather than special-case SEC or rewrite an approved corpus. It must remain metadata-only and introduce no additional model call or pre-approval content retrieval.

## Decision

Replace ADR-017's source-family ranking and fixed-target composition rules with `source-selection-v2`, a deterministic policy that classifies authority and document kind independently from discovery intent. Preserve ADR-017's immutable proposal records, append-only analyst decisions, grouped approval, reusable review UI, and durable human checkpoint.

Use a versioned publisher registry with dynamic primary authority for `sec.gov`, the confirmed company domain and its subdomains; qualified investor-relations hosts; institutional independent producers; qualified partners; unverified public publishers; and analyst-supplied sources. A publisher tier does not imply that every document on that host can satisfy every role: the policy must verify company identity and an authority-compatible document kind. Shared IR hosts require metadata that matches the selected company, independent publishers can satisfy only independent or news roles, partners remain partner evidence, and SEC archive identity must match the confirmed CIK. Registry changes require a fixture, a role justification, and a registry-version change.

Discover SEC filings directly and persist their form and accession number. Select the latest annual report, latest interim report, and up to three material-event filings before specialized ownership, registration, compensation, or financing forms. Remove the open regulatory web query. Constrain official web queries to confirmed company or investor-relations domains when available and retain open search only as an inspectable alternative pool.

Compose recommendations adaptively. First remove canonical and metadata-proven duplicates, using SEC accession identity where available, then preserve analyst-supplied sources, cover preset-specific document roles, and add only candidates that contribute a new document type, normalized annual or quarterly period, material event, independent producer, or research-angle match. Cap annual reports at two periods, interim reports at two periods, material-event filings at three, official families at four contributions, and independent producers at four or six for `independent_scrutiny`. Stop when no reliable contribution remains or at `SOURCE_RECOMMENDATION_CEILING`, which defaults to `ceil(SOURCE_CANDIDATE_LIMIT / 2)`. The ceiling is never a fill target.

Reserve `needs_attention` for real identity or provenance conflicts. Missing roles are explicit gaps and low-authority, Community, index, aggregator, duplicate, or low-information candidates become `alternative` without creating analyst work.

Treat v1 draft proposals as `outdated`, block their approval server-side, and expose an explicit `Rebuild proposal` action. The action atomically claims one durable rebuild lease keyed by run, revision, execution generation, expected proposal and policy before any I/O; an active lease prevents concurrent provider attempts. Each external request revalidates the current proposal and generation immediately before dispatch, uses an abortable ten-second timeout and at most two terminal attempts, and revalidates again before persistence. The action returns and persists `complete`, `partial` or `blocked`, identifies affected discovery families, creates a new immutable v2 proposal only when at least one discovery family completes, and preserves existing analyst decisions. A blocked lease becomes retryable after a short cooldown through a new fenced cycle under the same durable operation key, so late work from an earlier cycle cannot persist or complete the rebuild. Approved corpus revisions are never rebuilt.

## Consequences

- Recommendation count varies with reliable coverage and may be below the configured ceiling.
- Authority, document kind, coverage contribution, duplicate relationship, precise reason codes, registry version, and role gaps become durable proposal metadata through a widen-first schema change.
- Historical v1 proposals and their decisions remain readable; only active drafts require a deliberate rebuild.
- The policy is testable without provider calls against the frozen 110-candidate corpus and adversarial fixtures.
- Metadata-only classification still cannot prove source content quality; the UI continues to disclose that content has not been read.

## Supersession

This ADR supersedes only ADR-017's ranking, classification, fixed default target, and composition rules. ADR-017 remains authoritative for the human checkpoint, immutable proposal history, append-only analyst authority, grouped approval, and source-review interaction model.


## Amendment: actionable discovery recovery and current coverage, 2026-10-19

Draft source review distinguishes incomplete discovery from unconfirmed source requirements. The first offers an explicit retry of failed discovery families. Each unconfirmed requirement offers a bounded targeted metadata search and contextual inspection of existing candidates. The existing public-HTTPS intake dialog remains available from the proposal toolbar and inspector. Searches never retrieve document content before corpus approval.

Recovery extends the existing proposal-rebuild lease and persistence mechanism. A request binds the owner, run, execution generation, corpus revision, expected proposal, policy, request identifier, and target. Only one recovery may be active per draft revision. Terminal request replay never dispatches another external call. An expired in-progress request becomes unavailable when replayed; a new explicit request is needed to search again. Legacy outdated-policy rebuilds retain their existing retry-cycle contract. Approval, cancellation, generation changes, lease expiry, and superseding proposals fence both dispatch and persistence. Successful recovery creates an immutable proposal while retaining candidates and append-only analyst decisions. Refreshing recommendations alone preserves unresolved discovery warnings.

Coverage shown during review is derived from effective inclusion and immutable candidate eligibility, with the existing duplicate and independent-publisher rules. The stored proposal remains the historical system recommendation. Analyst-added links, discovery-metadata linkage, titles, and manual inclusion do not create automatic eligibility. Review explains that distinction and approval remains possible with limitations visible. Historical items without eligibility metadata remain unconfirmed. No new analyst coverage override is introduced.

Searches retain the configured candidate capacity, at most four web results per query, two total attempts, abortable ten-second transport deadlines, and the existing paid-work switch. Automatic retries apply only to transient transport or HTTP failures. Blocked explicit requests share the existing fifteen-second cooldown. Provider telemetry retains sanitized status codes and retryability without raw response bodies or credentials. Recovery start and completion emit persisted run events. Capacity, unavailable discovery, and no new candidates are explicit outcomes rather than empty successful coverage.
