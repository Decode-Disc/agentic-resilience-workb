---
name: workbench-frontend
description: Plan, build, change, or review Agentic Resilience Workbench interfaces with verified component reuse, analyst-readable copy, coherent evidence states, and focused browser checks. Use for frontend composition, controls, navigation, styling, and consistency, including small fixes. Excludes backend-only work.
---

# Workbench Frontend

Make the analyst's task and the available evidence understandable through the existing interface. This skill supplies a work sequence, not another product contract, design system, or permission to redesign. Keep the procedure proportional to the change.

## Establish the reference

- Inspect the working diff, affected route/view, and closest existing pattern. State what the analyst needs to understand, inspect, or decide after the change. A technical score or a larger number of passing tests does not establish that outcome.
- Read [PRODUCT.md](../../../PRODUCT.md), relevant [technical contracts](../../../context/TECH.md), [DESIGN.md](../../../DESIGN.md), and the current delivery state in [the roadmap](../../../docs/ROADMAP.md). Follow [AGENTS.md](../../../AGENTS.md) for scope, authority, and verification. Reuse context already gathered.
- For an existing surface, identify what is preserved and what the request changes. Compare the running surface with the accepted reference, including interactions, disclosures, mobile behavior, and failure states. Explain conflicts rather than silently choosing a new composition.
- Keep planning and review read-only until implementation is authorized. User feedback is evidence of a problem, not automatic approval of the first proposed remedy. Recheck the underlying behavior before changing the recommendation.

## Find the existing owners

Read only the local reference matching the task:

| Concern | Reference |
| --- | --- |
| Controls, feedback, badges, motion, or shared presentation | [Components and ownership](references/components-and-ownership.md) |
| Labels, counts, evidence states, action wording, or redundant metadata | [Analyst language and meaning](references/analyst-language.md) |
| Async work, recovery, approval, navigation, or verification scope | [Workflow and verification](references/workflow-and-verification.md) |

Inspect the real owner's API, a relevant caller, and existing tests before adding logic. For substantial work, summarize **analyst need → owner and callers → scoped change → observable check** in the conversation; a small correction needs no separate artifact. Extend the owner when the same rule must change together. Keep a consumer's geometry or placement in that consumer.

Load specialist procedures only for their responsibility:

| Work | Skill |
| --- | --- |
| Visual exploration, composition, or polish | [Impeccable](../impeccable/SKILL.md) |
| Task order, progressive disclosure, or recovery | [Better UX Flow](../better-ux-flow/SKILL.md) |
| UI implementation or accessibility | [Frontend UI Engineering](../frontend-ui-engineering/SKILL.md) |
| Installed primitives and component APIs | [shadcn](../shadcn/SKILL.md) |
| Motion behavior | [Motion React](../motion-react/SKILL.md) |

Repository conventions take precedence over generic examples, including test locations, state ownership, and abstraction choices. A file's length alone does not justify splitting it. Follow the repository's Convex guidance if the authorized change reaches backend code.

## Check meaning and composition together

- Review the actual English text the analyst will encounter, including accessible names, alerts, disabled reasons, and terminal outcomes. Use the language reference whenever that meaning changes.
- For each visible badge, count, or status, identify its input, what it establishes, and the decision it helps. Compare adjacent information and the same concept on other surfaces. Remove or disclose redundant detail before adding explanatory paragraphs.
- Check that label, color, icon, placement, and action tell the same story. Distinguish category, selection, preparation, documentary contribution, and human approval using their authoritative contracts.
- Put the information needed for a decision where the analyst can inspect it before acting. Keep reusable help separate from a source's specific limitation. Preserve useful detail through disclosure rather than making every category equally prominent.
- Use realistic long titles, missing metadata, partial readings, and unavailable states when checking composition. Approved mockups establish intended design; inspect the delivered behavior separately.

## Verify and report the result

Apply the repository's functional TDD and presentation-only browser rules. Use the workflow reference to select the smallest relevant checks. Verify the affected protected path when its behavior changes; identify unavailable access or data as an incomplete check.

Review the diff for duplicated rules and unrelated changes. Report the user-visible outcome, owners changed, exact checks run, browser states inspected, and remaining uncertainty. Keep fixture, protected-runtime, and live-provider evidence distinct. Do not claim visual acceptance or analytical quality from automated checks.

## Maintain the skill

[Evaluation scenarios](evals/evals.json) exercise realistic read-only requests drawn from recurring project failures. Check reference paths, JSON, and skill structure after edits. These checks do not establish behavioral improvement. Run comparative or delegated evaluations only when requested and authorized; keep their outputs outside the application tree.
