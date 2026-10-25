# Synthesis: Retained Conception

## Status

Recorded on 2026-10-25. The functional direction and three principal stages are accepted. Visual composition and immediate comprehensibility remain to be tested. The [global conception](2026-10-23-question-led-workbench-conception.md) owns workflow order, shared controls, analyst judgment, and cooperation between bricks.

## Purpose and Simple Workflow

Connect the retained appraisals into an interpretation of the investigated activity's economic position and resilience to agentic change. The economic mechanism diagram is the reference result; a derived, fully reasoned note develops the same interpretation. The diagram should create a compelling first impression through clear understanding of the decisive mechanisms, grounded in the actors and workflow.

```text
CONNECT THE APPRAISALS
          |
          v
BUILD AND TEST THE DIAGRAM
          |
          v
DEVELOP THE REASONED NOTE
```

## Interface

Synthesis takes an analytical base and returns a coherent visual and written interpretation. The caller does not coordinate separate operations for every relationship or paragraph. Exact records and execution partition remain to be designed.

| Direction | Information crossing the interface |
| --- | --- |
| Input | Company and activity scope, framed questions, retained appraisal versions, their reasoning and evidence dependencies, objections, and identified open or deferred questions. |
| Reference result | An economic mechanism diagram with meaningful relationships, traceable reasoning, supporting appraisals and evidence, conditions, and limitations. |
| Derived result | An argued note explaining the diagram's interpretation, economic implications, support, objections, unknowns, and conditions that could change the reading. |
| Re-examination concern | The affected appraisal and interpretation, the reasoning problem, and the existing elements that motivate reconsideration. |
| Progress and inspection | Actual advancement, relationship explanations and control results, unresolved limitations, and affected outputs when an input changes. |

[Investigation](2026-10-24-investigation-conception.md) supplies the question-level appraisals. The [global cooperation rules](2026-10-23-question-led-workbench-conception.md#synthesis-and-bounded-analytical-rework) determine how retained inputs and analytical returns are handled.

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

Synthesis resolves issues in its own reasoning where the existing analytical base permits it. If an appraisal itself needs reconsideration, the brick expresses a focused concern through its interface and uses the returned outcome under the cooperation rules. Any unresolved effect remains visible in the diagram and its explanation.

### Develop the Reasoned Note

The note develops the interpretation represented by the reference diagram with the depth of a standalone argued analysis. It explains why the mechanisms matter economically, how the appraisals and evidence support that reading, which objections constrain it, and what unknowns or changes could overturn it.

The note can develop nuances and evidence that do not fit in the visual overview. It remains consistent with the diagram's underlying reasoning and conditions; a change to the interpretation must be reflected in both outputs.

The reader should be able to move from an economic implication to the relevant mechanism, appraisal, and evidence. A visually concise diagram and a detailed note therefore express the same analysis at different levels of depth.

## Autonomy and Optional Inspection

The three stages advance autonomously under the [review and completion rules](2026-10-23-question-led-workbench-conception.md#appraisal-grouped-review-and-completion). System work checks the diagram's relationships and the note's fidelity rather than asking the analyst to confirm every connection or paragraph.

The available result supports a quick overall reading, then optional inspection of a mechanism and its evidence. The analyst can challenge a relationship or interpretation. The precise navigation, correction interactions, and visual treatment of changing inputs remain to be designed.

## Alternatives Considered

| Alternative | Outcome and reason |
| --- | --- |
| A reasoned note as the primary result | Initially recommended by the agent, not selected by the user. The diagram was chosen as the reference to make the mechanisms immediately understandable; the note retains full argumentation. |
| Cross-appraisal relationships without a standalone overall result | Not selected. The user chose a reference diagram and derived note rather than requiring the reader to reconstruct the overall interpretation from dispersed connections. |
| An actor-and-exchange map as the primary reading | Not selected. The user chose decisive economic mechanisms in the foreground, anchored in the actors and workflow. |
| Condensing appraisals without new transversal interpretation | Not selected. The user retained reasoned connections that can produce an interpretation across the appraisals. |

## Design and Verification Direction

Relationship reasoning, diagram construction, and note development belong together because they express one interpretation. The reference diagram and its explanation must preserve that meaning while presenting different levels of detail. Their coherence is part of the brick's responsibility.

Proposed functional verification: use retained appraisals sharing evidence, a dependency that qualifies an apparent advantage, a contested relationship, and an identified gap. Inspect whether the proposed diagram explains the economic mechanism, preserves conditions and objections, and exposes a traceable path to its inputs. Compare the note with that reference and check that its added depth does not introduce an unsupported or conflicting interpretation. Exercise a returned appraisal outcome and inspect its effect on the synthesis. These checks remain to be designed and run.

Proposed visual exploration: use a frozen illustrative dossier to compare compositions. Check whether a reader can identify the principal mechanism, a decisive dependency, and a relevant uncertainty from the overview, then inspect their explanations and evidence. This must test the combined reading rather than appearance alone. Exact composition and detailed interactions remain open; no measured comprehension result is established.

## Open Decisions

- Define how to select the decisive mechanisms and an appropriate level of visual detail for the investigated case.
- Specify the representation and explanation of dependencies, conditions, opposing mechanisms, and unresolved relationships.
- Define executable quality checks for transversal reasoning and diagram-to-note fidelity, using the shared control principles.
- Explore the diagram's composition, accessible inspection, responsive behavior, and the note's reading experience.
- Specify the relationship between input versions, changing reasoning, and affected synthesis outputs within the shared revision model.
