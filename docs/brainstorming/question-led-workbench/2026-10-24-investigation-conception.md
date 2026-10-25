# Investigation: Retained Conception

## Status

Recorded on 2026-10-24 and updated on 2026-10-25. This document describes the retained functioning of Investigation. The [global conception](2026-10-23-question-led-workbench-conception.md) owns the overall sequence, shared inventory rules, and analyst review. Detailed execution rules and analytical quality verification remain open.

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

The caller supplies a framed dossier and available evidence. Investigation handles the analytical work across questions without requiring a separate analyst-managed inquiry for each one.

| Direction | Information crossing the interface |
| --- | --- |
| Input | Company and activity scope, framed questions, existing inventory, prepared documentary material with its provenance and usage restrictions, and applicable research constraints. |
| Re-examination input | An identified concern about an appraisal or its reasoning, the affected version, and the available evidence to reconsider. |
| Inventory contributions | Controlled assertions and their question-specific uses, with supporting references, reasoning, and limitations. |
| Documentary needs | Grouped requests explaining what information is missing, which questions it affects, and why it could change an interpretation. |
| Appraisals | A proposed appraisal for each framed question, with traceable reasoning and evidence dependencies. |
| Progress and inspection | Actual advancement, inspectable interpretations and control results, unresolved needs, and exceptions affecting the inquiry. |

The [cooperation sequence](2026-10-23-question-led-workbench-conception.md#cooperation-and-documentary-complement) governs documentary requests and returned material. [Sources](2026-10-24-source-ingestion-and-processing-conception.md) supplies the qualified material; Investigation expresses the analytical need without specifying retrieval operations.

## Internal Work by Principal Stage

### Exploit the Available Material

Investigation starts from the existing inventory and the prepared documentary material. It identifies what is useful for the framed questions, what can be reused, and which additional assertions are worth introducing into the common inventory. The work is organized around the dossier's shared knowledge rather than separate collections of assertions per question.

- Examine existing assertions and their scope, evidence, limitations, and relevance to the current questions before deriving new ones.
- Transform useful passages into explicit assertions, distinguishing what a source states from what the inquiry infers. Preserve the reasoning connecting an inference to its supporting material.
- Apply the [shared assertion and question-link controls](2026-10-23-question-led-workbench-conception.md#shared-company-inventory-and-evidence-matrix) to proposed contributions and their intended uses. Reuse the same underlying assertion when it informs several questions; retain a rationale for each use.
- Make relevant company context available alongside question-specific assertions. A contribution can situate the activity without answering a decisive question itself.

Investigation uses the documentary qualification and comparison results attached to the material. It does not repeat source preparation as a separate analytical pipeline. When material cannot support the intended use, the inquiry limits that use or identifies the missing information rather than treating source inclusion as sufficient support.

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

When asked to re-examine an appraisal, Investigation revisits the identified reasoning and its evidence, using the same inventory and analytical controls. It returns a proposed revision with an explanation of what changed, or explains why the concern does not warrant a revision. The [cooperation rules](2026-10-23-question-led-workbench-conception.md#synthesis-and-bounded-analytical-rework) own the trigger, bounds, and treatment of retained judgments.

## Autonomy and Optional Inspection

Investigation performs the three stages proactively. Routine interpretation work, inventory contributions, and identification of documentary needs do not require the analyst to coordinate internal operations. Exceptions are surfaced under the [shared intervention policy](2026-10-23-question-led-workbench-conception.md#launch-mandate-and-contextual-intervention).

Optional inspection exposes the assertions reused or introduced, the relationship between evidence and interpretation, relevant alternatives, objections, and the reasons for requesting more material. The analyst can challenge a use, correct an assertion, or redirect a question. The precise correction and revision mechanics remain to be designed with the shared inventory, rather than introduced as an Investigation-only policy.

## Design and Verification Direction

Investigation keeps inventory enrichment and question reasoning together because the assertions worth retaining emerge during the inquiry, and their usefulness depends on their intended analytical use. Its interface exposes contributions, documentary needs, and appraisals rather than asking the caller to orchestrate assertion extraction and separate reasoning passes. The three stages describe the work; they do not select a model-per-question arrangement, call count, or execution partition.

Proposed verification: use a bounded dossier with two questions sharing an assertion, material supporting a rival interpretation, and a missing fact that could affect both questions. Verify that the inquiry reuses the assertion with distinct use rationales, examines the rival interpretation, and expresses one grouped documentary need. Return additional qualified material and inspect whether the resulting appraisals explain its effect without losing their objections or limitations. Submit a targeted re-examination concern against an existing appraisal and verify that the response explains either the proposed change or the reason to preserve the interpretation. Analytical usefulness and control quality still need evaluation; this conception does not establish them.

## Open Decisions

- Define how to select useful inventory contributions and recognize reusable assertions without erasing meaningful differences in scope or interpretation.
- Specify analytical control criteria for assertion uses, causal reasoning, rival interpretations, and evidence-based explanations of appraisal strength.
- Define how documentary needs are prioritized by their potential effect on the framed questions and expressed without prescribing source-retrieval mechanics.
- Specify the inspection and correction interactions for reasoning and question-specific evidence uses, in coordination with the shared revision model.
- Choose the execution partition and meaningful progress states for the common inquiry, and define executable quality checks through its interface.
