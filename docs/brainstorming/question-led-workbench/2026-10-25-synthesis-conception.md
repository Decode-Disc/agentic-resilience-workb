# Synthesis: Retained Conception

## Status

Recorded on 2026-10-25 and updated on 2026-10-26. The functional direction and three principal stages are accepted. Visual composition and immediate comprehensibility remain to be tested. The [global conception](2026-10-23-question-led-workbench-conception.md) owns workflow order, shared analytical controls, analyst judgment, and cooperation between bricks. The [agentic execution conception](2026-10-26-agentic-execution-architecture.md) owns the shared execution contract.

## Purpose and Simple Workflow

Connect the retained appraisals into an interpretation of the investigated activity's economic position and resilience to agentic change. When that interpretation can be supported, the economic mechanism diagram is the reference result and a derived, fully reasoned note develops it. The diagram should create a compelling first impression through clear understanding of the decisive mechanisms, grounded in the actors and workflow. The [global outcome rules](2026-10-23-question-led-workbench-conception.md#synthesis-outcomes) also allow a reasoned non-establishment finding.

```text
CONNECT THE APPRAISALS
          |
          v
BUILD AND TEST THE DIAGRAM
          |
          +-- No supported mechanism --> REASONED NON-ESTABLISHMENT FINDING
          |
          | Supported mechanisms
          v
DEVELOP THE REASONED NOTE
```

## Interface

A specialized Synthesis agent takes the retained analytical base and uses the [transversal operation catalogue](2026-10-23-question-led-workbench-conception.md#transversal-operation-catalogue) to prepare its result. A supported synthesis submits its diagram and note together; the alternative result is the reasoned non-establishment finding below. A re-examination concern is conditional. Exact records and execution integration remain to be designed.

| Direction | Information crossing the interface |
| --- | --- |
| Input | Company and activity scope, framed questions, retained appraisal versions eligible under the global review conditions, their reasoning and evidence dependencies, objections, and identified open or deferred questions. |
| Reference artifact when a synthesis is supported | An economic mechanism diagram with meaningful relationships, traceable reasoning, supporting appraisals and evidence, conditions, and limitations. |
| Derived artifact in the same submission | A fully reasoned note explaining the diagram's interpretation, economic implications, support, objections, unknowns, and conditions that could change the reading. |
| Alternative result: synthesis not established | A reasoned finding identifying the analytical basis and material examined, why no sufficiently supported mechanism can be established, remaining limitations, and missing information. |
| Re-examination concern, when needed | A concern about an appraisal or a material new premise, its passage references and effect on the affected question or mechanism, retained with the outcome. |
| Progress and inspection | Actual advancement, relationship explanations and control results, unresolved limitations, and affected outputs when an input changes. |

[Investigation](2026-10-24-investigation-conception.md) supplies the question-level appraisals. The [global cooperation rules](2026-10-23-question-led-workbench-conception.md#synthesis-and-bounded-analytical-rework) determine how retained inputs and analytical returns are handled.

For a supported synthesis, the agent develops the diagram as its reference and the note from that reasoning, then submits both through one synthesis operation. The operation applies the [submission controls](#submission-controls) to their coherence, versions, and evidence dependencies together. The same operation receives the alternative finding under the global outcome rules. The [pending-revision rules](2026-10-23-question-led-workbench-conception.md#retained-judgments-and-pending-revisions) determine when a limited result can become available or delivery must wait.

## Internal Work by Principal Stage

### Connect the Appraisals

Synthesis identifies how the retained appraisals combine, qualify, or constrain one another. It may propose transversal inferences whose reasoning is not already expressed in a single appraisal. Each inference must make the connection from its inputs to the economic interpretation explicit.

- Identify the mechanisms that matter to the selected activity: control, dependencies, value capture, and possible effects of agents, as relevant to the case.
- Anchor the interpretation in the actors and workflow established by the analytical base. Distinguish an observed role from an inferred source of economic power.
- Examine how an advantage depends on another actor, condition, or capability, and how an opposing mechanism could weaken or bypass it.
- Preserve relevant disagreements and alternative readings. Several plausible interpretations may remain when the available evidence cannot settle their relationship.
- Identify how open or deferred questions constrain the overall interpretation. An unreviewed proposal cannot silently become a retained appraisal merely because it would make the diagram more complete.

The resulting account remains attached to the investigated scope. Connecting appraisals about one activity does not establish an interpretation of every company activity.

### Build and Test the Diagram

Synthesis organizes the decisive mechanisms into a comprehensible reference diagram. The primary reading emphasizes their economic meaning; actors and workflow supply the concrete context. Detailed reasoning remains accessible without requiring it all to occupy the overview.

Each relationship explains what connects its elements and why that connection matters. A dependency, an enabling condition, and a possible threat carry different meanings; their representation must preserve those distinctions. An arrow is an analytical statement requiring justification, not a connection created solely because two concepts appear in the same dossier.

Apply the [shared analytical controls](2026-10-23-question-led-workbench-conception.md#shared-company-inventory-and-evidence-matrix) to proposed relationships and transversal inferences. Inspect whether their inputs support the proposed mechanism, whether the interpretation depends on an unestablished condition, and whether objections change its meaning. Retaining the input appraisals does not by itself validate the relationship drawn between them.

A relationship's detail exposes its explanation, relevant appraisals, supporting passages, objections, and limitations. Conditional or contested reasoning remains recognizable in the diagram. A missing basis limits the proposed connection; visual completeness cannot supply that basis.

Synthesis resolves issues in its own reasoning where the retained analytical base permits it. It sends a focused concern when an appraisal needs reconsideration or a material new premise needs instruction, and uses the returned outcome under the cooperation rules. Any unresolved effect remains visible in the applicable result and its explanation.

### Develop the Reasoned Note

The note develops the interpretation represented by the reference diagram with the depth of a standalone argued analysis. It explains why the mechanisms matter economically, how the appraisals and evidence support that reading, which objections constrain it, and what unknowns or changes could overturn it.

The note can develop nuances and evidence that do not fit in the visual overview. It remains consistent with the diagram's underlying reasoning and conditions; a change to the interpretation must be reflected in both outputs.

The reader should be able to move from an economic implication to the relevant mechanism, appraisal, and evidence. A visually concise diagram and a detailed note therefore express the same analysis at different levels of depth.

## Submission Controls

Synthesis submission owns structural and semantic controls of the proposed result. It reuses valid input controls under the [common reuse rules](2026-10-26-agentic-execution-architecture.md#reuse-of-controlled-results), then examines its new analytical contribution:

- New relationships and transversal inferences are justified from admissible retained appraisals and their evidence. Retaining those inputs does not establish the proposed connection automatically.
- The diagram and argued note express the same interpretation, scope, and conditions. The note can develop nuances while preserving the diagram's underlying meaning.
- Conditions, objections, and unknowns remain visible and limit the interpretation, including in the visual overview. A necessary new premise follows the existing Investigation re-examination route.

For the alternative non-establishment finding, the control examines the stated analytical basis, reasons, and limitations rather than requiring a forced diagram. Diagnostics return to the Synthesis agent for targeted reconsideration; delivery and affected-result handling follow the global outcome and revision rules.

## Autonomy and Optional Inspection

The mission agent chooses its approach and useful inspections under the [common execution contract](2026-10-26-agentic-execution-architecture.md#shared-mission-contract). The [mission completion contract](2026-10-23-question-led-workbench-conception.md#mission-completion-contract) governs when the applicable result allows progression. System work checks the result against its artifact requirements; for a supported synthesis, this includes the diagram's relationships and the note's fidelity.

An available diagram supports a quick overall reading, then optional inspection of a mechanism and its evidence. The alternative finding explains why that reading could not be established. The analyst can challenge the interpretation or its stated limits. The precise navigation, correction interactions, and visual treatment of changing inputs remain to be designed.

## Alternatives Considered

| Alternative | Outcome and reason |
| --- | --- |
| A reasoned note as the primary result | Initially recommended by the agent, not selected by the user. The diagram was chosen as the reference to make the mechanisms immediately understandable; the note retains full argumentation. |
| Cross-appraisal relationships without a standalone overall result | Not selected. The user chose a reference diagram and derived note rather than requiring the reader to reconstruct the overall interpretation from dispersed connections. |
| An actor-and-exchange map as the primary reading | Not selected. The user chose decisive economic mechanisms in the foreground, anchored in the actors and workflow. |
| Condensing appraisals without new transversal interpretation | Not selected. The user retained reasoned connections that can produce an interpretation across the appraisals. |
| A separate unknowns map when no mechanism is sufficiently supported | Not selected for the prototype. A reasoned non-establishment finding is the retained alternative result. |

## Design and Verification Direction

Relationship reasoning, diagram construction, and note development belong together because they express one interpretation. The reference diagram and its explanation must preserve that meaning while presenting different levels of detail. Their coherence is part of the brick's responsibility.

Proposed functional verification: use retained appraisals sharing evidence, a dependency that qualifies an apparent advantage, a contested relationship, and an identified gap. Inspect whether the proposed diagram explains the economic mechanism, preserves conditions and objections, and exposes a traceable path to its inputs. Exercise the joint submission with a note that contradicts or uses a different basis from the diagram, and inspect the resulting diagnostic and correction path. Examine the effect of a returned appraisal outcome and the permitted scope of a limited result. With instructed retained appraisals that support no mechanism, inspect the non-establishment finding instead of a forced diagram. These checks remain to be designed and run.

Proposed visual exploration: use a frozen illustrative dossier to compare compositions. Check whether a reader can identify the principal mechanism, a decisive dependency, and a relevant uncertainty from the overview, then inspect their explanations and evidence. This must test the combined reading rather than appearance alone. Exact composition and detailed interactions remain open; no measured comprehension result is established.

## Open Decisions

- Define how to select the decisive mechanisms and an appropriate level of visual detail for the investigated case.
- Specify the representation and explanation of dependencies, conditions, opposing mechanisms, and unresolved relationships.
- Specify executable quality checks and evaluation for the retained submission criteria, including transversal reasoning and diagram-to-note fidelity.
- Explore the diagram's composition, accessible inspection, responsive behavior, and the note's reading experience.
- Specify the relationship between input versions, changing reasoning, and affected synthesis outputs within the shared revision model.
- Define the detailed contracts and correction records for the joint synthesis submission and alternative finding within the transversal operation catalogue.
