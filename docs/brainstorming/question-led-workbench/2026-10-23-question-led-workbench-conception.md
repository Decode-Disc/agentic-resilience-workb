# Question-Led Analysis Workbench: Retained Conception

## Status

Recorded on 2026-10-23 and updated on 2026-10-25. This document preserves the accepted product direction, shared inventory, autonomous preparation, grouped analyst review, and synthesis direction. The target workflow is not implemented; detailed design decisions remain open.

This document owns the overall workflow, cooperation between responsibilities, shared inventory rules, and analyst judgment. The [source ingestion and processing conception](2026-10-24-source-ingestion-and-processing-conception.md), [Investigation conception](2026-10-24-investigation-conception.md), and [Synthesis conception](2026-10-25-synthesis-conception.md) detail their respective work and interfaces.

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
The analyst may refine the orientation
Complete framing before starting research
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
                         |
                         v
AUTONOMOUS SYNTHESIS
Connect the retained appraisals into an economic mechanism diagram
Develop the reasoned note from that reference
                         |
                         v
RESULT AVAILABLE
Inspect the diagram, reasoning, evidence and limitations
Challenge or follow up when useful
```

Interventions can occur contextually throughout the workflow rather than becoming a succession of analyst-managed stages. Work that does not depend on the requested decision should remain able to advance within the mandate. The precise exception policy is still open.

### Research Starts After Framing

The user selected waiting until framing is complete before starting source preparation or question investigations. This keeps the prototype sequence simpler and avoids research performed against a scope that is still being established. Common questions remain part of the analytical foundation; they do not launch background investigations while the analyst is refining the case-specific questions.

The system proposes a usable framing rather than requiring the analyst to write the research plan. Refinements are optional. How framing reaches a completed state, and what happens when the scope changes afterward, remain to be specified; this decision does not introduce an additional mandatory confirmation by itself.

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

Sources, Investigation, and Synthesis have dedicated functional conceptions. Their boundaries do not prescribe separate services, agents, model calls, or cards; the technical decomposition and presentation remain to be selected.

| Proposed responsibility | Output |
| --- | --- |
| Source ingestion and processing | Shared documentary material with qualification, provenance, and limitations; see its dedicated conception. |
| Investigation | Controlled contributions to the shared inventory, grouped documentary needs, and distinct reasoned appraisals from a common inquiry into the dossier. |
| Synthesis | A reference diagram of the decisive economic mechanisms and a derived, fully reasoned note, expressing a traceable interpretation across the retained appraisals. |

A workflow capability, an execution of that capability, and its visible card are distinct concepts. The source matrix is a detailed view of source preparation; a research question is not another independent source-collection module. Investigation works across the framed questions with shared material and a common company inventory, then prepares separate appraisals without duplicating the same assertion for each one.

```text
Completed framing
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
        |
        v
Synthesis: mechanism diagram and reasoned note
        |
        v
Result available, with optional inspection and challenge
```

One source can inform several questions through the relevant passages. Reusing it must preserve its identity, permitted uses, and limitations. Whether cards represent responsibilities, individual investigations, or grouped work remains open; a growing question count should not automatically produce a separate floating source matrix for every question.

### Cooperation and Documentary Complement

Sources first prepares a shared documentary foundation with research targeted at the framed questions, under a bounded initial plan. Investigation then conducts a common inquiry: it exploits the prepared material and inventory, enriches the inventory with controlled assertions, and tests the interpretations across questions. This shares evidence and documentary needs across questions rather than launching independent inquiries with separate inventories for each one.

After this first analytical pass, Investigation identifies which missing information could materially change an appraisal, taking account of the documentary gaps reported by Sources. It groups overlapping needs into a targeted request. Sources handles the resulting discovery, reading, qualification, comparison, and selection; Investigation uses the returned material to re-examine its reasoning. Sources does not consume an earlier complement solely to complete documentary roles before Investigation has identified the decisive needs.

The prototype allows one autonomous, grouped, bounded complement phase when useful. It may contain several searches or retrievals, rather than exactly one provider call. If no useful request is identified, Investigation proceeds directly to its appraisals. Remaining gaps are disclosed after the phase; they do not automatically initiate another search cycle. Exact prioritization criteria, counts, costs, time limits, and intervention thresholds remain open. This sequence does not require the analyst to coordinate the handoffs.

### Synthesis and Bounded Analytical Rework

After grouped appraisal review, Synthesis connects the retained appraisals and their evidence into an interpretation of the investigated scope. It may propose transversal inferences rather than only condense existing text. The economic mechanism diagram is the reference result, anchored in the actors and workflow; the derived note develops the same interpretation with its reasoning, evidence, objections, and unknowns. The selected direction emphasizes mechanisms of control, dependency, value capture, and possible agentic change. Visual composition and immediate comprehensibility remain to be tested.

Synthesis handles tensions that can be explained from the existing appraisals within its own reasoning. When a problem requires an appraisal itself to be re-examined, it sends Investigation a focused concern tied to the affected interpretation and available evidence. Investigation re-examines the analysis and returns a proposed revision or an explanation of why no change is warranted. Synthesis then revisits its affected reasoning and outputs.

This analytical return is autonomous and bounded, uses the material already available, and does not launch another documentary research phase. Remaining limitations are exposed rather than initiating an open-ended loop. Exact triggering criteria, limits, and stopping rules remain to be specified. Material revisions to retained judgments follow the review and version rules below.

## Shared Company Inventory and Evidence Matrix

The retained conception preserves a general company inventory, including useful company context and sourced assertions shared across questions. The system can enrich it from the work performed; other enrichment mechanisms remain to be selected. The inventory need not be exhaustive before a useful appraisal can be proposed.

Sources supplies qualified documentary material. Investigation transforms relevant material into controlled assertions and enriches the inventory during the inquiry. Admission to the analytical inventory requires the assertion and its intended use to satisfy the shared controls; Investigation applies these rules rather than defining a separate validation policy. Finding, reading, selecting, and quoting a source do not themselves establish an assertion's truth. A common assertion can serve several questions while each use retains its own scope, rationale, and supporting, opposing, or contextual relationship.

The evidence matrix makes this inventory and its uses inspectable. The analyst can connect a research question to the relevant assertions, passages, objections, unknowns, control results, and corrections. It need not occupy the main progress view or require supervision of every operation. The distinctions between `Fact`, `Inference`, `Hypothesis`, and `Unknown` remain useful.

Three meanings of validation must remain separate: documentary integrity checks, checks on the permitted use and reasoning of an assertion and its links, and human adoption of an analytical interpretation. System controls remain mandatory. A failed integrity check cannot be waived by a human approval. An unresolved analytical limitation must produce an explicit restriction, uncertainty, exclusion from the affected use, or important exception; it cannot silently become a successful validation.

The same shared control principles apply to the relationships and transversal inferences proposed by Synthesis. A retained appraisal is an input to that reasoning, not automatic validation of every inference drawn from it. Synthesis retains traceable dependencies on the appraisals and evidence it uses.

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

The mechanism diagram and reasoned note then become available without another routine approval step. They remain a proposed interpretation based on reviewed appraisals; generation does not imply human adoption of the synthesis. The analyst can inspect or challenge the result without having to repeat the appraisal review to reach it.

Investigation may finish preparing its appraisals when the framed questions have been investigated, including a question that ends in explicitly justified evidence insufficiency. Synthesis preserves those limitations when preparing its outputs after review. A result becoming available means the relevant preparatory work is complete, not that every question is resolved or the analyst has adopted the overall interpretation. Interrupted or unperformed work remains incomplete; missing technical capability cannot be relabelled as an evidence-based unknown. The former finalization requirement of ten dimension decisions is not retained.

Human decisions remain associated with the version reviewed. Later inventory enrichment or analytical rework must not silently rewrite a retained interpretation or imply fresh analyst adoption. If rework proposes a material change to an appraisal already retained, that change returns as a targeted human exception; it does not require routine reapproval of the whole dossier. Affected synthesis outputs must expose the unresolved change rather than imply they rest on a newly adopted appraisal. Exact freshness indicators, follow-up behavior, and revision mechanics remain open.

Question coverage must not imply that a question is resolved merely because a claim refers to it. Inspection of [claimValidation.ts](../../../convex/domain/claimValidation.ts) found that `deriveQuestionCoverage` counts question-linked claims, including `Unknown`. The [matrix query](../../../convex/evidenceMatrix.ts) uses that count. This is evidence presence, not an established answer. The exact replacement for this projection is undecided.

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
| Prepare shared documentary material while framing remains open | Not selected for the prototype. This earlier recommendation was superseded by the user's choice to finish framing first. Any future time-saving benefit would need verification. |
| Start all common-question investigations while framing remains open | Not selected for the prototype. It adds speculative work and consistency handling beyond the retained sequential start. |
| Require a contextual corpus approval before every analysis | Not selected as the target workflow. The user selected delegated source selection under an initial mandate, with important exceptions raised contextually. |
| Independent appraisals referencing passages without a shared assertion inventory | Not selected. It reduces intermediate objects but repeats common interpretations and corrections across questions. The company inventory and reusable sourced assertions are retained. |
| Require an exhaustive inventory and routine human confirmation of every assertion and link | Not selected. The system must retain the inventory and mandatory controls while avoiding an analyst-managed inventory-completion workflow. |
| Individual adoption of every appraisal as the default | Not selected. The user retained grouped review with correction or follow-up per question. |
| Grouped review of appraisals, diagram, and note at the end | Not selected. The user placed grouped review at Investigation output so Synthesis can finish autonomously without another routine final judgment step. |
| Remove grouped appraisal review and intervene only for exceptions | Not selected. The user retained grouped review before Synthesis. |

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

**Next smallest test** — Proposed, not executed: use one frozen illustrative dossier with questions sharing an assertion, a contradictory passage, and a documented gap. Walk through framing, source output, appraisals, grouped review, and autonomous synthesis; record whether the analyst can understand and challenge the economic interpretation without coordinating preparation. Inspect diagram-to-appraisal traceability, preservation of the gap, and agreement between diagram and note. Exercise a bounded analytical return when an appraisal needs re-examination, keeping any material revision distinct from the earlier judgment. If the decisive friction is entirely explained by repeatable ownership or transition defects, classify that slice as Complicated and repair it with focused analysis rather than adding exploratory automation. Repeated inability to judge without deep research coordination would falsify the proposed division of work.

## Research Basis and Adaptation

These sources inform the conception. They establish public research themes, not confirmed internal requirements or usability validation from Decoding Discontinuity.

### Source Coverage

- [Anthropic interview, Silicon Carne](https://youtu.be/wZ4Fq6lrnbE): metadata and French timed transcript retrieved through YouTube Transcript in Executor. Relevant passages were examined, including the discussion of durable advantage and value migration around 25:00–33:00. The description was read; no sponsor or social-profile link was used as analytical evidence.
- [OpenAI interview, Silicon Carne](https://youtu.be/vjANwplght0): metadata and French timed transcript retrieved through the same connection. Relevant passages were examined, including the reconciliation of revenue projections, model usage, routing, and pricing around 4:20–10:50. The description links to the Decoding Discontinuity homepage, which was read through Exa.
- [The Investor's Edge Lives in Their Head, Anekha Sokhal, Moshi](https://youtu.be/UHbODjuviAU): English transcript read through Exa; metadata, description, and transcript retrieved through Firecrawl on 2026-10-24. Executor was not exposed in that session, and the available transcript connector returned no text. The chapter beginning at 10:28 distinguishes preparatory reading, gathering, and cross-checking from human judgment. The description's [Moshi link](https://hellomoshi.ai) was read through Exa; the event-promotion link was not used. This informs the division of work, not a claim that the prototype delivers continuous market monitoring, trading decisions, a quant team, or Moshi's advertised performance.
- The user-supplied [Questionnaire documentation](https://ui.shadcn.com/docs/components/base/questionnaire) was read through Exa. It describes single and multiple choices, freeform answers, optional questions, and host-owned persistence and branching. This supports the selected interaction direction without establishing installation or compatibility in the prototype.
- External content read through Exa includes [About Decoding Discontinuity](https://www.decodingdiscontinuity.com/about), [Institutional Research](https://www.decodingdiscontinuity.com/p/institutional-research), and the [public ARAF presentation](https://www.decodingdiscontinuity.com/p/araf-architectural-resilience-assessment-framework).
- Local discovery included the current reference documents, [researchPlan.ts](../../../convex/domain/researchPlan.ts), [the claim detail view](../../../src/components/workspace/evidence-claim-detail.tsx), the matrix query and coverage derivation, and the existing CCC selection rationale. Workflow discovery also inspected [Start](../../../src/routes/workspace/start.tsx), [the composer](../../../src/components/workspace/research-composer.tsx), [persisted progress](../../../src/components/workspace/run-progress.tsx), [source preparation](../../../convex/sourcePreparationWorkflow.ts), and [corpus approval](../../../convex/sourceSelectionProposals.ts). Source inspection does not establish runtime readiness or analytical usefulness.

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
- Define how framing completes without making optional refinements mandatory, and how later scope changes affect ongoing work and existing results. Research starts only after framing; speculative background research during framing is not part of the prototype.
- Specify the launch mandate's source-selection rules, resource limits, intervention criteria, and handling of material exceptions, using the source conception for its internal workflow. Delegated selection is accepted; its enforcement and replacement of the current human corpus checkpoint are not implemented.
- Define the technical realization of Sources, Investigation, and Synthesis, card grouping, detail-page navigation, and completed-result presentation. Preserve the accepted composer, timeline, contextual-intervention, and optional-inspection direction without treating an illustrative layout as finished design.
- Specify the grouped complement's prioritization and resource allocation across questions, and the cooperation outcomes when requested material is unavailable. Its placement after the first shared analytical pass and its single bounded phase are retained.
- Specify the triggers, limits, and stopping rules for analytical rework between Synthesis and Investigation, including how a proposed material revision becomes a targeted exception. The return uses existing material and does not add a documentary research phase.
- Specify shared assertion identity, question-to-evidence relationships, inventory correction and enrichment mechanisms, and their presentation in the matrix. Exact records, freshness rules, and navigation are not selected.
- Define confidence presentation, treatment of future horizons, and the detailed interaction and audit semantics of grouped review. Its placement at Investigation output is retained; its controls and persistence shape remain open.
- Explore the visual composition and inspection of the mechanism diagram and the reading experience of its reasoned note. Immediate comprehension and the intended visual impact require validation with an illustrative dossier.
- Specify executable completion checks that distinguish investigated-but-insufficient questions from interrupted or unperformed work. Preparation may end with justified insufficiency; the exact projections and transitions remain open.
- Define the transition from the current ten-dimension model to the question-led workflow, including existing records, policies, fixtures, and dossiers.
- Decide the exact landing-page matrix example and capability copy after settling the functional design.
