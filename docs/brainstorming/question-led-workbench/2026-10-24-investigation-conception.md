# Investigation: Retained Conception

## Status

Recorded on 2026-10-24, with functional revisions through 2026-10-26. This document preserves Investigation's design rationale alongside the [global conception](2026-10-23-question-led-workbench-conception.md). [PRODUCT.md](../../../PRODUCT.md#assessment-and-review) owns the current inquiry/review behavior; [TECH](../../../context/TECH.md#semantic-controls-and-analytical-outputs) owns enforcement.

Status reviewed on 2026-10-30: the shared runtime is implemented, but Investigation's inventory/appraisal bindings and analytical quality acceptance are undelivered. The appraisal-control contract is priority design work before its operation is integrated; [the roadmap](../../ROADMAP.md#phase-8--investigation-and-grouped-appraisal-review) records that work.

## Purpose and Simple Workflow

Turn the available documentary material and company inventory into reasoned appraisals of the framed questions. Investigation conducts a common inquiry into the dossier, enriching and reusing shared knowledge while keeping each question's interpretation distinct.

```text
EXPLOIT THE AVAILABLE MATERIAL
              |
              v
TEST THE INTERPRETATIONS
              |
              v
PROPOSE THE APPRAISALS
```

## Interface

The caller supplies a framed dossier and available evidence. A specialized Investigation agent conducts the common inquiry using the [transversal operation catalogue](2026-10-23-question-led-workbench-conception.md#transversal-operation-catalogue). The two artifact families below form the mission result; documentary requests and re-examination outcomes apply when needed.

| Direction | Information crossing the interface |
| --- | --- |
| Input | Company and activity scope, framed questions, existing inventory, prepared documentary material with its provenance and usage restrictions, and applicable research constraints. |
| Re-examination input | A concern about an appraisal or an uninstructed new premise needed by Synthesis, the affected question or mechanism, existing evidence references, and the appraisal version when applicable. |
| Inventory artifact | References to controlled assertions reused, added, or corrected in the shared inventory and their question-specific uses, with evidence, reasoning, and limitations. |
| Documentary needs, when required | Grouped requests explaining what information is missing, which questions it affects, and why it could change an interpretation, retained with their outcome. |
| Appraisal artifact | A proposed reasoned appraisal for each framed question, including justified insufficiency where necessary, with traceable reasoning and evidence dependencies. |
| Re-examination outcome, when requested | A justified inventory contribution when needed, the effect on the appraisals, and a proposed revision or justification for maintaining them, tied to the examined basis. |
| Progress and inspection | Actual advancement, inspectable interpretations and control results, unresolved needs, and exceptions affecting the inquiry. |

The [cooperation sequence](2026-10-23-question-led-workbench-conception.md#cooperation-and-documentary-complement) governs documentary requests and returned material. Sources (`docs-checkpoint-2026-11-18:docs/brainstorming/question-led-workbench/2026-10-24-source-ingestion-and-processing-conception.md`) supplies the qualified material; Investigation expresses the analytical need without specifying retrieval operations.

## Internal Work by Principal Stage

### Exploit the Available Material

Investigation starts from the existing inventory and the prepared documentary material. It identifies what is useful for the framed questions, what can be reused, and which additional assertions are worth introducing into the common inventory. The work is organized around the dossier's shared knowledge rather than separate collections of assertions per question.

- Examine existing assertions and their scope, evidence, limitations, and relevance to the current questions before deriving new ones.
- Transform useful passages into explicit assertions, distinguishing what a source states from what the inquiry infers. Preserve the reasoning connecting an inference to its supporting material.
- Apply the [shared assertion and question-link controls](2026-10-23-question-led-workbench-conception.md#shared-company-inventory-and-evidence-matrix) to proposed contributions and their intended uses. Reuse the same underlying assertion when it informs several questions; retain a rationale for each use.
- Make relevant company context available alongside question-specific assertions. A contribution can situate the activity without answering a decisive question itself.

Investigation uses the documentary qualification and comparison results attached to the material. It does not repeat source preparation as a separate analytical pipeline. When material cannot support the intended use, the inquiry limits that use or identifies the missing information rather than treating source inclusion as sufficient support.

#### Inventory Admission Controls

The inventory-contribution operation applies the [shared admission criteria](2026-10-23-question-led-workbench-conception.md#shared-company-inventory-and-evidence-matrix) to new assertions and question-specific uses arising from the inquiry. Investigation reuses valid documentary controls while justifying its new analytical contribution; it does not rerun Sources' preparation.

The common reuse rules (`docs-checkpoint-2026-11-18:docs/brainstorming/question-led-workbench/2026-10-26-agentic-execution-architecture.md#reuse-of-controlled-results`) distinguish an unchanged reference from a modified assertion or new use. Admission of a shared assertion does not establish the later economic reasoning of every appraisal that cites it.

### Test the Interpretations

Investigation examines what the evidence permits it to say about the economic question. It connects observations to a proposed mechanism, tests that interpretation against objections, and distinguishes a plausible account from a supported one. Questions about control, dependencies, substitution, or value capture may be relevant depending on the case; they do not form a new mandatory grid.

- Compare the proposed interpretation with relevant alternatives and opposing evidence. A source's own argument is an input to examine, not the inquiry's conclusion by default.
- Identify which assumptions connect the observed facts to the economic consequence, and where those assumptions remain unsupported or contested.
- Keep the investigated activity, participants, and relevant period explicit. Evidence about one workflow cannot automatically establish a company-wide position.
- Identify missing information that could change the interpretation, rather than collecting material merely to increase coverage. Explain the affected question, the uncertainty, and the expected analytical value of resolving it.
- Group overlapping documentary needs across questions. A shared missing fact should produce a coherent request rather than repeated requests from independent question workflows.

When additional material returns through the cooperation sequence, Investigation reassesses the affected assertions, uses, and interpretations. It records whether that material strengthens, weakens, qualifies, or leaves the proposed interpretation unchanged, with the reason. A requested answer that remains unavailable stays visible as a limitation rather than being replaced by an unsupported inference.

### Propose the Appraisals

Investigation turns the common inquiry into a distinct proposed response for each framed question, using the [retained appraisal format](2026-10-23-question-led-workbench-conception.md#appraisal-grouped-review-and-completion). Each response should make the reasoning from shared assertions to the interpretation understandable, with the relevant support, objections, and unresolved information accessible together.

The appraisals explain how their evidence and limitations affect the interpretation. They reuse shared assertions while preserving question-specific reasoning: the same observation may support one interpretation, constrain another, or provide context only. An appraisal about the selected activity remains attached to that scope.

Where the inquiry cannot support a substantive answer, Investigation explains what was examined and why the evidence is insufficient. Unperformed analytical work or an unavailable execution capability remains distinguishable from that outcome under the global completion rule. The proposed appraisals are offered for the [grouped review at Investigation output](2026-10-23-question-led-workbench-conception.md#appraisal-grouped-review-and-completion); their use by [Synthesis](2026-10-25-synthesis-conception.md) follows the overall workflow.

When receiving a targeted request, Investigation examines the identified reasoning or new premise against the available evidence and shared controls. It submits an inventory contribution when justified, assesses the effect on the relevant appraisals, and returns a proposed revision with an explanation of what changed or why no revision is warranted. The [cooperation rules](2026-10-23-question-led-workbench-conception.md#synthesis-and-bounded-analytical-rework) own the trigger, bounds, and treatment of retained judgments.

#### Appraisal Submission Controls

At submission, semantic control examines the reasoning from assertions through assumptions and mechanisms to the economic conclusion, the treatment of examined objections and alternative interpretations, and whether unknowns actually limit the conclusion. It reuses valid inventory and documentary controls rather than repeating their earlier work. A justified insufficiency remains a possible analytical result after instruction; it is not a substitute for unfinished investigation.

Design arbitration on 2026-10-30 selected typed, scoped semantic findings under deterministic domain disposition. A new appraisal is either admissible for grouped review or returned for required revision; technical incompleteness remains separate, and later restriction applies only to an already usable result. [TECH](../../../context/TECH.md#analytical-control-and-question-outcome-contracts) owns the accepted target contract and [ADR-026](../../decisions/026-use-typed-analytical-controls-and-materialized-question-outcomes.md) preserves the alternatives. The operation and its semantic evaluation remain unimplemented.

## Autonomy and Optional Inspection

The mission agent uses its available operations to adapt the inquiry and revisit interpretations as evidence requires, under the common execution contract (`docs-checkpoint-2026-11-18:docs/brainstorming/question-led-workbench/2026-10-26-agentic-execution-architecture.md#shared-mission-contract`). Exceptions follow the global intervention policy; the [mission completion contract](2026-10-23-question-led-workbench-conception.md#mission-completion-contract) governs when the submitted artifacts allow progression. Challenged uses and dependent appraisals follow the [global re-examination rules](2026-10-23-question-led-workbench-conception.md#retained-judgments-and-pending-revisions).

Optional inspection exposes the assertions reused or introduced, the relationship between evidence and interpretation, relevant alternatives, objections, and the reasons for requesting more material. The analyst can challenge a use, correct an assertion, or redirect a question. The precise correction and revision mechanics remain to be designed with the shared inventory, rather than introduced as an Investigation-only policy.

## Design and Verification Direction

Investigation keeps inventory enrichment and question reasoning together because the assertions worth retaining emerge during the inquiry, and their usefulness depends on their intended analytical use. Its interface exposes contributions, documentary needs, and appraisals rather than asking the caller to orchestrate assertion extraction and separate reasoning passes. As of 2026-10-30, the common execution runtime is selected and implemented; Investigation's operation bindings, artifact contracts, model route and semantic evaluation remain open.

Proposed verification: use a bounded dossier with two questions sharing an assertion, material supporting a rival interpretation, and a missing fact that could affect both questions. Verify that the inquiry reuses the assertion with distinct use rationales, examines the rival interpretation, and expresses one grouped documentary need. Return additional qualified material and inspect whether the resulting appraisals explain its effect without losing their objections or limitations. Submit targeted requests about an existing appraisal and a new premise found in retained material; inspect admission controls and the explanation of any effect on the appraisals. Analytical usefulness and control quality still need evaluation; this conception does not establish them.

## Open Decisions

- Define how to select useful inventory contributions and recognize reusable assertions without erasing meaningful differences in scope or interpretation.
- Define the closed appraisal-finding schema, versioned thresholds and evaluation cases within [TECH's accepted control contract](../../../context/TECH.md#analytical-control-and-question-outcome-contracts); translate inventory-admission criteria through their existing domain owner.
- Define how documentary needs are prioritized by their potential effect on the framed questions and expressed without prescribing source-retrieval mechanics.
- Specify the inspection and correction interactions for reasoning and question-specific evidence uses, in coordination with the shared revision model.
- Specify how the Investigation mission uses its shared operations and artifact contracts, including meaningful progress and executable quality checks through the interface.
