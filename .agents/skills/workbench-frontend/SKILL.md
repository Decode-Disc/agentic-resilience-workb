---
name: workbench-frontend
description: Plan, build, change, or review Agentic Resilience Workbench interfaces around the analyst's economic question, inspectable reasoning, and useful next action. Distinguish delivered behavior from the approved target, reuse existing owners, and verify the affected surface. Use for frontend composition, copy, controls, navigation, and styling, including small fixes. Excludes backend-only work.
---

# Workbench Frontend

Make the economic question, interpretation, evidence and next useful action understandable to the analyst. Keep the procedure proportional to the change.

## When to Use

Use for frontend planning, implementation, or review in this project, including small corrections and confusing labels or states. Start with the analyst's task so component reuse and verification support a useful result. For a local fix, inspect the affected owners and callers; for recomposition or workflow changes, inspect the broader interaction.

## When Not to Use

Skip for backend-only work, dependency management alone, or unrelated documentation. If a narrower specialist procedure already owns the task, use this skill only for relevant project integration checks; do not restart discovery, request new mockups, or impose a redesign.

## Establish the reference

Changes can preserve the code's behavior while losing the intended analyst experience. Establish the current task and accepted baseline first so the proposed change addresses the actual difficulty. For an existing surface, reconstruct its behavior; for a new one, use the product contract and closest relevant pattern without inventing a baseline.

- Inspect the working diff, affected route/view, and closest existing pattern. State what the analyst needs to understand, inspect, or decide after the change. A technical score or a larger number of passing tests does not establish that outcome.
- Separate **delivered behavior**, established by the working tree, runtime and [roadmap](../../../docs/ROADMAP.md), from the **approved target** in [PRODUCT.md](../../../PRODUCT.md) and relevant [technical contracts](../../../context/TECH.md), and from the **change authorized** by the request and repository instructions. Reuse context already gathered. A target requirement does not certify delivery or authorize its implementation.
- For research-journey changes, use the current product document to locate the affected framing, inventory, appraisal-review or synthesis responsibility. Source-review examples below locate existing code; they do not prescribe the target workflow or its main result.
- For an existing surface, identify what is preserved and what the request changes. Compare the running surface with the accepted reference, including interactions, disclosures, mobile behavior, and failure states. Preserve unaffected affordances without turning every installed behavior into a future requirement. Apply the repository's surface classification for substantial changes and explain conflicts before choosing a new composition.
- Recheck the underlying behavior when feedback changes the diagnosis or recommendation.

Consult [TECH.md](../../../context/TECH.md) for the transition when current guards differ from the target. In particular, source-set approval belongs to the compatibility path described in [PRODUCT.md](../../../PRODUCT.md); do not carry that stop into a new target view by default. A UI edit cannot remove an enforced prerequisite before its replacement is implemented and verified.

## Find the existing owners

Independent implementations make labels, state handling, and appearance drift across surfaces. Locate the owner before extending it so one shared rule has one maintenance path. Share behavior that must evolve together, while leaving consumer-specific composition local.

Read only the local reference matching the task:

| Concern | Reference |
| --- | --- |
| Styling, controls, feedback, badges, motion, or shared presentation | [Components and ownership](references/components-and-ownership.md) |
| Labels, counts, evidence states, action wording, or redundant metadata | [Analyst language and meaning](references/analyst-language.md) |
| Async work, recovery, approval, navigation, or verification scope | [Workflow and verification](references/workflow-and-verification.md) |

For styling changes, use the [style ownership procedure](references/components-and-ownership.md#maintain-style-ownership) before general-purpose implementation examples: a utility-first example does not select this project's stylesheet architecture or justify normalizing approved measurements.

Inspect the real owner's API, a relevant caller, and existing tests before adding logic. For substantial work, summarize **analyst need → owner and callers → scoped change → observable check** in the conversation; a small correction needs no separate artifact. Extend the owner when the same rule must change together. Keep a consumer's geometry or placement in that consumer.

For question-led presentation, inspect the reusable `src/components/workbench-ui` library, shared `src/components/ui` primitives and the affected workflow owners. Reuse an adequate installed component first. For additional AI conversation and agentic presentation capabilities, prefer assistant-ui from the configured `@assistant-ui` registry, adapted to the project's visual system and approved composition. Use the [shadcn](../shadcn/SKILL.md) procedure and its MCP for registry discovery and source inspection when available. Follow the [component reference](references/components-and-ownership.md) to inspect runtime integration, introduced styles, dependencies and primitive changes before adoption.

Load specialist procedures only for their responsibility:

| Work | Skill |
| --- | --- |
| Visual exploration, composition, or polish | [Impeccable](../impeccable/SKILL.md) |
| Task order, progressive disclosure, or recovery | [Better UX Flow](../better-ux-flow/SKILL.md) |
| UI implementation or accessibility | [Frontend UI Engineering](../frontend-ui-engineering/SKILL.md) |
| Installed primitives and component APIs | [shadcn](../shadcn/SKILL.md) |
| Motion behavior | [Motion React](../motion-react/SKILL.md) |

## Check meaning and composition together

Individually accurate labels can still form a confusing screen. The intended result is a coherent explanation of what is available and what the analyst can decide, because understanding depends on the combined text, hierarchy, and actions. Apply the semantic checks when meaning changes and the composition checks when visibility or layout changes.

- Review the actual English text the analyst will encounter, including accessible names, alerts, disabled reasons, and terminal outcomes. Use the language reference whenever that meaning changes.
- When presenting an appraisal or synthesis, make the question and current interpretation understandable before the supporting taxonomy. Check how the analyst reaches support, objections, decisive unknowns and economic implications without reconstructing the argument from a list of assertions. Follow the owning product section rather than inventing a fixed layout or a new assessment scale.
- For each visible badge, count, or status, identify its input, what it establishes, and the decision it helps. Compare adjacent information and the same concept on other surfaces. Remove or disclose redundant detail before adding explanatory paragraphs.
- Check that label, color, icon, placement, and action tell the same story. Distinguish evidence availability, analytical support, proposed judgment and human adoption using their authoritative contracts; apply source-category and selection distinctions where those are the affected concepts.
- Put the information needed for a decision where the analyst can inspect it before acting. Keep reusable help separate from a source's specific limitation. Preserve useful detail through disclosure rather than making every category equally prominent.
- Use realistic long titles, missing metadata, partial readings, and unavailable states when checking composition. Approved mockups establish intended design; inspect the delivered behavior separately.

## Verify and report the result

Code checks, rendered examples, and real preparation establish different facts. Use the workflow reference to select checks that can expose the affected failure. Verify the affected protected path when its behavior changes; identify unavailable access or data as an incomplete check.

For library changes, distinguish gallery fidelity from integration into an actual screen. The gallery's illustrative callbacks do not establish saved judgments or workflow transitions. When connecting a component, verify the consumer's real data and operation boundary as well as its rendered composition.

Review the diff for duplicated rules and unrelated changes. Report the user-visible outcome, owners changed, exact checks run, browser states inspected, and remaining uncertainty. Keep fixture, protected-runtime, and live-provider evidence distinct. Do not claim visual acceptance or analytical quality from automated checks.
