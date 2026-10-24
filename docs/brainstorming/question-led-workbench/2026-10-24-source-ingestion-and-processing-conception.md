# Source Ingestion and Processing: Retained Conception

## Status and Responsibility

Recorded on 2026-10-24. This document details the source module within the [global question-led workbench conception](2026-10-23-question-led-workbench-conception.md). It preserves the accepted three-stage explanation and source-workflow decisions, with implementation details and unresolved policies identified separately. The global conception owns the shared company inventory, analytical validations, appraisals, grouped analyst adoption, and system brief.

This is a conception record under the [documentation policy](../../../AGENTS.md#document-authority-and-required-reading). It does not amend [the product contract](../../../PRODUCT.md), [the technical contract](../../../context/TECH.md), or [delivery state](../../ROADMAP.md), and does not authorize application changes, provider calls, or deployment. Current corpus-approval enforcement remains in force until its owning references are reconciled with the accepted launch-mandate direction.

## Purpose and Simple Workflow

Turn dispersed sources into structured, inspectable, reusable documentary material that can inform the shared company inventory and the framed questions.

```text
COLLECT SOURCES
      |
      v
READ AND CHECK THEIR CONTRIBUTION
      |
      v
ORGANIZE USABLE MATERIAL
```

These are the three principal stages for understanding the module. Acquisition, normalization, qualification, comparison, supplementation, selection, and recovery are internal work within them. The three stages do not prescribe three technical modules, wrappers, services, agents, or mandatory analyst screens.

## Interface and Place in the System

The module's interface should let the surrounding workflow request prepared material and understand its outcome without coordinating the internal operations. The source matrix is its inspection view, not a requirement that the analyst conduct preparation manually. No TypeScript signature, transport interface, or final result schema is selected here.

| Direction | Information crossing the interface |
| --- | --- |
| Input | Confirmed company, completed framing and questions, launch mandate, supplied public references, and existing material eligible for reuse. |
| Output | Prepared documentary material with exact provenance, available passages, qualified contributions, permitted uses, limitations, remaining gaps, and an explicit preparation outcome. |
| Progress and inspection | Actual advancement, inspectable source details and control results, and contextual requests when a material decision is necessary. |

Research starts after framing is complete. The module serves a shared company context and multiple questions, rather than creating a separate collection for every question. Its output can inform the company inventory, but documentary qualification alone does not admit an assertion as true. The [inventory and evidence conception](2026-10-23-question-led-workbench-conception.md#shared-company-inventory-and-evidence-matrix) owns that distinction and the subsequent assertion and question-link controls.

The inventory can also receive contributions through other mechanisms. This module does not monopolize enrichment or require a speculative integration framework. Any future mechanism must preserve the same meaning of provenance, controlled use, uncertainty, and recorded human judgment.

## Internal Work by Principal Stage

### Collect Sources

The system translates the completed framing into a bounded initial discovery plan: a shared documentary foundation plus searches targeted at the framed questions. Company context remains useful even when a contribution does not answer a particular question. The exact foundation, query templates, ranking criteria, and allowances remain to be specified.

- Integrate the initial availability check into the planned discovery. Absence of an initial filing, investor-relations address, or analyst reference does not itself trigger a justification request before those searches occur.
- Consider supplied public references and eligible existing material alongside newly found candidates. Reuse matching material rather than repeat completed work without reason.
- Preserve candidate identity, discovery context, publisher or company linkage, and relevant metadata. Detect straightforward duplicates without claiming that different URLs establish independence.
- Keep discovery outcomes distinct: a completed search with no result differs from an unavailable search. A candidate is not evidence of successful reading, useful content, or factual support.

The analyst can inspect discovery and add a reference, but is not asked to validate every query or coordinate collection.

### Read and Check Their Contribution

The system acquires and prepares bounded content, preserving the representation actually consulted, its provenance, and reproducible passage references. It qualifies what that material contributes and the limits of using it. Source text is untrusted material, not an instruction channel for execution.

- Preserve source and content identity, retrieval information, exact passages, and appropriate locators. Missing or corrupt retained content cannot be silently replaced by another version.
- Identify the company's relationship to the document, its purpose, relevant periods, positive documentary contributions, and restrictions. A partial reading cannot establish absence from the whole document.
- Distinguish source statements, attributed arguments, projections, uncertain material, and contextual content. Document kind, publisher confidence, and an exact quotation do not certify truth.
- Compare relevant contributions with other captured material where the comparison is meaningful. Preserve differences in period, scope, assumptions, possible conflicts, and inconclusive outcomes; restrictions on one contribution need not erase other useful contributions.
- Determine which important documentary gaps remain after examining material and existing alternatives. Perform one autonomous, targeted, bounded complement phase when useful and permitted. Newly found material passes through the same acquisition, qualification, and comparison work.

One complement phase can contain several authorized searches; it does not mean exactly one provider call. Exact counts, costs, time limits, and triggering criteria are not selected. The phase does not become repeated open-ended research until every gap disappears. Its conclusions concern the material actually examined.

Reading, qualification, and comparison advance autonomously. Their detailed results remain inspectable; a routine limitation is not automatically a request for analyst intervention.

### Organize Usable Material

The system consolidates the prepared material and selects sources under the [launch mandate](2026-10-23-question-led-workbench-conception.md#launch-mandate-and-contextual-intervention). Selection must be explainable and preserve the differences between inclusion, reading availability, documentary contribution, and permitted analytical use.

- Make source identity, prepared content, useful passages, contributions, selection reasons, comparison results, and limitations available together.
- Preserve relevant opposing material and remaining gaps rather than filling a source-count target or making the collection appear complete.
- Keep an unavailable reading or qualification visible. It does not prove irrelevance and cannot supply factual support merely because its source is included.
- Supply the exact prepared material to downstream work with the restrictions attached to its contributions. A new analytical interpretation still requires its own controls.
- Expose a meaningful preparation outcome, including partial or operationally blocked work. Completed work, unfinished work, and justified lack of documentary material remain distinct.

The module can finish its authorized preparation with disclosed gaps. Finishing the module does not mean that every research question has been investigated, that the inventory is exhaustive, or that the analyst has adopted an appraisal. The [global completion rule](2026-10-23-question-led-workbench-conception.md#appraisal-grouped-review-and-completion) governs dossier preparation.

## Autonomy, Inspection, and Intervention

All three principal stages are autonomous within the mandate. Optional inspection applies throughout: the analyst can examine sources, passages, contributions, restrictions, selection reasons, and actual progress without being required to open each detail page before work advances.

Routine recovery remains inside authorized limits and preserves completed readings and cumulative allowances. An unavailable source can lead to an eligible alternative, the bounded complement phase, or an explicit limitation. An integrity failure blocks the affected use; it is not waived by a human confirmation. Independent work can continue when it remains authorized and useful.

Important choices outside the mandate require contextual intervention, for example a material scope change or a request to exceed an allowance. These examples do not define the final exception policy. Operational unavailability must have an appropriate recovery path rather than asking the analyst to certify missing evidence or repair internal execution.

The target removes the routine human corpus-approval stop, not source checks or the analyst's ability to challenge a selection. Raw execution diagnostics remain internal; the analyst sees the consequence, relevant limitation, and useful next action.

## Architectural Rationale

This is a deep **module**: its **interface** is simpler than the internal work it owns. Its **depth** comes from concentrating discovery, reading, qualification, comparison, bounded recovery, and preparation consistency behind a coherent outcome. Information hiding conceals execution mechanics from ordinary use while keeping evidence and failures inspectable.

**Locality** means each shared rule has one owner rather than being copied into the matrix, the progress view, and every question investigation. The **leverage** comes from preparing material once and making it useful across questions and the company inventory; a larger number of modules is not a success measure.

The handoff of prepared material is a **seam** between source processing and analytical use. It must carry provenance, restrictions, and uncertainty so downstream work cannot promote a selected document into a verified assertion by implication. Its exact implementation remains open. An **adapter** is justified by a real integration need, such as the existing SEC and web-retrieval paths, rather than a hypothetical future enrichment mechanism.

Apply the **deletion test** before introducing an intermediate layer: determine whether it concentrates meaningful complexity or merely forwards operations elsewhere. The three principal stages explain the work; they do not justify three shallow wrappers whose caller must still orchestrate capture, retries, comparison, and selection.

The **interface is the test surface**. Future verification should exercise preparation through its real owner and inspect the resulting material, restrictions, outcomes, and preserved progress. Isolated helper tests alone cannot prove that the module delivers a usable result. No new workflow engine, persistence authority, model-per-question arrangement, or generic plugin framework is selected.

## System Effects and Verification Direction

The module's success is useful retained material for the inventory and questions, with bounded use of analyst attention and execution resources. Source counts, accepted rows, model-schema validity, and terminal execution states are incomplete proxies. The [working system brief](2026-10-23-question-led-workbench-conception.md#working-system-brief) records the wider classification, players, stocks, flows, feedback loops, and proposed smallest experiment.

An apparent local improvement can harm the whole system: collecting more material can increase qualification work and exceptions; suppressing exceptions can make appraisals appear more certain; later enrichment can leave a previously retained interpretation stale. Shared provenance, meaningful restrictions, a bounded complement phase, and version-aware human decisions are intended responses, not measured guarantees of usefulness.

Before implementation, inspect the existing owners rather than introducing parallel implementations: [the preparation workflow](../../../convex/sourcePreparationWorkflow.ts), [preparation policy and progression](../../../convex/sourcePreparation.ts), [source captures](../../../convex/sourceCaptures.ts), [passages and exact quotation reproduction](../../../convex/domain/sourcePassages.ts), [source selection](../../../convex/domain/sourceSelectionPolicy.ts), and [source-use restrictions](../../../convex/domain/sourceUsage.ts). Their current contracts are not automatically compatible with the target's delegated source admission.

Proposed verification, not performed by this record: exercise a bounded prepared set containing a useful source, a partial reading, opposing material, and a failed acquisition. Verify exact references, explicit limitations, reuse of completed work, and continuation of independent work. Evaluate usefulness separately by examining whether the output helps prepare the framed appraisals without forcing the analyst to coordinate research. Existing fixtures or passing schema checks alone do not establish that outcome.

## Open Decisions

- Define the documentary foundation, query planning and selection criteria, and the mandate's resource and intervention limits.
- Specify source-module outcomes and executable completion checks, especially interrupted reading, partial availability, exhausted allowances, and missing technical capability.
- Define the exact handoff to the shared inventory, including contribution identity, changing source versions, restrictions, and freshness. Other enrichment mechanisms remain possible but undesigned.
- Decide detailed source-matrix composition and its relationship to the central timeline, floating card, dedicated inspection page, and contextual requests.
- Reconcile the product and technical contracts, existing approval-based authority, data, fixtures, and historical decisions before implementation. This record supplies no migration or runtime authorization.
