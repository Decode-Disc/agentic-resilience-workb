# Question-Led Analysis Workbench: Retained Conception

## Status

Recorded on 2026-10-23, with functional revisions through 2026-10-26. This document preserves the accepted design rationale for the product direction, shared inventory and operations, agent missions, grouped review and synthesis.

Status reviewed on 2026-10-30: the shared runtime, continuation, compaction and bounded inspection mission are implemented and [locally verified](../../verification/2026-10-30-pi-durable-replacement.md). Workbench/START and the Sources, Investigation and Synthesis business bindings remain undelivered; live model judgment and summary fidelity are not certified. [PRODUCT.md](../../../PRODUCT.md) owns current behavior, [TECH](../../../context/TECH.md) owns enforcement and [the roadmap](../../ROADMAP.md) owns delivery state.

Supersession note, 2026-11-01: START and Workbench now bind persistent framing, explicit launch, conversational controls and the installed documentary workflow. The configured Workbench model remains inactive pending separate qualification; the three research agents remain pending. Current scope and delivery belong to [TECH](../../../context/TECH.md#implementation-transition) and the [roadmap](../../ROADMAP.md#phase-6--framing-and-controlled-transition).

Design arbitration recorded on 2026-10-30: [ADR-026](../../decisions/026-use-typed-analytical-controls-and-materialized-question-outcomes.md) selects typed semantic findings under deterministic disposition and a materialized question-outcome projection. Justified insufficiency completes question preparation without becoming an answer or retained appraisal. The current obligations live in [PRODUCT](../../../PRODUCT.md#evidence-matrix-and-analytical-review) and [TECH](../../../context/TECH.md#analytical-control-and-question-outcome-contracts); this historical conception preserves the rationale only.

Sources supersession note, 2026-11-02: the [accepted Sources refinement](2026-10-24-source-ingestion-and-processing-conception.md#accepted-sources-refinement-of-2026-11-02) resolves qualification storage, shared need tracking, partial progression, retention without a second shortlist and targeted discovery. The eleven-entry catalogue and open questions below preserve the earlier conception; the additional Sources discovery family and current execution rules belong to [TECH](../../../context/TECH.md#sources-mission-and-prepared-material), with product behavior in [PRODUCT](../../../PRODUCT.md#source-preparation-and-corpus-review). Implementation and live-quality acceptance remain pending.

Implementation supersession, 2026-11-03: the default-disabled Sources backend now binds the shared executor, documentary needs, controlled qualifications and partial material handoff. Investigation-driven complement initiation and live documentary-quality acceptance remain pending. [TECH](../../../context/TECH.md#sources-mission-and-prepared-material) owns the implemented contract and [the roadmap](../../ROADMAP.md#phase-7--shared-execution-and-sources) owns verification and remaining delivery. Earlier status statements below retain their dated scope.

The following sections record the overall workflow, cooperation, shared inventory and analyst-judgment decisions. The [Sources](2026-10-24-source-ingestion-and-processing-conception.md), [Investigation](2026-10-24-investigation-conception.md) and [Synthesis](2026-10-25-synthesis-conception.md) conceptions preserve their business rationale; the [execution conception](2026-10-26-agentic-execution-architecture.md) preserves the dated technical decisions and their supersession.

## Purpose

The prototype supports an unsolicited application to join Decoding Discontinuity. Its first design criterion is usefulness to Raphaëlle d'Ornano and alignment with Decoding Discontinuity's research questions. Recognition of the author's abilities should follow from that usefulness, rather than determine the product's organization.

The retained destination is an analysis dossier that examines a precise economic question, confronts the evidence and interpretations that illuminate it, and identifies what deserves further investigation. The analyst supplies an intention; the system takes responsibility for the preparatory research and proposes reasoned appraisals. The experience should make the analyst's attention available for judgment without requiring them to coordinate collection, reading, or successive internal operations. Public-source provenance, uncertainty, counter-evidence, and final analyst authority remain essential. This is not a reproduction of a proprietary methodology.

## Accepted Scope

The dossier first situates the company, then investigates an activity or workflow relevant to its economic position. The reason for choosing that scope is qualitative and grounded in available sources. The prototype does not systematically measure the activity's share of company economics. Findings remain attached to the investigated scope rather than automatically extending to the whole company. The existing US-listed technology-company scope is retained.

The accepted reference example is the existing CCC Intelligent Solutions case: within a photo-led auto physical damage workflow, investigate whether CCC controls a difficult-to-substitute coordination point or supplies modules under carrier or core-platform authority. This is a question to investigate, not a conclusion about CCC. The [existing research boundary](../../../PRODUCT.md#evidence-on-hand) remains the reference for the case.

The analytical structure combines a common research foundation with the decisive questions specific to the case. A fixed ten-dimension grid is not the retained target. Its useful questions may inform the new foundation, whose exact content remains to be defined.

## Three Principal Capabilities

| Capability | Work prepared for the analyst |
| --- | --- |
| Understand where value resides | Situate the business and the selected activity, identify participants and dependencies, and distinguish what the company supplies, recommends, executes, or controls. |
| Examine resilience to the agentic transition | Investigate what agents could strengthen, weaken, bypass, or redistribute. Confront interpretations with technical, commercial, and financial evidence, their assumptions, and their limitations. |
| Prepare an actionable assessment | Propose a reasoned appraisal for the decisive questions, expose its evidence and objections, and identify unknowns that could change the assessment or justify further research. |

Question framing, source preparation, comparison, classification, and decision history support these capabilities. They are not separate headline capabilities merely because they are distinct implementation steps. These are target capabilities, not claims that the current prototype already delivers them completely.

## Proactive Workflow and Analyst Role

The retained direction delegates preparation to the system. The analyst can orient, inspect, and challenge the work without having to manage each research operation. The following schematic records the high-level sequence. Preparation completion and analyst adoption are distinct, as defined below.

```text
START
Choose the company and optionally a research angle
Launch with a research mandate
                         |
                         v
FRAMING
The system proposes the scope and research questions
The analyst may refine the proposal
Start research fixes the framing and starts Sources
                         |
                         v
AUTONOMOUS PREPARATION AND INVESTIGATION
Prepare sources, read and confront useful material
Investigate the framed questions
Prepare reasoned appraisals and expose limitations
                         |
                         v
GROUPED REVIEW AT INVESTIGATION OUTPUT
The analyst reviews the proposed appraisals
Retain reviewed appraisals, correct or leave for follow-up
At least one retained appraisal is required for Synthesis
                         |
                         v
AUTONOMOUS SYNTHESIS
Examine connections across retained appraisals
Prepare the diagram and note when mechanisms are supported
Otherwise prepare a reasoned non-establishment finding
                         |
                         v
RESULT AVAILABLE
Inspect the justified synthesis or reasoned non-establishment finding
Challenge or follow up when useful
```

Interventions can occur contextually throughout the workflow rather than becoming a succession of analyst-managed stages. Work that does not depend on the requested decision should remain able to advance within the mandate. The precise exception policy is still open.

### Research Starts After Framing

The user selected waiting until framing is complete before starting source preparation or question investigations. This keeps the prototype sequence simpler and avoids research performed against a scope that is still being established. Common questions remain part of the analytical foundation; they do not launch background investigations while the analyst is refining the case-specific questions.

The system proposes a usable framing rather than requiring the analyst to write the research plan. Refinements are optional. The analyst's explicit **Start research** action fixes the scope and questions, completes framing, and starts Sources under the launch mandate. Keeping the proposal unchanged still uses this action. Later scope changes and their effect on ongoing work remain to be specified.

### Launch Mandate and Contextual Intervention

The user selected a mandate at launch: the system selects sources under explicit rules, advances autonomously, and requests analyst intervention for important exceptions. Results remain proposals until human judgment. In this target conception, routine source selection does not require a separate human corpus approval before analytical work. This replaces the earlier proposed systematic approval stop in the intended workflow.

Delegated source selection must remain explainable and traceable. Retaining a source does not establish that its assertions are true or that the analyst has endorsed an interpretation. The source-selection rules, permitted work and resource limits, and exceptions requiring intervention are not yet defined.

The discussed intervention principle is to distinguish a local limitation from a material decision the system has no mandate to make. An inaccessible source can lead to another source or a disclosed limitation; conflicting material can become an objection; insufficient evidence can remain an explicit unknown. These are examples for defining the policy, not approved automatic exception thresholds. Autonomy does not imply unbounded searching or concealing failure.

### Allocation of Work

An autonomous operation can also have optional detailed inspection. Optional inspection is not another approval checkpoint. The following allocation distinguishes system preparation from analyst judgment.

| Work | Retained responsibility |
| --- | --- |
| Source ingestion and processing | Sources autonomously plans discovery, checks availability, reads, qualifies, compares, and selects documentary material for the requested needs. |
| Enriching the shared company inventory | Investigation reuses and enriches the inventory during a common inquiry into the framed questions. Other enrichment mechanisms remain possible. |
| Checking assertions and their question links | Investigation applies the shared mandatory controls to its contributions and intended uses. Important unresolved exceptions can require human intervention; routine human confirmation of every assertion and link is not required before preparing appraisals. |
| Examining interpretations and preparing appraisals | Investigation confronts the evidence and counter-evidence, identifies decisive gaps across questions, and prepares distinct appraisals. Sources executes the grouped documentary complement when needed, as described below. |
| Preparing the mechanism diagram and reasoned note | Synthesis advances autonomously after grouped appraisal review. The economic mechanism diagram is the reference result; the note develops its argumentation. Both preserve evidence dependencies and limitations. |
| Retaining analytical judgments | Explicit grouped analyst review at Investigation output, with correction or follow-up possible per question. Synthesis has no routine final approval checkpoint. |
| Routine recovery | Autonomous within the mandate and resource allowances. Changing scope or exceeding the mandate requires a decision; technical unavailability remains distinct from evidence insufficiency. |

The old fixed ten-dimension questionnaire and scoring sequence are not the target. Neither is a requirement to finish an exhaustive company inventory before appraisals can be prepared. These changes remove inherited progression requirements, not evidence controls.

## Workspace Experience

The retained interaction direction is described below; detailed layout remains open.

- After launch, the composer becomes smaller and floats at the bottom center, remaining available for orientation and follow-up.
- The central component presents progress and a timeline of meaningful stages. Requests for approval or intervention appear in their relevant context.
- Floating cards around the edges or corners preview the workflow's work units. They are inactive before their work starts, activate with animation when it actually starts, and provide access to dedicated detail pages. The overall view should remain calm rather than accumulate competing process displays.
- Detailed research is available when the analyst chooses to inspect it. Routine progress should not require opening those pages.
- The selected [shadcn Questionnaire](https://ui.shadcn.com/docs/components/base/questionnaire) collects framing choices and contextual answers. It supports the analyst in refining a proposed scope or priority; the system remains responsible for investigating the economic questions. The component does not determine persistence, branching, or workflow authority.

Exact card count, grouping, responsive placement, animation behavior, and the relationship between the timeline and completed results remain to be designed. A visible activation must reflect actual execution rather than illustrative activity.

## Reusable Workflow Responsibilities

Sources, Investigation, and Synthesis have dedicated functional conceptions. Investigation and Synthesis each use a specialized mission agent within the system's execution frame. As of 2026-10-30, the [shared runtime is delivered](../../../context/TECH.md#shared-execution-structure); their business-operation bindings, artifact contracts, model routes, semantic evaluation and card presentation remain to be completed.

| Proposed responsibility | Output |
| --- | --- |
| Source ingestion and processing | Shared documentary material with qualification, provenance, and limitations; see its dedicated conception. |
| Investigation | Controlled contributions to the shared inventory, grouped documentary needs, and distinct reasoned appraisals from a common inquiry into the dossier. |
| Synthesis | A reference mechanism diagram with its fully reasoned note, or a reasoned non-establishment finding under the synthesis outcome rules below. |

A workflow capability, an execution of that capability, and its visible card are distinct concepts. The source matrix is a detailed view of source preparation; a research question is not another independent source-collection module. Investigation works across the framed questions with shared material and a common company inventory, then prepares separate appraisals without duplicating the same assertion for each one.

```text
Framing fixed by Start research
        |
        v
Sources: initial documentary preparation
        |
        v
Investigation: common inquiry <----> Shared company inventory
        |                                    ^
        | Grouped needs, if useful            | Other enrichment
        v                                    | mechanisms, undefined
Sources: bounded targeted complement
        |
        v
Investigation: re-examine and propose appraisals by question
        |
        v
Grouped analyst review at Investigation output
Retained appraisals required to continue
        |
        v
Synthesis: diagram and note, or reasoned non-establishment
        |
        v
Result available, with optional inspection and challenge
```

One source can inform several questions through the relevant passages. Reusing it must preserve its identity, permitted uses, and limitations. Whether cards represent responsibilities, individual investigations, or grouped work remains open; a growing question count should not automatically produce a separate floating source matrix for every question.

### Agent Missions Within the System Frame

Sources delegates documentary inquiry across the available corpus to its specialized agent within system-organized preparation. Each Investigation or Synthesis mission starts with its specialized agent in control of the analytical approach. Their [shared execution contract](2026-10-26-agentic-execution-architecture.md#shared-mission-contract) governs the mission frame and controlled progress. The principal stages explain the work; internal documentary or analytical steps may be revisited as needed.

Executable constraints govern authority, resources, provenance, and transitions. They do not require every possible contradiction or analytical path to be enumerated in advance. The agent's reasoning remains a proposal subject to the applicable controls. Routine work advances autonomously; the shared intervention policy governs important exceptions.

### Shared Business Operations and Agent Tools

A business operation owns its domain input contract, controls, version handling, persistence, and meaningful outcome. Authorized system code calls that operation directly. An agent tool supplies a description, an input schema derived from the same contract, and an execution binding to the operation. Mission authority and dossier context come from the system. Domain rules remain in the shared operation rather than being reimplemented in the agent binding.

```text
Authorized system call -----------------------+
                                              |
Agent --> Tool description, schema, binding ---+--> Shared business operation
                                                       |
                                                       v
                                               Controls and execution
                                               Result, scope and limits
```

Operations can encapsulate substantial processing, including bounded model-assisted work when their task requires it. Each returns the useful result, what was examined, applicable control outcomes, and limitations or failure information. This lets an agent reconsider the next action without treating every local restriction as a dossier-wide stop. The functional catalogue and control responsibilities record the retained conception; operation names, input examples, and result formats remain revisable during implementation rather than freezing SDK interfaces.

### Transversal Operation Catalogue

The single catalogue below groups eleven functional entries across Sources, Investigation, and Synthesis. Domain responsibility identifies the business knowledge an operation owns; agent exposure identifies which mission agents can use it. Every operation remains callable by authorized system code. Exposure to one agent does not make the implementation private to that agent.

| Business operation | Domain responsibility | Agent exposure | Useful result |
| --- | --- | --- | --- |
| Consult mission state | Dossier and preparation | Sources, Investigation, Synthesis | Bounded scope, questions, relevant inventory and appraisal references, versions, progress, available material, pending work, and restrictions. |
| Search available material | Documentary material | Sources, Investigation, Synthesis | Candidate passages with excerpts, reproducible references, and search limitations. A match alone does not establish analytical support. |
| Read in context | Documentary material | Sources, Investigation, Synthesis | Exact retained passages, surrounding context, observed links, and applicable documentary qualifications or restrictions. |
| Make a source consultable | Sources | Sources | Acquired or reused content with its own capture and provenance, available for search and reading. |
| Submit a documentary qualification | Sources | Sources | Controlled contributions and restrictions for one document, preserving useful material and returning targeted diagnostics. |
| Request a targeted documentary check | Sources | Sources | Examination of a referenced statement, including before qualification, with its conclusion, evidence, scope, and limitations. |
| Contribute to the inventory | Shared inventory | Investigation | Controlled assertions, corrections, and question-specific uses with reusable references and preserved history. |
| Request a documentary complement | Workflow | Investigation | Grouped decisive needs transmitted to Sources under the permitted phase and mandate. |
| Submit appraisals | Investigation | Investigation | Controlled reasoned responses by question, proposed for grouped analyst review. |
| Request analytical re-examination | Workflow | Synthesis | A concern about an appraisal or a necessary new premise transmitted to Investigation for targeted examination of available material. |
| Submit synthesis | Synthesis | Synthesis | The reference mechanism diagram and reasoned note controlled together, or the justified non-establishment finding. |

The first three entries are shared access families, not a requirement for a generic all-purpose API. Sources consults its documentary preparation; Investigation and Synthesis consult the analytical dossier. Search and reading respect each mission's accessible material and usage restrictions. Consultation assembles stored state, search receives an explicit query, and reading returns exact content; these intents do not require a generative intermediary. Lexical or hybrid retrieval remains an implementation choice, with any embedding work identified separately.

The applicable criteria belong to the [Sources conception](2026-10-24-source-ingestion-and-processing-conception.md#documentary-controls), [shared inventory rules](#shared-company-inventory-and-evidence-matrix), [appraisal controls](2026-10-24-investigation-conception.md#appraisal-submission-controls), and [Synthesis conception](2026-10-25-synthesis-conception.md#submission-controls). Request transmission checks authority, phase, scope, and versions without requiring another model merely to authorize a handoff. Useful context is supplied compactly at launch and after operations; consulting state is not a mandatory extra step after every action. Mission completion uses the response contract below rather than an additional coordination tool.

### Cooperation and Documentary Complement

Sources first prepares a shared documentary foundation with research targeted at the framed questions, under a bounded initial plan. Investigation then conducts a common inquiry: it exploits the prepared material and inventory, enriches the inventory with controlled assertions, and tests the interpretations across questions. This shares evidence and documentary needs across questions rather than launching independent inquiries with separate inventories for each one.

After this first analytical pass, Investigation identifies which missing information could materially change an appraisal, taking account of the documentary gaps reported by Sources. It groups overlapping needs into a targeted request. Sources handles the resulting discovery, reading, qualification, comparison, and selection; Investigation uses the returned material to re-examine its reasoning. Sources does not consume an earlier complement solely to complete documentary roles before Investigation has identified the decisive needs.

The prototype allows one autonomous, grouped, bounded complement phase when useful. It may contain several searches or retrievals, rather than exactly one provider call. If no useful request is identified, Investigation proceeds directly to its appraisals. Remaining gaps are disclosed after the phase; they do not automatically initiate another search cycle. Exact prioritization criteria, counts, costs, time limits, and intervention thresholds remain open. This sequence does not require the analyst to coordinate the handoffs.

### Synthesis and Bounded Analytical Rework

After grouped appraisal review, Synthesis connects the retained appraisals and their evidence into an interpretation of the investigated scope. It may propose transversal inferences rather than only condense existing text. The economic mechanism diagram is the reference result, anchored in the actors and workflow; the derived note develops the same interpretation with its reasoning, evidence, objections, and unknowns. The selected direction emphasizes mechanisms of control, dependency, value capture, and possible agentic change. Visual composition and immediate comprehensibility remain to be tested.

Synthesis verifies existing evidence and handles connections or tensions that can be explained from the retained analytical base. When it discovers in the available material an uninstructed new premise necessary to its interpretation, it sends Investigation a targeted request identifying the passage, proposed premise, and affected question or mechanism. This uses the existing analytical re-examination operation. Investigation examines the evidence, submits an inventory contribution when justified, and assesses the effect on the appraisals. Synthesis does not directly admit the new premise into the inventory.

The same operation handles a concern requiring an existing appraisal to be re-examined. Investigation returns a proposed revision or a justification for maintaining the appraisal, tied to the examined basis. Synthesis then revisits its affected reasoning and outputs. Verification of evidence already used and explanation of relationships between retained appraisals remain within Synthesis.

This analytical return is autonomous and bounded, uses the material already available, and does not launch another documentary research phase. Remaining limitations are exposed rather than initiating an open-ended loop. Exact triggering criteria, limits, and stopping rules remain to be specified. Material revisions to retained judgments follow the review and version rules below.

## Shared Company Inventory and Evidence Matrix

The retained conception preserves a general company inventory, including useful company context and sourced assertions shared across questions. The system can enrich it from the work performed; other enrichment mechanisms remain to be selected. The inventory need not be exhaustive before a useful appraisal can be proposed.

Sources supplies qualified documentary material. Investigation transforms relevant material into controlled assertions and enriches the inventory during the inquiry through the shared inventory-contribution operation. That operation belongs to the inventory domain and applies the same admission rules for every authorized caller; it is not owned by the Investigation agent. Finding, reading, selecting, and quoting a source do not themselves establish an assertion's truth. A common assertion can serve several questions while each use retains its own scope, rationale, and supporting, opposing, or contextual relationship.

New assertions and question-specific uses receive their semantic admission control when contributed to the inventory, before becoming usable in that scope. The control does not wait for appraisal submission. The inventory domain applies the same criteria to every authorized contributor:

| Admission criterion | Required justification |
| --- | --- |
| Evidence and permitted use | The assertion follows from its referenced basis and respects documentary restrictions, reusing applicable Sources controls rather than qualifying the documents again. |
| Nature and scope | Its nature as a fact, inference, hypothesis, or unknown matches the available support; its company, activity, and temporal scope remain explicit. |
| Question-specific rationale | Each use explains why the assertion supports, opposes, or provides context for an interpretation, without duplicating the shared assertion. |

A hypothesis or unknown can be admitted as such; admission does not turn it into an established fact. Useful company context does not require a forced question link. The shared execution conception defines [reuse of controlled results](2026-10-26-agentic-execution-architecture.md#reuse-of-controlled-results).

The evidence matrix makes this inventory and its uses inspectable. The analyst can connect a research question to the relevant assertions, passages, objections, unknowns, control results, and corrections. It need not occupy the main progress view or require supervision of every operation. The distinctions between `Fact`, `Inference`, `Hypothesis`, and `Unknown` remain useful.

Three meanings of validation must remain separate: documentary integrity checks, checks on the permitted use and reasoning of an assertion and its links, and human adoption of an analytical interpretation. System controls remain mandatory. A failed integrity check cannot be waived by a human approval. An unresolved analytical limitation must produce an explicit restriction, uncertainty, exclusion from the affected use, or important exception; it cannot silently become a successful validation.

Appraisal submission controls the reasoning from inventory assertions to a question-level interpretation, rather than repeating documentary preparation. Synthesis submission controls its new relationships and transversal inferences together with diagram-to-note fidelity. A retained appraisal is an input to that reasoning, not automatic validation of every inference drawn from it. Synthesis retains traceable dependencies on the appraisals and evidence it uses.

What is removed from the target is systematic human confirmation of each assertion and link before appraisals can be prepared. Inspection, correction, and important human interventions remain available. The shared inventory and its controls are retained, rather than replaced by repeated independent arguments embedded in each appraisal. Exact persistence, correction propagation, and revision granularity are still to be designed; no complete incremental dependency engine is selected.

## Appraisal, Grouped Review, and Completion

The accepted assessment format is a reasoned appraisal for each decisive question. Grouped analyst review takes place at Investigation output, followed by autonomous Synthesis of the investigated scope. The interpretation, its support, objections, and unknowns should be visible together. Confidence is explained through the evidence and its limitations. An explicit horizon is relevant when an interpretation concerns future change; no replacement categorical confidence scale or fixed horizon was selected.

The following wireframe records the selected information organization. All example statements are fictional and illustrate the presentation only; they are not findings about CCC. Its per-question controls are illustrative; grouped review is the retained adoption mechanism, not a requirement to approve each question through this layout.

```text
┌──────────────────────────────────────────────────────┐
│ CCC · Auto physical damage workflow                  │
│ Proposed appraisal · For analyst review              │
├──────────────────────────────────────────────────────┤
│ RESEARCH QUESTION                                    │
│ Does CCC control coordination, or supply             │
│ substitutable modules?                               │
├──────────────────────────────────────────────────────┤
│ PROVISIONAL APPRAISAL                                │
│ The reviewed material suggests a coordination role.  │
│ Effective decision control remains unestablished.    │
│                                                      │
│ Confidence limited by undocumented decision rights.  │
├──────────────────────────────────────────────────────┤
│ EVIDENCE SUPPORTING THIS INTERPRETATION              │
│ • Passages about coordination between participants   │
│   [View passages]                                    │
│                                                      │
│ OBJECTIONS AND COUNTER-EVIDENCE                      │
│ • Passages about decisions retained by other actors  │
│   [View passages]                                    │
│                                                      │
│ DECISIVE UNKNOWN                                     │
│ Who can change routing and decision rules?           │
├──────────────────────────────────────────────────────┤
│ [Open evidence]       [Revise]       [Approve]       │
└──────────────────────────────────────────────────────┘
```

The system prepares the appraisals, then offers their grouped review at Investigation output. The analyst can retain the reviewed appraisals in one action, correct an appraisal, or leave a question for follow-up. The action must make its included appraisals identifiable and cannot imply that unreviewed proposals were retained. Synthesis uses the retained appraisals as its analytical base and keeps the effect of open or deferred questions visible in its scope and limitations.

If no appraisal is retained, Synthesis does not start. The dossier remains at appraisal review with an explicit explanation and a way to resume reviewing the appraisals. An absent retained base does not establish documentary insufficiency.

A supported synthesis makes its mechanism diagram and reasoned note available without another routine approval step, subject to the outcome and pending-revision rules below. They remain a proposed interpretation based on reviewed appraisals; generation does not imply human adoption of the synthesis. The analyst can inspect or challenge the result without having to repeat the appraisal review to reach it.

### Mission Completion Contract

The agent proposes that its mission is complete by returning the references of the expected artifacts and explicit remaining limitations. The system verifies the artifact set, relevant versions, references, and applicable control outcomes before advancing the workflow. A failed condition returns an actionable result for further work within the mandate or an explicit incomplete outcome. The agent's completion declaration alone cannot authorize the transition.

Completion uses the artifact-specific controls in the three mission conceptions. A justified insufficiency can be an analytical result. Conditional documentary or re-examination requests are retained with their justification and outcome when used, rather than required for every mission.

The system retains an explicit outcome for each need assigned to the mission and each documentary or analytical check engaged:

| Expected work | Required account of its outcome |
| --- | --- |
| Documentary need assigned to Sources | Prepared material, a justified documentary gap, or explicitly unfinished preparation. |
| Framed question assigned to Investigation | A reasoned appraisal or justified insufficiency after investigation. |
| Engaged control | A conclusion with evidence and limitations, or an explicitly unfinished check. |
| Expected Synthesis result | The joint diagram and note, a justified non-establishment finding, or an identified pending or incomplete outcome. |

Finding a passage does not complete a check of the statement it addresses. A required unfinished control prevents the use it conditions, while independent usable work can continue. The system maintains this account through operation outcomes rather than asking the analyst to coordinate it. Tracking assigned and engaged work does not guarantee detection of every omission never identified during inquiry, nor require qualification of every candidate or traversal of every observed link. Exact records and executable completion checks remain implementation work.

Investigation may finish preparing its appraisals when the framed questions have been investigated, including a question that ends in explicitly justified evidence insufficiency. Synthesis preserves those limitations when preparing its outputs after review. A result becoming available means the relevant preparatory work is complete, not that every question is resolved or the analyst has adopted the overall interpretation. Interrupted or unperformed work remains incomplete; missing technical capability cannot be relabelled as an evidence-based unknown. The former finalization requirement of ten dimension decisions is not retained.

### Synthesis Outcomes

When the instructed and retained appraisals support a coherent economic interpretation, Synthesis submits the reference mechanism diagram and its reasoned note together. Their scope may be limited under the pending-revision rule below.

When those appraisals permit no sufficiently supported mechanism, Synthesis returns the [reasoned non-establishment finding](2026-10-25-synthesis-conception.md#interface) through the same submission operation. This is a justified analytical outcome under the completion contract, without forcing a mechanism diagram. It does not trigger another documentary research phase. Its basis is distinct from an absent human review or a technically incomplete mission.

### Retained Judgments and Pending Revisions

A later adverse control restricts the use it calls into question and flags explicitly dependent results for re-examination; it does not automatically declare those results false. The responsible mission agent examines the effect and proposes a reasoned decision to retain the result, a controlled correction, or an explicit unresolved limitation. Independent work can continue. Previous results and control history remain inspectable, and a new favorable verdict cannot silently erase the earlier objection: the resolution must explain how it was addressed using the examined material. This is targeted re-examination of available material, not an automatic new documentary research phase.

Human decisions remain associated with the version reviewed. Later inventory enrichment or analytical rework must not silently rewrite a retained interpretation or imply fresh analyst adoption. If rework proposes a material change to an appraisal already retained, that change returns as a targeted human exception; it does not require routine reapproval of the whole dossier. Affected synthesis outputs must expose the unresolved change rather than imply they rest on a newly adopted appraisal. Detailed freshness representation and revision mechanics remain open.

While the targeted judgment is pending, independent work continues. A limited synthesis may become available if the unaffected analytical base supports a coherent and useful reading on an explicit reduced scope. Its diagram and note are submitted together, identify the limitation, and do not present relations depending on a contested premise as settled support. Availability of this result leaves the exception open.

If the overall reading depends on the contested premise, delivery waits for the targeted judgment. This pending decision is not a reasoned finding that the instructed evidence cannot support a synthesis.

Observation confirmed on 2026-10-30: [claimValidation.ts](../../../convex/domain/claimValidation.ts) counts question-linked claims, including `Unknown`, in `deriveQuestionCoverage`; the [matrix query](../../../convex/evidenceMatrix.ts) separately counts valid claims linked to current questions. These remain evidence-presence projections. The accepted materialized outcome projection is defined by the [product contract](../../../PRODUCT.md#evidence-matrix-and-analytical-review), [TECH](../../../context/TECH.md#analytical-control-and-question-outcome-contracts) and [ADR-026](../../decisions/026-use-typed-analytical-controls-and-materialized-question-outcomes.md); [the roadmap](../../ROADMAP.md#phase-8--investigation-and-grouped-appraisal-review) owns its undelivered implementation. Claim coverage alone does not implement that projection.

The analyst remains the final authority over analytical judgment. Source selection follows the target launch mandate described above; exact provenance, inspectable proposals, and preserved decisions remain essential.

## Economic Data Boundary

The accepted prototype scope retains sourced figures, ratios, and projections with their attribution, definitions, periods, and limitations. It may place relevant material alongside one another and explain differences in scope or meaning. Numerical comparability cannot be assumed from a shared unit alone.

The tool does not calculate new results or undertake dedicated financial data collection or modeling. A ratio published by a source can remain an attributed claim; recomputing it is outside the selected scope. Determining an activity's revenue share, reconstructing segment economics, and building quantitative scenarios are not included.

An earlier preference for simple verifiable calculations was explicitly narrowed after considering the work required to delimit activities, obtain comparable inputs, and preserve reproducible calculations. Tool-generated arithmetic was then excluded from the prototype. Reconsideration would require a concrete demonstrated need and a new scope decision.

## Alternatives Considered

| Alternative | Outcome and reason |
| --- | --- |
| A revised fixed grid for every company | Not selected. It supports repeated comparison but can force attention onto weakly relevant or poorly documented categories. The user selected a common foundation with case-specific decisive questions. |
| Entirely bespoke research without a common analytical foundation | Not selected. It is flexible but offers fewer shared checks against omissions. |
| A theme profile of positions, confidence, and direction | Not selected as the principal restitution. It is quick to scan but requires defensible category definitions and comparability. The user selected reasoned appraisals with evidence, objections, and unknowns visible. |
| Dedicated financial scenarios or tool-generated calculations | Not retained in the prototype scope. Even simple arithmetic introduces input-definition, comparability, provenance, and validation work beyond the selected preparation task. Sourced figures and ratios remain useful. |
| A product organized primarily to display the author's abilities | Explicitly rejected as the priority. Usefulness to Raphaëlle and Decoding Discontinuity comes first; candidature value follows from it. |
| Wait until framing is complete before starting research | Selected for the prototype. It keeps the sequence simpler and avoids premature work against a changing scope. |
| Delegated framing with automatic research start | Not selected for the prototype. The analyst explicitly uses Start research after the proposed framing, with refinements remaining optional. |
| Prepare shared documentary material while framing remains open | Not selected for the prototype. This earlier recommendation was superseded by the user's choice to finish framing first. Any future time-saving benefit would need verification. |
| Start all common-question investigations while framing remains open | Not selected for the prototype. It adds speculative work and consistency handling beyond the retained sequential start. |
| Require a contextual corpus approval before every analysis | Not selected as the target workflow. The user selected delegated source selection under an initial mandate, with important exceptions raised contextually. |
| Independent appraisals referencing passages without a shared assertion inventory | Not selected. It reduces intermediate objects but repeats common interpretations and corrections across questions. The company inventory and reusable sourced assertions are retained. |
| Require an exhaustive inventory and routine human confirmation of every assertion and link | Not selected. The system must retain the inventory and mandatory controls while avoiding an analyst-managed inventory-completion workflow. |
| Delay semantic inventory admission until appraisal submission | Not selected. Controlling assertions and uses at contribution localizes defects before reuse; appraisal controls examine their own reasoning. |
| Recheck all documentary and analytical inputs at every stage | Not selected. Reuse controls that remain valid in their scope and examine the new contribution or use at the relevant submission boundary. |
| Individual adoption of every appraisal as the default | Not selected. The user retained grouped review with correction or follow-up per question. |
| Grouped review of appraisals, diagram, and note at the end | Not selected. The user placed grouped review at Investigation output so Synthesis can finish autonomously without another routine final judgment step. |
| Remove grouped appraisal review and intervene only for exceptions | Not selected. The user retained grouped review before Synthesis. |
| A fully prescribed analytical path as the sole approach | Not selected. Specialized mission agents adapt the inquiry using shared controlled operations; complete standard treatments remain reusable from code. |
| Activate agents only after a recognized conflict or blockage | Not selected. Each Investigation or Synthesis agent chooses its approach from the start of its mission. |
| Separate business implementations for system calls and agent tools | Not selected. A common operation owns the contract and rules; the agent interface supplies the description, schema, and execution binding. |

## Working System Brief

**System type** — Complex at the level of analytical usefulness and analyst workload, with Clear and Complicated internal controls. Exact passage reproduction and workflow authorization have reproducible rules; whether prepared material helps the intended analyst judge a particular economic question depends on the case, available sources, and use. The new interaction has illustrative design evidence, not demonstrated end-to-end analytical usefulness. This is a working classification, not a measured product result.

**Players and incentives** — The following are design hypotheses about roles, not verified findings about Decoding Discontinuity's internal practices.

| Player | Wants | Incentive or constraint to consider |
| --- | --- | --- |
| Intended analyst, including Raphaëlle | Useful economic interpretation with credible evidence and limited coordination work. | Readily available narrative can feel useful before its limitations are examined. |
| Prototype author | Deliver a useful contribution that supports the candidature. | Visible breadth and polish can displace the work needed for a convincing analytical result. |
| Operator and maintainer | Reliable, bounded execution and understandable failures. | Optimizing for terminal workflow states or low cost alone can conceal inadequate preparation. |
| Source producers | Communicate their disclosures, products, reporting, or interpretations. | Publication purposes differ; confidence, volume, and domain diversity do not establish truth or independence. |

**Stocks and flows** — Sources, captures, qualified contributions, shared assertions, appraisals, unresolved questions, analyst decisions, and synthesis outputs accumulate. Discovery, reading, qualification, reuse, correction, adoption, and synthesis move them between states. Analyst attention and execution allowances are finite. Increasing the source stock faster than useful qualification and review can absorb it creates a backlog rather than demonstrated value. No rates or savings have been measured for this direction.

**What the change sets off** — A hypothesized reinforcing loop is shared evidence reuse, less repeated preparation, more attention for material judgments, useful corrections, and a better inventory. A harmful reinforcing loop is rewarding source or assertion counts, producing more review work, encouraging superficial confirmation, and accumulating false confidence. A balancing loop is bounded research plus visible unresolved questions, limiting further acquisition while enabling a deliberate follow-up. Delayed feedback matters: an attractive early appraisal can appear successful before source misuse or stale reasoning is discovered. Later enrichment can also invalidate an earlier interpretation; version-bound decisions prevent that change from silently becoming the analyst's new view.

Analytical rework can improve consistency across appraisals while delaying result availability; bounded returns and targeted exceptions constrain that loop. A visually persuasive diagram that hides uncertainty could weaken judgment even when its note preserves the caveat. Diagram-to-note coherence and visible limitations must therefore be examined together.

**Protocol** — Use deterministic checks and focused technical analysis for the reproducible controls. Use the smallest reversible experiment for analytical usefulness and workload, rather than treating a polished interface or a passing schema as validation of the whole system. The proposed leverage point is the handoff from routine evidence preparation to a material human judgment, not raw collection throughput.

**Next smallest test** — Proposed, not executed: use one frozen illustrative dossier with questions sharing an assertion, a contradictory passage, and a documented gap. Walk through framing, source output, appraisals, grouped review, and autonomous synthesis; record whether the analyst can understand and challenge the economic interpretation without coordinating preparation. Inspect diagram-to-appraisal traceability, preservation of the gap, and agreement between diagram and note. Exercise a targeted new-premise instruction, keeping any material revision distinct from the earlier judgment. Check research-start gating, an empty retained-appraisal set, limited delivery during an open exception, delivery waiting on a central contested premise, and the non-establishment outcome. With fixed inputs and controlled semantic-verifier results, exercise an inventory contribution through both system and agent-tool entry points under equivalent authority and inspect their control outcomes. If the decisive friction is entirely explained by repeatable ownership or transition defects, classify that slice as Complicated and repair it with focused analysis rather than adding exploratory automation. Repeated inability to judge without deep research coordination would falsify the proposed division of work.

## Research Basis and Adaptation

These sources inform the conception. They establish public research themes, not confirmed internal requirements or usability validation from Decoding Discontinuity.

The [Sources evaluation from 2026-10-25 and 2026-10-26](../../../scripts/evaluations/source-selection/SOURCES-APPROACH-EVALUATION-20261025.md#live-inspection-comparison-and-semantic-adjudication) preserves fixed and agent outcomes, documentary judgments, and reproduced harness failures. Those frozen experiments and the external sources are mapped to the retained choices in the [agentic execution conception](2026-10-26-agentic-execution-architecture.md#evidence-and-architectural-lessons); they do not establish quality or implementation of the target missions.

### Source Coverage

- [Raphaëlle intervention on podcast about Anthropic, Silicon Carne](https://youtu.be/wZ4Fq6lrnbE): metadata and French timed transcript retrieved through YouTube Transcript in Executor. Relevant passages were examined, including the discussion of durable advantage and value migration around 25:00–33:00. The description was read; no sponsor or social-profile link was used as analytical evidence.
- [Raphaëlle intervention on podcast about OpenAI, Silicon Carne](https://youtu.be/vjANwplght0): metadata and French timed transcript retrieved through the same connection. Relevant passages were examined, including the reconciliation of revenue projections, model usage, routing, and pricing around 4:20–10:50. The description links to the Decoding Discontinuity homepage, which was read through Exa.
- [The Investor's Edge Lives in Their Head, Anekha Sokhal, Moshi](https://youtu.be/UHbODjuviAU): English transcript read through Exa; metadata, description, and transcript retrieved through Firecrawl on 2026-10-24. Executor was not exposed in that session, and the available transcript connector returned no text. The chapter beginning at 10:28 distinguishes preparatory reading, gathering, and cross-checking from human judgment. The description's [Moshi link](https://hellomoshi.ai) was read through Exa; the event-promotion link was not used. This informs the division of work, not a claim that the prototype delivers continuous market monitoring, trading decisions, a quant team, or Moshi's advertised performance.
- The user-supplied [Questionnaire documentation](https://ui.shadcn.com/docs/components/base/questionnaire) was read through Exa. It describes single and multiple choices, freeform answers, optional questions, and host-owned persistence and branching. This supports the selected interaction direction without establishing installation or compatibility in the prototype.
- External content read through Exa includes [About Decoding Discontinuity](https://www.decodingdiscontinuity.com/about), [Institutional Research](https://www.decodingdiscontinuity.com/p/institutional-research), and the [public ARAF presentation](https://www.decodingdiscontinuity.com/p/araf-architectural-resilience-assessment-framework).
- Local discovery included the current reference documents, [researchPlan.ts](../../../convex/domain/researchPlan.ts), [the claim detail view](../../../src/components/workspace/evidence-claim-detail.tsx), the matrix query and coverage derivation, and the existing CCC selection rationale. Workflow discovery also inspected [Start](../../../src/routes/workspace/start.tsx), [the creation screen](../../../src/components/workspace/start/start-research-page.tsx) (formerly `ResearchComposer`, relocated on 2026-11-03), [persisted progress](../../../src/components/workspace/run-progress.tsx), [source preparation](../../../convex/sourcePreparationWorkflow.ts), and [corpus approval](../../../convex/sourceSelectionProposals.ts). Source inspection does not establish runtime readiness or analytical usefulness.

### Source-to-Design Mapping

| Source component | Mechanism and intended result | Design decision | Status |
| --- | --- | --- | --- |
| Public research on value migration, context, and workflow control | Connect a company's operating role to the durability of its economic position. | Retain this research problem within a bounded company dossier. | Adapted; independent contribution, not framework reproduction. |
| Anthropic interview on durable advantage beyond model quality | Investigate which business positions can remain valuable as models and competition change. | Examine resilience through evidence and competing interpretations specific to the activity. | Adapted. |
| OpenAI interview reconciling economic projections with technical choices | Preserve the assumptions and definitions needed to examine apparently conflicting arguments. | Retain attributed economic material and inspect comparability, while excluding new calculations and financial modeling. | Intentional divergence in scope, explicitly chosen by the user. |
| Public ARAF discussion of strategic position, technical readiness, and execution | Distinguish a plausible position from demonstrated implementation. | Inform the research questions without copying its scoring, dimensions, or output instrument. | Adapted. |
| Existing CCC research question | Test coordination control against a credible substitutability interpretation. | Use it as the concrete reference for the retained dossier outcome. | Preserved research scope; no company conclusion established. |
| Moshi talk: preparatory work feeds human judgment, with traceable reasoning | Gather, read, and cross-check material so the analyst can focus attention on interpretation and decisions. | Let the system advance under a launch mandate and expose important exceptions and supporting reasoning. | Adapted to the user's direction; the mandate is the user's decision, not a rule demonstrated by the talk. |
| Moshi's continuous monitoring and quant-team positioning | Deliver ongoing market intelligence at institutional scope. | Exclude continuous monitoring, a quant-agent team, trading execution, and financial calculations from this conception. | Intentional divergence to preserve the prototype's scope. |
| Questionnaire: structured choices, freeform input, and optional questions | Collect intent while keeping answer and navigation behavior understandable. | Use it for contextual framing and intervention, without asking the analyst to perform the research or treating the component as workflow authority. | Selected component direction; detailed integration remains open. |

## Open Decisions and Handoff Boundary

- Define the exact common research foundation, the bounded set of decisive questions, and how the proposed activity or workflow is selected and corrected.
- Define how later scope changes affect ongoing work and existing results. Start research is the retained framing-completion event; speculative background research during framing is not part of the prototype.
- Specify the launch mandate's source-selection rules, resource limits, intervention criteria, and handling of material exceptions, using the source conception for its internal workflow. Delegated selection is accepted; its enforcement and replacement of the current human corpus checkpoint are not implemented.
- Integrate the three specialized mission roles through the retained common execution contract and transversal operation catalogue. Translate the accepted control responsibilities into concrete interfaces, permissions, result records, and executable checks. Functional contract examples remain revisable; numerical limits and runtime parameters are deferred to implementation against the then-current state.
- Define card grouping, detail-page navigation, and completed-result presentation. Preserve the accepted composer, timeline, contextual-intervention, and optional-inspection direction without treating an illustrative layout as finished design.
- Specify the grouped complement's prioritization and resource allocation across questions, and the cooperation outcomes when requested material is unavailable. Its placement after the first shared analytical pass and its single bounded phase are retained.
- Specify the detailed limits and stopping rules for analytical rework, and executable checks for the retained delivery conditions during a targeted human exception. New-premise instruction, limited delivery when coherent and useful, and waiting when the overall reading depends on a contested premise are retained.
- Specify shared assertion identity, question-to-evidence relationships, inventory correction and enrichment mechanisms, and their presentation in the matrix. Admission timing and targeted re-examination are retained; exact records, freshness presentation, and navigation remain open.
- Define confidence presentation, treatment of future horizons, and the detailed interaction and audit semantics of grouped review. Its placement at Investigation output is retained; its controls and persistence shape remain open.
- Explore the visual composition and inspection of the mechanism diagram and the reading experience of its reasoned note. Immediate comprehension and the intended visual impact require validation with an illustrative dossier.
- Specify executable completion checks and projections for justified insufficiency, a synthesis non-establishment finding, pending human judgment, and interrupted or unperformed work. The functional outcomes and the requirement for at least one retained appraisal before Synthesis are settled; their technical states remain open.
- Define the transition from the current ten-dimension model to the question-led workflow, including existing records, policies, fixtures, and dossiers.
- Decide the exact landing-page matrix example and capability copy after settling the functional design.
