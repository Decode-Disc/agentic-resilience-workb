---
name: implementation-plan
description: Opt-in project overlay for creating, revising, or auditing a formal implementation plan for this evidence-workbench repository. Use only when the user explicitly invokes implementation-plan or explicitly asks to use the project implementation-plan skill. Do not trigger for ordinary planning, native Plan mode, task decomposition, multi-step work, provider integration, or roadmap discussion unless the user names this skill. When invoked, extend the principal writing-plans skill with scope preservation, existing-UI fidelity, durable-workflow safety, access-code journeys, copy boundaries, and end-to-end verification gates.
compatibility: Requires repository access and the principal writing-plans skill. Uses project documentation, Git, tests, and read-only browser inspection when an existing user-facing surface is affected.
---

# Implementation Plan

Create an executable plan that preserves the user's product and identifies the smallest useful delivery slice. This skill extends the principal `writing-plans` procedure with the repository's scope, ownership and verification rules. Keep concrete interfaces, test outcomes and commands while scaling the plan to the actual change.

## When to Use

This skill is opt-in. Use the AI harness's native planning mode by default, even when work has multiple steps, affects several files, crosses Convex and TanStack boundaries, or would benefit from careful sequencing. Load this skill only when the user explicitly names `implementation-plan` or explicitly asks to use the project implementation-plan skill. Do not infer invocation from requests such as “plan this”, “what should be next?”, “break this down”, or “use planning mode”.

The principal `writing-plans` skill is also opt-in outside this overlay. Explicitly invoking `writing-plans` alone uses that principal skill without automatically loading this project overlay. Explicitly invoking `implementation-plan` loads `writing-plans` first because the overlay depends on it.

## When Not to Use

Use native planning for ordinary sequencing, local fixes and roadmap discussion unless this overlay is explicitly requested. Reviewing or editing this skill does not invoke its plan-creation workflow. A planning request does not authorize implementation, deployment, paid experiments or delegation.

## Required base skill

1. After the user explicitly invokes this skill, read the principal `writing-plans` skill completely before drafting.
2. Apply this skill after it. Repository contracts govern document storage, applicable TDD, verification and execution authority when an inherited template differs. Do not copy a fixed plan directory, automatic commit step or delegation instruction from a base example into the plan.
3. If `writing-plans` is unavailable, stop and report the missing dependency. Do not silently recreate an approximate version from memory.

## Authority and mode

- Read [AGENTS.md](../../../AGENTS.md) and [PRODUCT.md](../../../PRODUCT.md) before product planning. Locate relevant technical contracts in [TECH.md](../../../context/TECH.md), use [DESIGN.md](../../../DESIGN.md) for interface changes, and consult the [roadmap](../../../docs/ROADMAP.md) for delivery and sequence. Use [PROJECT.md](../../../context/PROJECT.md) only when deeper candidature context is needed.
- Current requirements belong to those reference owners. ADRs and brainstorming records supply dated rationale, not additional current obligations or renewed execution permissions. Surface a conflict between current references before planning the affected change.
- Inspect `git status`, relevant history, current routes, production modules, tests, and generated contracts before proposing files.
- A plan is documentation. Do not implement it unless the user separately authorizes implementation.

Draft in the conversation unless a persistent plan is explicitly requested and its location is agreed. Keep at most one active plan per authorized workstream. On closure, transfer verified delivery and outstanding work to the roadmap at capability level, then retire the plan according to repository policy. This skill supplies no default storage location or permission to create a document series.

## Step 1: Reconstruct the current state

Do not plan from filenames or recalled architecture alone.

For each affected boundary, record evidence for:

- current public behavior and user journey;
- current owner of data, policy, copy, styling, and interaction state;
- current route and generated API names;
- current tests and their actual baseline result;
- current browser appearance when a user-facing surface already exists;
- uncommitted user changes that the implementation must preserve.

Create an affected-surface table:

| Surface or contract | Current owner | Direction | Evidence |
|---|---|---|---|
| Existing page or component | Exact file/module | Preserve/modify/replace/remove | Code, test, browser, or explicit decision |

Default every existing surface to `preserve`. `Replace` and `remove` require an explicit product decision, not an implementation preference.

Distinguish delivered behavior from the approved target and the change authorized now. Existing corpus checkpoints and dimension records describe compatibility obligations where still enforced; they do not define the target's framing, delegated preparation, question-led appraisals or synthesis. Consult the current references for the transition and its verification before proposing to replace a guard or migrate persisted data.

## Step 2: Close product decisions before task decomposition

Separate the user's intended outcome from a proposed implementation. Resolve or mark as blocked every decision that can materially change:

- the visible user journey or navigation;
- access, roles, reconnection, and protected-route behavior;
- lifecycle states, checkpoints, revisions, or analyst authority;
- persistence ownership or workflow orchestration;
- provider routing, fallback, retries, cost, or security;
- existing UI structure, motion, shared primitives, or product copy;
- the difference between unsupported transport and supported intent.

Examples:

- Excluding local file upload does not remove public HTTPS references.
- Connecting a composer to real data does not authorize redesigning it.
- A provider being free does not remove application rate limits or telemetry.
- A reusable access code is not a one-time invitation and must support the documented logout/reconnection journey.

If implementation evidence invalidates an accepted assumption, identify the affected requirement and its reference owner before continuing the dependent task. Obtain an explicit decision for a material product or architecture change, revise the owning passage, and use an ADR only when durable rationale or meaningful rejected alternatives warrant one. Independent work can continue within established authority.

## Step 3: Define the preservation contract

For every existing user-facing surface, the plan must name:

- exact components and shared primitives to preserve;
- layout hierarchy and responsive breakpoints to preserve;
- hover, focus, keyboard, loading, empty, error, and reduced-motion states;
- visual references supplied by the user, including required component slots;
- copy that changes and copy that must remain untouched;
- the browser baseline to capture before implementation;
- the explicit visual differences expected after implementation.

Do not use `refactor`, `reuse`, or `fold into production` as permission to recompose an interface. If no visual change is required, say so directly in the task and verify the affected observable behavior and relevant browser states. Presentation-only changes use browser comparison without manufactured CSS, pixel or SVG tests; functional changes retain TDD.

Shared primitives stay neutral. Put a one-screen z-index, width, animation, or copy choice in the consumer unless multiple consumers already share the stable responsibility.

Distinctive loaded components require isomorphic loading states. A plan for a cutout card, evidence matrix, or review panel must preserve its meaningful regions in the skeleton rather than specify a generic rectangle.

## Step 4: Lock runtime and ownership boundaries

State which runtime owns each operation:

- TanStack Start: React rendering, routing, SSR, and request-scoped web needs;
- Convex queries: reactive owner-authorized projections;
- Convex mutations: deterministic atomic persistence and transitions;
- Convex actions: authenticated external I/O orchestration;
- Convex Workflow: durable steps, retries, cancellation, and human checkpoints;
- integration adapters: transport and mapping without database authority;
- presentation helpers: user-facing labels, consequences, and next actions.

When planning Convex work, read `convex/_generated/ai/guidelines.md`. Avoid a TanStack server-function proxy when the generated Convex client is the intended public boundary.

For a model-assisted task, use the current policy in TECH.md to state its purpose, why semantic interpretation or reasoning is needed, its allowed inputs and output use, and its bounded execution conditions. Keep reliable lookups, validation and transitions deterministic. Do not infer a phase-wide AI prohibition from an old source-review sequence, or use model assistance as permission to start research before its human prerequisite.

## Step 5: Specify durable external-I/O safety

Every external-provider or URL-retrieval task must define and test:

1. authorization before DNS, SDK, or HTTP work;
2. strict input and output validation;
3. rate, breadth, timeout, size, decompression, and cost limits;
4. application-owned retry and fallback policy;
5. an operation key containing the stable execution identity;
6. an execution lease bound to run, workflow version, generation, corpus revision, step, and attempt where applicable;
7. active-generation checks before the call and before persistence;
8. cancellation behavior and rejection of late results;
9. atomic running-slot acquisition on resume;
10. typed missing-configuration, partial-failure, blocked, and review outcomes;
11. provider-call telemetry without secrets or unnecessary prompt content;
12. deterministic adapter tests and any necessary, separately authorized bounded live verification.

For URL fetching, authorize first, validate every redirect, and connect to the public address that was validated. A validation lookup followed by an unrelated DNS resolution is not SSRF protection.

## Step 6: Use stable identity in examples

Do not make plans depend on mutable external labels. For SEC companies, use CIK as canonical identity. Treat ticker and legal name as revalidated metadata.

- Deterministic tests may pin fixture-owned values.
- Live contracts should assert identity and response shape without assuming a ticker can never change.
- Provider model names, prices, availability, and metadata receive the same treatment unless explicitly version-pinned configuration owns them.

## Required plan structure

For an explicitly requested persistent plan, use only the agreed location. Organize the following concerns in proportion to the slice; combine related sections and omit inapplicable ones rather than filling a template with empty machinery:

1. `Goal`
2. `Plan status and revision date`
3. `Authoritative requirements and accepted decisions`
4. `Non-goals`
5. `Current-state evidence`
6. `Preservation contract`
7. `Runtime responsibility map`
8. `Locked public/domain interfaces`
9. `Task dependency order`
10. concrete tasks with the applicable functional TDD or before-and-after verification
11. `Security and durable-execution matrix`
12. `User-facing copy contract`
13. `Verification matrix`
14. `Live and browser gates`
15. `Self-review and known deferrals`

## Required task structure

Each task must be independently reviewable and contain:

- **Outcome:** observable behavior delivered by this task.
- **Files:** exact paths labelled `Preserve`, `Modify`, `Create`, or `Remove`.
- **Existing behavior to preserve:** explicit list, not “keep current UI”.
- **Interfaces:** exact consumed and produced types or function names.
- **Risks and stop conditions:** decisions or failures that halt the task.
- **Verification approach:** classify the observable change before selecting tests. For a functional contract, specify RED with concrete test code, command and intended failure, then GREEN with the minimal implementation and exact check. For presentation-only work, specify the affected browser baseline and comparison. Documentation uses link, structure and consistency checks. Tooling or configuration uses the smallest executable before-and-after check.
- **Refactor:** bounded cleanup that cannot expand behavior.
- **Browser gate:** required for changed critical user-facing behavior.
- **Handoff evidence:** what must be reported before the next task starts.

Do not include placeholders such as “handle errors”, “add tests”, “wire the UI”, or “similar to Task N”. State the exact error state, assertions, boundaries, and commands.

## User-facing copy contract

Plans must separate internal truth from audience copy.

For each new or changed visible state, define:

- the user-relevant label;
- why it matters to the analyst;
- the next available action;
- technical details that must not be rendered;
- the applicable check for actionable copy and absence of internal diagnostics. Functional state changes need the repository's regression coverage; unchanged-meaning copy or presentation uses browser review rather than a new automated test for every label.

Operational details belong only in protected administration surfaces and remain secondary to a readable status.

## Verification matrix

Map every exit criterion to evidence before implementation begins:

| Exit criterion | Deterministic test | Browser proof | Live proof | Blocking |
|---|---|---|---|---|

Select only the layers that establish the changed contract. Use focused tests and diagnostics during implementation, then the applicable stabilized checks. Require project-wide checks only for a repository or CI obligation, an explicitly requested gate, or a demonstrated transversal risk, and state the reason. A focused result may complete a bounded task without certifying the whole MVP. Documentation-only or standalone-tooling work does not require rebuilding the application.

The final gate for a protected critical journey must use the intended access state and role. A public page, mocked component, or unauthenticated rejection is not a substitute.

Browser plans must cover, where relevant:

- analyst and administrator paths;
- access-code admission, logout, and reconnection;
- desktop and narrow mobile layouts;
- keyboard and focus behavior;
- hover interactions that expose actions;
- reduced motion when animation changes;
- loading, empty, partial failure, review, and completed states;
- fresh post-action snapshots and console inspection;
- removal of temporary QA routes and fixtures.

Live-provider gates require explicit approval, bounded calls, the correct runtime environment configuration, exact request counts, latency, returned shape, available cost, and no secret output.

## Plan self-review

Before handing off a plan, verify:

- every product decision is sourced or explicitly unresolved;
- existing UI is preserved unless an approved decision says otherwise;
- supported intent is not removed with an unsupported transport;
- current route, API, file, and terminology names are correct;
- external-I/O safety is specified before I/O and across retries;
- cancellation and late-result tests cover the affected external or durable work;
- mutable external metadata is not treated as stable identity;
- user-facing copy is audience-appropriate;
- verification scope matches the changed contract, with protected browser gates for affected critical journeys and live gates only when needed and authorized;
- completion claims state exactly what the focused checks establish and what remains unverified;
- deferred work is honest and cannot appear active in the UI.

If implementation later exposes a stale or incorrect assumption, pause, revise the plan, and obtain approval for any material product change before resuming.
