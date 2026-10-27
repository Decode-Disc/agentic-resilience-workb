---
name: workbench-frontend-retro
description: Review frontend improvement sessions to draft evidence-backed improvements to workbench-frontend and its resources. Use only on explicit user invocation. Always present the exact proposed changes and wait for approval before writing.
---

# Workbench Frontend Retro

Turn verified frontend experience into useful improvements to workbench-frontend. Capture successful methods as well as corrections, while keeping permanent instructions focused and avoiding rules that merely retell a session.

## When to Use

Use only when the user explicitly invokes this skill to extract lessons from a frontend session or revisit lessons previously proposed. An optional focus narrows the review to a concern such as source presentation, controls, responsive behavior, copy, or verification.

Invocation authorizes investigation and a draft. It does not authorize writing the draft or applying changes.

## When Not to Use

Do not activate automatically after frontend work, repeated corrections, or a detected failure. Use the relevant specialist workflow for implementation, debugging, or ordinary code review.

Reviewing or editing this skill's instructions is skill maintenance, not an invocation of the retrospective workflow.

Do not turn a one-off preference, an unresolved explanation, or an incidental implementation detail into a general instruction.

## Scope and Output

The editing target is workbench-frontend: its SKILL.md, references, and relevant evaluation scenarios. Inspect the existing target before proposing changes.

Use [AGENTS.md](../../../AGENTS.md) for document authority, [PRODUCT.md](../../../PRODUCT.md) and [TECH.md](../../../context/TECH.md) for current requirements, and the [roadmap](../../../docs/ROADMAP.md) for delivery state. Consult [DESIGN.md](../../../DESIGN.md) when a lesson concerns presentation. Locate the relevant passages in those documents; a historical session or accepted ADR supplies context, not a replacement current contract.

Use the visible conversation, user feedback, repository changes, and available verification evidence. A session identifier or a focused concern may supplement those inputs.

Produce a concise explanation and the complete proposed text or exact diff in the conversation. “No useful change” is a valid result. Do not create a session journal, another instruction owner, or a permanent retrospective report.

## 1. Reconstruct the Useful Experience

A session can contain successful methods, failed attempts, and explanations that were never verified. Reconstruct what actually happened so reusable guidance rests on evidence rather than the most fluent account.

Inspect the relevant conversation, implementation, working and staged diffs, and completed checks. Extract:

- the analyst's intended outcome and the result actually obtained;
- successful action sequences and essential tools;
- user corrections, accepted decisions, and important exceptions;
- rejected approaches, observed failures, and verified causes;
- what was checked and what remains uncertain.

Use session history only when the visible conversation is incomplete. Prefer available read-only history tools or accessible local records. Do not resume, fork, or modify a source session to inspect it, or combine unrelated sessions without confirmation.

Treat explicit user preferences as preferences; causal claims require supporting evidence. If missing context prevents a reliable lesson, expose the gap and ask only the question needed to resolve it.

Complete this step when the useful process and its evidence are clear, with unresolved claims kept visible.

## 2. Select What Deserves a Durable Change

More instructions can make a skill harder to use without preventing the original failure. Select lessons that improve a future decision or execution step, then inspect how the current skill already handles them.

Before retaining a lesson, establish whether it is a reusable method, a restriction of the installed compatibility path, or guidance superseded by a later accepted decision. Preserve the useful method without promoting a temporary checkpoint into a target requirement. A successful check proves the exercised behavior, not that the earlier product direction remains current. Flag a needed product decision or reference correction at its existing owner instead of creating that rule inside the frontend skill.

For each candidate lesson, decide whether to:

- keep the existing guidance because it already covers the need;
- clarify an ambiguous condition, exception, or procedure;
- capture a verified reusable method that is currently missing;
- compress, replace, or remove guidance that duplicates or contradicts another passage;
- exclude a local choice or unresolved hypothesis from durable guidance.

If a clear instruction was ignored, do not add an equivalent instruction. Identify whether the difficulty came from discovering, understanding, or applying the existing guidance, and propose a change only when it addresses that difficulty.

Do not copy component APIs or values that the existing owner can supply reliably. Flag lessons belonging to a different instruction layer without expanding the editing scope.

Complete this step when every proposed change has evidence, a future use, and an existing destination.

## 3. Present the Exact Draft

A useful lesson still needs review before it becomes an instruction. Present the exact change so the user can judge both its benefit and its effect on existing guidance.

Use writing-skills for the drafting procedure. Prefer revising the relevant passage over appending another rule. Preserve useful rationale, triggers, exceptions, and boundaries.

For each proposed change, explain briefly:

- the evidence or accepted preference supporting it;
- what changes and where;
- why it improves future work;
- the smallest relevant validation.

Show the complete replacement for a short passage, or an exact diff for larger changes. Keep session-specific commentary outside the proposed instruction text. Add an evaluation scenario only when it can reveal a meaningful recurrence or boundary failure.

Always draft first. Do not write target files, save a draft file, or create supporting artifacts before the user approves the displayed proposal. A general request to improve or apply lessons is not approval of unseen changes.

Wait for explicit approval. If the user requests a substantive revision, show the revised draft and wait again. Approval of a subset covers only that subset.

Complete this step when the user has approved the exact changes and their scope, or has chosen to leave the skill unchanged.

## 4. Apply Only the Approved Changes

The reviewed draft defines the allowed change. Recheck the target diff before editing so concurrent or unrelated work is preserved.

Apply only the approved changes within workbench-frontend and its resources. If newer changes invalidate the reviewed draft, explain the conflict and present an updated proposal before applying it.

Do not change application behavior, other reference documents, dependencies, or other skills. Do not commit, publish, delegate, or launch model evaluations under this workflow alone.

## 5. Validate and Report

Structural correctness and behavioral improvement are different claims. Validate the changed artifacts without implying that a well-formed skill necessarily produces better decisions.

Check metadata, JSON when affected, links, referenced paths, and whitespace. Review the diff for duplication, lost exceptions, contradictory instructions, and unrelated changes. Use installed validators without installing dependencies merely to run a check.

Run comparative evaluations only when separately requested and authorized, using suitable equivalent executors and keeping outputs outside the application tree.

Report the changes made, the checks actually run, any incomplete validation, and the remaining uncertainty. Do not claim improved agent behavior without corresponding evidence.
