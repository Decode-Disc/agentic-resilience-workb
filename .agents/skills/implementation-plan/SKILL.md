---
name: implementation-plan
description: Create, revise, or audit implementation plans for this evidence-workbench repository. Use whenever work spans multiple tasks, modifies an existing feature, crosses Convex and TanStack boundaries, integrates providers, changes a user journey, or prepares phases from ROADMAP.md. Extends the principal writing-plans skill with mandatory scope preservation, existing-UI fidelity, durable-workflow safety, access-code journeys, copy boundaries, and end-to-end verification gates.
compatibility: Requires repository access and the principal writing-plans skill. Uses project documentation, Git, tests, and read-only browser inspection when an existing user-facing surface is affected.
---

# Implementation Plan

Create an executable plan that preserves the user's product, not merely a list
of files and tests. This skill is a project-specific overlay on the principal
`writing-plans` skill; it does not replace its task sizing, TDD structure,
concrete code examples, exact commands, or no-placeholder rules.

## Required base skill

1. Read the principal `writing-plans` skill completely before drafting.
2. Apply this skill after it. When the two differ, the repository contracts and
   this project-specific overlay win.
3. If `writing-plans` is unavailable, stop and report the missing dependency.
   Do not silently recreate an approximate version from memory.

## Authority and mode

- Read `AGENTS.md` and `context/PROJECT.md` completely before planning.
- Read `context/TECH.md` before planning production code, schemas, workflows,
  providers, security controls, dependencies, or tests.
- Read the product design and relevant accepted ADRs for exact requirements and
  rationale. Surface conflicts instead of choosing an interpretation.
- Inspect `git status`, relevant history, current routes, production modules,
  tests, and generated contracts before proposing files.
- A plan is documentation. Do not implement it unless the user separately
  authorizes implementation.

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

Default every existing surface to `preserve`. `Replace` and `remove` require an
explicit product decision, not an implementation preference.

## Step 2: Close product decisions before task decomposition

Separate the user's intended outcome from a proposed implementation. Resolve or
mark as blocked every decision that can materially change:

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
- A reusable access code is not a one-time invitation and must support the
  documented logout/reconnection journey.

If implementation evidence changes an accepted decision, revise the design and
ADR before continuing the plan.

## Step 3: Define the preservation contract

For every existing user-facing surface, the plan must name:

- exact components and shared primitives to preserve;
- layout hierarchy and responsive breakpoints to preserve;
- hover, focus, keyboard, loading, empty, error, and reduced-motion states;
- visual references supplied by the user, including required component slots;
- copy that changes and copy that must remain untouched;
- the browser baseline to capture before implementation;
- the explicit visual differences expected after implementation.

Do not use `refactor`, `reuse`, or `fold into production` as permission to
recompose an interface. If no visual change is required, say so directly in the
task and test for preservation through observable behavior plus browser review.

Shared primitives stay neutral. Put a one-screen z-index, width, animation, or
copy choice in the consumer unless multiple consumers already share the stable
responsibility.

Distinctive loaded components require isomorphic loading states. A plan for a
cutout card, evidence matrix, or review panel must preserve its meaningful
regions in the skeleton rather than specify a generic rectangle.

## Step 4: Lock runtime and ownership boundaries

State which runtime owns each operation:

- TanStack Start: React rendering, routing, SSR, and request-scoped web needs;
- Convex queries: reactive owner-authorized projections;
- Convex mutations: deterministic atomic persistence and transitions;
- Convex actions: authenticated external I/O orchestration;
- Convex Workflow: durable steps, retries, cancellation, and human checkpoints;
- integration adapters: transport and mapping without database authority;
- presentation helpers: user-facing labels, consequences, and next actions.

When planning Convex work, read `convex/_generated/ai/guidelines.md`. Avoid a
TanStack server-function proxy when the generated Convex client is the intended
public boundary.

## Step 5: Specify durable external-I/O safety

Every external-provider or URL-retrieval task must define and test:

1. authorization before DNS, SDK, or HTTP work;
2. strict input and output validation;
3. rate, breadth, timeout, size, decompression, and cost limits;
4. application-owned retry and fallback policy;
5. an operation key containing the stable execution identity;
6. an execution lease bound to run, workflow version, generation, corpus
   revision, step, and attempt where applicable;
7. active-generation checks before the call and before persistence;
8. cancellation behavior and rejection of late results;
9. atomic running-slot acquisition on resume;
10. typed missing-configuration, partial-failure, blocked, and review outcomes;
11. provider-call telemetry without secrets or unnecessary prompt content;
12. deterministic adapter tests and explicit, bounded live contracts.

For URL fetching, authorize first, validate every redirect, and connect to the
public address that was validated. A validation lookup followed by an unrelated
DNS resolution is not SSRF protection.

## Step 6: Use stable identity in examples

Do not make plans depend on mutable external labels. For SEC companies, use CIK
as canonical identity. Treat ticker and legal name as revalidated metadata.

- Deterministic tests may pin fixture-owned values.
- Live contracts should assert identity and response shape without assuming a
  ticker can never change.
- Provider model names, prices, availability, and metadata receive the same
  treatment unless explicitly version-pinned configuration owns them.

## Required plan structure

Save plans under `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` and include:

1. `Goal`
2. `Plan status and revision date`
3. `Authoritative requirements and accepted decisions`
4. `Non-goals`
5. `Current-state evidence`
6. `Preservation contract`
7. `Runtime responsibility map`
8. `Locked public/domain interfaces`
9. `Task dependency order`
10. concrete TDD tasks
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
- **RED:** concrete test code, command, and expected missing-behavior failure.
- **GREEN:** minimal production behavior and exact verification command.
- **Refactor:** bounded cleanup that cannot expand behavior.
- **Browser gate:** required for changed critical user-facing behavior.
- **Handoff evidence:** what must be reported before the next task starts.

Do not include placeholders such as “handle errors”, “add tests”, “wire the UI”,
or “similar to Task N”. State the exact error state, assertions, boundaries, and
commands.

## User-facing copy contract

Plans must separate internal truth from audience copy.

For each new visible state, define:

- the user-relevant label;
- why it matters to the analyst;
- the next available action;
- technical details that must not be rendered;
- tests proving raw errors, provider codes, environment names, invitation
  inventory, quota mechanics, and workflow enums are absent.

Operational details belong only in protected administration surfaces and remain
secondary to a readable status.

## Verification matrix

Map every exit criterion to evidence before implementation begins:

| Exit criterion | Deterministic test | Browser proof | Live proof | Blocking |
|---|---|---|---|---|

The final gate for a protected critical journey must use the intended access
state and role. A public page, mocked component, or unauthenticated rejection is
not a substitute.

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

Live-provider gates require explicit approval, bounded calls, the correct
runtime environment configuration, exact request counts, latency, returned
shape, available cost, and no secret output.

## Plan self-review

Before handing off a plan, verify:

- every product decision is sourced or explicitly unresolved;
- existing UI is preserved unless an approved decision says otherwise;
- supported intent is not removed with an unsupported transport;
- current route, API, file, and terminology names are correct;
- external-I/O safety is specified before I/O and across retries;
- cancellation and late-result tests exist;
- mutable external metadata is not treated as stable identity;
- user-facing copy is audience-appropriate;
- full-project and browser gates prove the actual journey;
- no task claims completion from targeted tests alone;
- deferred work is honest and cannot appear active in the UI.

If implementation later exposes a stale or incorrect assumption, pause, revise
the plan, and obtain approval for any material product change before resuming.

