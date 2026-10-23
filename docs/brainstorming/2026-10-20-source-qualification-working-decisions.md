# Content-Based Source Qualification: Working Decisions

> **Historical record.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

## Status

Four product decisions were explicitly accepted on 2026-10-20 during brainstorming. This historical record preserves those decisions and their rationale. At that checkpoint, technical design and implementation authorization were incomplete. The subsequent [ADR-024](../decisions/024-qualify-source-content-before-corpus-approval.md) and implementation plan (historical checkpoint: `git show c4f0d24:docs/superpowers/plans/2026-10-20-preapproval-source-qualification.md`) recorded the subsequently accepted contract. The current requirements are consolidated in [PRODUCT.md](../../PRODUCT.md) and [context/TECH.md](../../context/TECH.md). See the [roadmap](../ROADMAP.md#current-delivery-state) for delivery evidence and remaining limits. This working record is not an acceptance report or a new authorization.

The observations below describe the application and contracts at the brainstorming checkpoint. Their later reconciliation is recorded in ADR-024 and the current product and technical contracts. Do not reinterpret historical findings or model results as current acceptance, and do not use this working record to bypass authorization checks.

## Destination

Prepare a justified source selection from inspected public documents, reduce routine analyst work, and preserve the analyst's authority over corpus approval and analytical conclusions.

The system should inspect existing alternatives before searching for more material. A useful source is not necessarily reliable for every assertion. Finding a passage proves that the captured document contains it, not that its assertion is true.

## Evidence Used

- [Analyst Experience Direction](../../AGENTS.md#analyst-experience-direction) requires proactive preparation, grouped review and attention to substantive decisions rather than coordination of internal steps.
- The [ServiceNow source audit](../../scripts/evaluations/source-selection/SOURCE-AUDIT.md) examines all 33 alternatives in dossier `k979t5nzs6bmkxbp7eref2bkzx8bag4f`. Useful adverse arguments were already present. The audit also records specific factual discrepancies, obsolete document destinations and deterministic selection defects. References to independent material in that historical audit do not establish editorial independence.
- The [comparison report](../../scripts/evaluations/source-selection/REPORT.md) and [investigator reference](../../scripts/evaluations/source-selection/REFERENCE.md) preserve 19 captured documents and 99 expected decisions. The reference was recorded before provider inference. DeepSeek and GLM matched all base decisions. The experiment is a purposive, single-company comparison against the investigating assistant's judgments, not independent human ground truth or production acceptance.
- [Source selection policy](../../convex/domain/sourceSelectionPolicy.ts) currently classifies candidates from metadata and registry rules, composes a proposal and computes coverage from eligible roles. Content qualification is not part of that path.
- [Evidence policy](../../convex/domain/evidencePolicy.ts) currently evaluates authority and corroboration across its source inputs without distinguishing contextual, supporting and opposing uses in those rules. Merely labelling a passage as context cannot enforce limited factual use.
- Oracle and architect completed read-only consultations against the repository and evaluation artifacts. Their recommendations informed this discussion, but the cited code and captured evidence remain the factual basis. Neither consultation implemented or tested the proposed protections.

## Accepted Product Decisions

### Inspect and qualify candidates before corpus approval

The platform may perform bounded retrieval and qualification of public candidate documents before the analyst approves the corpus. It prepares a proposal with reasons, useful passages and limitations.

Corpus approval remains mandatory before the selected sources may contribute to analytical claims and downstream artifacts. Preparation creates no analyst acceptance decision. Rejected and pending sources remain excluded from downstream analytical evidence.

The analyst receives a grouped proposal and can inspect, adjust or approve it. No additional human confirmation is required for each coverage need or internal preparation step.

### Retain useful contributions from imperfect documents with enforceable restrictions

A document containing a material error may still be recommended for passages whose useful argument does not depend on that error. Its origin and limitations remain visible. Inclusion cannot validate its unchecked facts or change its provenance authority.

For example, the source audit records a Capital Blueprint cRPO figure that differs from the official release. A separate argument about competition from bundled offerings may remain useful if it stands without that figure. The discrepant figure and conclusions dependent on it cannot serve as factual support. Confirming that EarningsMoat makes a zero-debt assertion does not establish that the company has no debt.

Apply the following treatment:

- Recommend identifiable useful contributions with their limits, subject to grouped corpus approval.
- Keep uncertain contributions as inspectable leads and seek better support within the bounded preparation work.
- Do not recommend arguments invalidated by their premises or contributions that add nothing to better-supported material. Preserve the source, decision history and explanation.

Further factual verification is targeted to assertions needed by the analysis rather than an exhaustive audit of every article. Lack of a detected contradiction does not establish truth. Contextual or opposing citations must not artificially strengthen factual authority or corroboration. These restrictions require application enforcement, not only model instructions or interface labels.

### Inspect existing candidates before one bounded search supplement

Examine existing candidates, including alternatives, before launching complementary discovery. The old recommendation rank cannot be the sole criterion for deciding which sources deserve inspection. Demonstrated duplicates and explicitly rejected sources do not trigger a new retrieval.

Reuse captured content and recorded qualification where their inputs and applicable versions are unchanged. Group relevant questions about the same document instead of repeatedly sending its content for separate coverage needs. Partial reading remains explicitly partial.

If a documentary need remains, allow one automatic supplement shared across the dossier:

- At most three complementary searches.
- At most four new candidates from each search.
- At most twelve additional candidates in total.

With the current 48-candidate initial scope, this permits up to 60 historical candidates. The supplement does not delete earlier candidates, rejected sources or analyst decisions to free capacity. It is not a target for the final recommended corpus.

After inspecting the supplement, present the proposal and its remaining limitations. Do not start another automatic search series merely to remove warnings. Stop earlier when the remaining needs have been addressed or further authorized work cannot resolve them.

These values are an accepted starting envelope, not a measured optimum. Document-size, page, inference-input, inference-attempt and retry limits still require a concrete technical contract. Search breadth alone does not bound all preparation work.

### Distinguish documentary availability from analytical validation

The pre-approval summary distinguishes three situations. These are accepted product meanings, not finalized schema values or interface copy.

| Situation | Meaning |
| --- | --- |
| Suitable documents available | Inspected content answers the documentary need with appropriate provenance and period. Individual assertions are not thereby validated. |
| Useful contributions with limitations | Relevant passages exist, but their use is constrained by age, insufficient provenance, partial reading or an identified factual problem. |
| Need not established | Preparation has not established usable coverage in the proposed corpus. Explain whether relevant material was not found, reading was unavailable, or candidates were excluded. |

An inaccessible or partly inspected document must not be described as proven irrelevant. A source intentionally excluded by the analyst must remain distinguishable from one never found. Effective inclusion and the immutable qualification basis must both remain inspectable.

For the audited ServiceNow dossier, the intended distinction is that historical terms were found while current official terms remain unestablished, and adverse arguments were located while some factual and provenance questions remain unresolved. Two distinct sites do not establish two independent confirmations.

The system may use its bounded supplement where further research can address these limitations, then present the corpus for approval without requiring an analyst confirmation per need.

## Alternatives Considered

| Approach | Disposition and rationale |
| --- | --- |
| Continue metadata-only preparation | Insufficient for the observed content and relevance errors. Deterministic metadata corrections remain necessary within the chosen direction. |
| Approve candidates before any content qualification | The user selected pre-approval preparation instead. Post-approval qualification alone leaves the initial selection unexamined and may require repeated corpus revisions. |
| Exclude every document containing a material error | The user selected constrained use instead. An unrelated error need not invalidate every argument, but dependence on a false premise does invalidate that argument. |
| Treat every useful risk article as verified counter-evidence | Incompatible with the accepted distinction between relevance, provenance and factual support. |
| Continue searching until every warning disappears | Incompatible with the accepted finite supplement and honest presentation of unresolved limits. |

## Preserved Boundaries

Preserve grouped corpus approval, individual append-only analyst decisions, rejected-source exclusion, immutable history and source-version provenance. Preserve the existing source-review layout, candidate inspection, adjustment and public-HTTPS intake affordances. This discussion does not authorize an unrelated UI redesign.

Convex remains the state owner and the existing workflow engine remains the orchestration authority. Extend the existing proposal and evidence-policy owners rather than introducing a parallel selection engine or a second persistence authority.

Resource controls remain proportional to the prototype under [ADR-006](../decisions/006-use-lightweight-prototype-usage-guards.md). The accepted envelope does not introduce a transactional dollar ledger or precise per-dossier billing enforcement.

## Subsequent Accepted Technical Decisions

The user accepted a separate fifteen-minute preparation window for genuinely new manual content, including links added after the original window has expired. This window applies only to the new content. Older sources are not reread, resuming an operation retains its deadline, and dossier-wide search, candidate and model-attempt limits remain unchanged. Adding a link does not authorize another automatic search series.

The user subsequently selected DeepSeek V4 Flash 0731 as the primary qualification model and MiMo V2.6 Flash as technical fallback, retaining MiMo unless evaluation finds a blocking problem. The user also selected Exa text for public-PDF qualification in this tranche, without invented page locators. ADR-024 and the implementation plan record the exact bounds and enforcement contract. The discussion below is retained as the earlier research posture, not the current routing decision.

## Earlier Recommendations

DeepSeek V4 Flash 0731 is the current starting candidate for grouped semantic qualification based on the recorded experiment. Its observed cost advantage depended on the provider route and caching. The comparison does not establish universal superiority, complete determinism or production routing acceptance.

There is no measured justification for placing Jev before every generative-model call. Jev and Microsoft remain possible candidates for narrower tasks. No new default model, fallback chain, confidence threshold or automatic escalation to a more expensive model was accepted in this discussion.

The existing retrieval and normalization primitives, proposal mechanism and evidence policy offer concrete reuse points. Pre-approval inspection needs its own valid authorization basis. It must not fabricate an accepted source decision or relax the downstream accepted-source fence.

## Open Design Questions

- Define the qualification task's exact inputs, grouped questions, output fields and passage references. Separate document purpose, asserted facts, attributed arguments and evidence of actual outcomes.
- Specify deterministic content cleanup, oversized-document handling and the boundary between sufficient positive evidence and insufficient evidence of absence. The failed oversized-input case has not been rerun after cleanup.
- Define how source and passage usage restrictions become enforceable claim-level rules, including factual attribution, dependent assertions and corroboration eligibility. The current policy does not provide this protection.
- Specify the evidence required to move each documentary role from limited to available, especially company linkage, current commercial terms, original reporting and publisher independence. Content relevance cannot alone confer provenance authority.
- Bind pre-approval artifacts and qualifications to exact content and policy versions, then reuse the inspected bytes after approval without weakening accepted-source validation or silently fetching a different document.
- Specify per-source and total qualification limits, retries, cancellation, partial failures and resume behavior within the accepted search envelope. Define how existing capped dossiers and explicit later recovery or URL additions interact with the supplement without silently resetting it.
- Complete the focused evaluation protocol for qualification and restricted use. Existing results do not establish cross-document factual verification, full-document retrieval recall or a calibrated confidence threshold. Additional evaluation is recommended in proportion to the specific uncertainty, not as a new blanket multi-dossier gate.

## Maturity and Next Step

The four product choices are accepted. The complete design maturity gate has not passed because the qualification contract, restriction enforcement and role-sufficiency rules remain open. This record does not promote those recommendations into accepted architecture.

Continue with the smallest qualification protocol that can explain why a candidate is useful, cite the inspected content, preserve uncertainty and constrain downstream use. Then document precise changes to the acquisition, selection, provider and evidence contracts, including the relevant clauses of ADR-004, ADR-009, ADR-010, ADR-018, ADR-021, ADR-022 and ADR-023. Implementation planning and production changes remain separate authorizations.

## Work Performed in This Brainstorming Continuation

Read repository contracts, source-selection and evidence-policy code, saved evaluation artifacts and the earlier workflow handoff. Received completed read-only oracle and architect reports. Recorded the four explicit user decisions. No new paid provider call, application change, schema change, dependency change, deployment or dossier mutation was performed.
