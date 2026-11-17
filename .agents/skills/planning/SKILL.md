---
name: planning
description: Prepare, revise, or review actionable plans grounded in existing behavior and ownership. Use for requests to plan a change, sequence implementation work, revise an active plan, or work in native Plan mode. Scale detail to risk and uncertainty. Do not trigger merely because an implementation request spans multiple files; explicitly requested writing-plans owns detailed plan drafting instead.
---

# Planning

Produce a plan that makes the next work executable and reviewable. Record the decisions an implementer needs, with enough evidence to preserve existing behavior and enough verification to judge the result. Scale detail to the change rather than filling a fixed template.

## When to Use

Use for planning requests, native planning sessions, and revisions or audits of an existing plan. Naming the skill is not required.

## When Not to Use

Carry out a direct, already-decided correction or an authorized implementation through its relevant workflow; task complexity alone does not require a separate planning phase. Use the selected conception or diagnosis workflow to resolve an unsettled product choice or unexplained defect before decomposing the dependent work.

When the user explicitly requests `writing-plans`, follow that detailed procedure instead. This skill does not depend on or automatically load it. Inspecting or editing either skill is not a request to use its plan-creation workflow.

## 1. Define the Outcome and Planning Depth

A plan is useful when its completion can be judged. State the intended result, affected scope, exclusions, and observable exit criteria from the request and accepted decisions. Separate the approved target from the change being planned now.

Use a few concrete steps for a local change. Expand boundaries, dependencies, failure cases, and handoff detail when the work crosses owners, changes durable state, or contains material uncertainty. Do not impose a section count, task count, or complete implementation bodies.

## 2. Reconstruct the Existing Behavior

Changes should extend the actual implementation rather than a remembered architecture. Inspect the affected code, routes, tests, current references, and working-tree changes. Record exact owners and file paths, the current behavior, and the evidence that establishes it. Inspect the existing browser surface when its appearance or interaction affects a planning decision.

For affected surfaces and contracts, distinguish what is preserved, modified, replaced, or removed. Attach evidence and the accepted decision to a proposed replacement or removal. Identify the shared owner of a rule before proposing another implementation. When moving existing operations, plan mechanical relocation before necessary rewriting so behavior remains traceable.

## 3. Resolve Decisions Without Inventing Requirements

An unresolved assumption can make every dependent task wrong. Distinguish verified facts, accepted decisions, and open questions. Resolve empirical questions through the narrowest relevant inspection or executable check. Ask the user only for a material intent or trade-off decision that available evidence cannot settle.

Leave dependent work explicitly blocked when its deciding question remains open; continue planning independent work. Do not freeze a guessed interface, schema, model capability, or product behavior into a task or test. Consult history for rationale without promoting it over current requirements.

## 4. Decompose Around Deliverable Behavior

Order tasks by their real dependencies and existing owners. Each task should deliver a coherent outcome that can be evaluated independently. Include the affected files, behavior to preserve, boundary or interface decisions needed by other tasks, and the check that establishes completion. Define exact names and signatures when another task depends on them; leave implementation choices open when they do not affect the contract.

Select verification using the repository's rules for the observable change. Name focused commands or browser scenarios and the expected evidence, including relevant failure cases. Distinguish checks already run from checks proposed for implementation. Specify the applicable external-I/O and recovery controls at the affected boundary without duplicating their policy across tasks. Keep deterministic, browser, and live-provider evidence distinct.

## 5. Choose and Maintain the Useful Support

Use the conversation or native plan state for short, local work. Use a file when execution across sessions, handoff, or the size of the plan makes persistent tracking useful. Honor an explicit support or location preference; otherwise choose a suitable location and state it without requiring a storage-approval round. Respect the repository's document locations and avoid retired directories or a new document series.

Reuse an existing active plan for the workstream instead of creating competing versions. Keep its decisions, pending tasks, and verified progress current. If a specific execution workflow has already been selected, check its required plan format before handoff rather than assuming every executor accepts the same structure.

When evidence invalidates an assumption, revise the affected tasks and any inaccurate owning reference before dependent implementation continues. Preserve completed work and unaffected decisions. On closure of a persistent plan, transfer verified delivery and outstanding work to the roadmap and retire the working plan while preserving relevant evidence.

## 6. Review and Hand Off

Before presenting the plan, check that every exit criterion has an owning task and appropriate evidence, dependencies and interface names agree, preserved behavior remains covered, and no open decision has become an implicit requirement. Remove steps that add no decision or deliverable.

Present the recommended sequence, unresolved blockers, verification, and any deliberate deferrals in proportion to the work. State the plan's support when a file or native plan was used. A proposed task is not delivered behavior, and a proposed check is not a successful result.
