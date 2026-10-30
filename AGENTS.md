# AGENTS.md

## Mission

Build the Agentic Resilience Workbench as a useful contribution in an unsolicited application to join Decoding Discontinuity. The private prototype helps Raphaëlle d'Ornano and analysts investigate the economic position and architectural resilience of a US-listed technology company through a relevant activity or workflow.

This is not a generic AI chat application, an autonomous investment analyst, or a reproduction of Decoding Discontinuity's proprietary methodology. The system accelerates research and structures judgment; the analyst remains the final authority.

Make the economic question, useful interpretation and inspectable evidence immediately understandable. The author's credibility follows from usefulness to Raphaëlle and her analysts. Work that does not improve that usefulness or preserve its integrity must not delay the prototype.

## Document Authority and Required Reading

Read `PRODUCT.md` before product planning or implementation, relevant sections of `context/TECH.md` before technical work, and `DESIGN.md` for interface changes. Use `docs/ROADMAP.md` for delivery state and next work; consult `context/PROJECT.md` only for deeper context about the candidature purpose.

`pnpm docs:check` reads this table in order: the first matching path applies (`*`: one path segment; `**`: descendants). Word warnings are advisory; never discard requirements to meet them.

<!-- documentation-policy:start -->
| Path | Role | Word warning | Responsibility |
| --- | --- | --- | --- |
| `AGENTS.md` | reference | - | Agent conduct, authorization, development and verification rules. |
| `PRODUCT.md` | reference | - | Product requirements, analyst workflow, invariants and acceptance. |
| `context/TECH.md` | reference | 6000 | Architecture and detailed technical contracts. |
| `docs/ROADMAP.md` | reference | - | Verified delivery state, gaps and implementation sequence. |
| `DESIGN.md` | reference | - | Visual guidance and shared component design; executed tokens remain in their runtime owners. |
| `context/PROJECT.md` | context | - | Stable candidature purpose and research framing. |
| `docs/decisions/**` | history | - | Dated decisions and trade-offs, not additional current obligations. |
| `docs/brainstorming/**` | history | - | Explorations and earlier designs, not execution instructions. |
| `docs/research/**` | history | - | Dated research and benchmark interpretation. |
| `docs/showcases/**` | history | - | Showcase selection rationale and research material. |
| `docs/examples/**` | history | - | Illustrative references. |
| `docs/verification/**` | evidence | - | Dated verification reports; raw artifacts are immutable. |
| `scripts/evaluations/source-selection/*.md` | evidence | - | Evaluation usage and dated judgments, not product acceptance. |
| `scripts/evaluations/source-selection/fixtures/*/README.md` | evidence | - | Fixture provenance and evaluation boundaries. |
| `scripts/evaluations/source-selection/fixtures/**` | excluded | - | Raw captures, frozen results and external copies. |
| `scripts/evaluations/source-selection/runs/**` | excluded | - | Immutable experiment records and source snapshots. |
| `docs/designs/**` | retired | - | Replaced by the brainstorming location. |
| `docs/plans/**` | retired | - | Retired plan location. |
| `docs/superpowers/**` | retired | - | Previous plans preserved in Git, not active instructions. |
| `docs/product-architecture/**` | retired | - | Requirements consolidated into the current product and technical contracts. |
| `docs/design-systems/**` | retired | - | Former redirect to the visual reference. |
| `docs/preferences.md` | retired | - | Preferences incorporated into their current owners. |
<!-- documentation-policy:end -->

- Keep each rule in its listed owner; link to it rather than duplicating its contract. Consult history for rationale or evidence, never to override current references or renew execution permissions. If current references conflict, stop and identify the conflict.
- Update a reference only for an approved durable change or to correct inaccurate or incomplete information. Identify the affected statement and owner, then revise the passage in place. Routine code/UI changes or passing checks alone do not justify an update. Keep roadmap entries at capability, gap and sequence level.
- Material product or architecture changes require an explicit user decision and an update to the owning reference. Use ADRs for durable rationale or meaningful rejected alternatives, with current obligations in their reference owner. New normative documents require an explicit user decision on ownership and an update to this table.
- When an approved change replaces a mechanism or contract, search references and historical designs for descriptions of the old behavior. Date affected status summaries and distinguish delivered mechanisms, pending business integration and unverified quality. Preserve original decisions and evidence; add dated supersession notes linking to the current owner. Complete this consistency check before reporting delivery.
- Keep status concise and include each document-specific limitation only where it affects interpretation or the next decision. Apply authority and authorization rules while working; do not reproduce them as boilerplate, lists of unchanged references or generic prohibited actions.
- Review documentation changes for necessity, ownership, duplication and stale or contradictory text; keep this review in the handoff. For removed documents, cite `git show c4f0d24:<original-path>` and distinguish local-only evidence from content preserved at that checkpoint.

## Working Principles

- Keep the application, source code, schemas, fixtures, tests, UI copy, and documentation in English, even if the user communicates in French. Keep documents self-contained and each prose paragraph on one physical line.
- Prefer the smallest coherent implementation that proves the product thesis; never build speculative abstractions, theatrical agent swarms, or features outside the MVP.
- Use `ai-sdk` for AI SDK integrations and relevant Convex skills for backend logic and schemas.
- For frontend planning, implementation, and review, apply [workbench-frontend](.agents/skills/workbench-frontend/SKILL.md). It selects the relevant UI/UX specialist procedures. Preserve any specialist workflow explicitly requested by the user.
- When creating or revising skills, keep loaded instructions focused on task-specific decisions, methods and checks of the result. Omit repeated repository reading lists, authority rules and generic permission reminders. Keep skill-maintenance and skill-evaluation instructions in supporting resources unless maintaining or evaluating skills is the workflow itself. Before saving, remove passages that add no operational guidance beyond instructions already in force; preserve specific prerequisites, exceptions and approval boundaries.

## Candidature Priority and Proportionality

Prioritize work in this order:

1. make the prepared economic analysis directly useful to Raphaëlle and her analysts;
2. make evidence provenance, uncertainty, and human control credible;
3. let the system prepare routine research so analyst attention remains available for judgment, measuring acceleration before claiming it;
4. make the demonstrated path reliable enough for the five-visitor prototype;
5. add breadth, secondary integrations, and hardening only when required by a documented invariant, the next vertical slice, or measured risk.

Every proposed task must improve the first-minute demonstration, protect evidence integrity or analyst authority, enable the next honest end-to-end slice, or mitigate a concrete risk created by the exposed prototype. If it does none of these, it must not delay the candidature.

The earliest useful demonstration path is:

```text
Curated, clearly labelled showcase dossier
+
Genuinely live company resolution and source discovery
+
Persisted progress and the human prerequisites of the implemented path
```

Later stages remain required for the completed MVP, but must not prevent earlier slices from being runnable and demonstrable. This proportionality rule never permits fake progress, client-side bypasses, weakened evidence integrity, or deferred controls required by an exposed feature.

Implement the [question-led product workflow](PRODUCT.md#operating-context) through the [technical transition contract](context/TECH.md#implementation-transition). Preserve existing dossier authorization and checkpoints until their replacement is implemented and verified. Accepted target autonomy is not permission to bypass a runtime guard. Detailed agent missions and operation rules belong in the technical contract, not another framework or a duplicate tool implementation.

## Product Contract

Preserve the [product invariants and scope](PRODUCT.md#capabilities-and-constraints). They define analytical authority, human decisions and demonstration integrity. The [technical contract](context/TECH.md) defines their enforcement. Neither implementation convenience nor a historical plan permits weakening them.

## Implementation Discipline

Build the smallest runnable vertical slice that preserves the relevant invariants. Introduce domain concepts when observable behavior requires them rather than scaffolding unused abstractions. Follow the implementation sequence in `docs/ROADMAP.md` unless measured evidence justifies a change.

Keep domain rules out of UI components. Keep provider-specific types and model names out of domain records and workflow business logic. Convex remains the state owner.

### Coding Rules

- Use the established package manager and lockfile. Do not change dependencies without verifying the exact package/version and following the dependency-installation skill. Preserve strict TypeScript, validate trust boundaries and avoid `any`.
- Use the smallest relevant check during implementation and scope diagnostics to task files. After behavior stabilizes, format once and run the applicable lint, typecheck and test checks. Run project-wide checks only for a repository/CI requirement or a transversal risk, stating the reason first. `pnpm check` is the CI aggregate; documentation and standalone tooling changes use the relevant focused checks instead of rebuilding the application.
- Documentation-only edits need link, structure and consistency checks, not a manufactured failing test. Run `pnpm docs:check`, and `pnpm design:check` when visual documentation is touched. The documentation checker validates locations, links and heading anchors; review meaning and requirement preservation separately. Tooling/configuration requires executable before-and-after validation; generated outputs are verified through their owner rather than edited independently.
- Do not run `pnpm run build` for each change. Use a build after substantial application changes, not routine documentation edits.

`pnpm convex:check` only typechecks the backend. Keep validation independent from synchronization. `pnpm dev` or `pnpm convex:dev` owns the local backend lifecycle; use one development watcher and preserve its running service. After editing backend code, verify a successful watcher push after the edit and exercise the changed behavior through the relevant authorized check. A listening port or an unchanged function signature alone does not prove that the latest implementation was applied.

For an explicitly intended manual push to an already running local backend, use `pnpm convex:sync --url http://127.0.0.1:<port>`. It requires matching project configuration and running instance identity before calling the installed publisher, preserves project environment files, and never starts or stops a backend. It may regenerate Convex types and update backend functions, schema and indexes. It is not part of routine validation or CI. Do not replace it with a second `convex dev --once`, silently select another port or deployment, or bypass the native duplicate-instance protection.

Impeccable uses the permanent development-only root entry, enabled per page load by `?impeccable=1` (or `&impeccable=1` when other parameters exist). Start its helper with `pnpm design:live` and stop it with `pnpm design:live:stop`;

### Centralization and Shared Ownership

- Decisions, semantic status, presentation tokens, validation, and policy must each have a single owner. When a concept appears on multiple surfaces, expose it through a focused shared helper, hook, or domain module at the owning boundary; never duplicate mapping or conditional logic.
- Keep shared modules deep: expose the smallest useful API, retain implementation details internally, and make exceptional behavior opt-in with sensible defaults.

### Implementation Planning and Scope Fidelity

- The AI harness's native planning mode is the default for ordinary planning, task decomposition, sequencing, and implementation discussion, including work with multiple steps.
- Create a persistent plan in the repository only when explicitly requested, with at most one active plan per authorized workstream and an explicitly agreed location. On closure, transfer outstanding work and verified delivery to the roadmap, then retire the plan. Skills cannot autonomously create document series or override this policy.
- Treat `writing-plans` and the project `implementation-plan` skill as opt-in workflows. Invoke either skill only when the user explicitly names or requests that skill; never trigger them merely because a task is complex, spans multiple files, crosses runtimes, or asks for a plan.
- When the user explicitly invokes `implementation-plan`, apply it after the principal `writing-plans` skill because it adds this repository's product, UI-preservation, provider-safety, and verification contracts. Invoking `writing-plans` alone does not implicitly invoke the project overlay.
- Planning and implementation are separate authorizations. A request to diagnose, brainstorm, review, or revise a plan does not authorize production code, dependency, schema, environment, deployment, or data changes.
- Before planning changes to an existing feature, reconstruct the current behavior from the working tree, routes, tests, browser state, and history. Classify each affected surface or contract as `preserve`, `modify`, `replace`, or `remove`, and provide evidence for every item not marked `preserve`.
- Words such as `connect`, `integrate`, `refactor`, `reuse`, or `make real` do not authorize a redesign, structural rewrite, deletion of an affordance, or replacement of an established interaction. Material product or visual changes require an explicit user decision before they enter a plan.
- Do not turn an implementation assumption into a test or documented product requirement. If a requirement is ambiguous, surface the decision before encoding it. When implementation evidence invalidates a plan, stop and revise the plan and authoritative documentation before continuing.
- Keep examples resilient to external drift. Persist and test stable identity keys such as SEC CIK; treat ticker, company name, provider availability, model identifiers, pricing, and returned metadata as mutable unless a deterministic fixture owns the value.

### Existing-Surface Preservation

- Existing user-authored UI is the baseline, not disposable scaffolding. Add the required behavior behind or within it. Do not replace a page, shell, navigation pattern, composer, card composition, or motion language merely because a simpler implementation is available.
- Preserve established layout hierarchy, responsive behavior, visual primitives, interaction states, keyboard behavior, motion, and loading silhouettes. For changed user-facing surfaces, capture a pre-change browser baseline and verify the same surface after the change at desktop and mobile sizes.
- Do not remove a useful affordance because one possible transport is outside the MVP. Separate the supported intent from the unsupported mechanism. For example, public HTTPS references remain valid even though local file upload is excluded.
- Shared UI primitives remain neutral and configurable. A stacking, sizing, copy, motion, or styling requirement belonging to one consumer must be applied by that consumer unless the behavior is a documented shared contract. Never introduce a global primitive default solely to repair one screen.
- A skeleton must preserve the geometry and semantic regions of the loaded component. Rendering a generic rectangle for a distinctive card, matrix, or review surface is not an acceptable loading state.
- Secondary list filters may use `AnimatedListFilter` only after accessible popup semantics, keyboard/focus handling, Escape/outside-click behavior, reduced-motion support and focused tests are established. Keep responsive rail sizing in its existing single component-owned configuration.

### Provider and Durable-Workflow Planning

- Every planned external-I/O boundary must specify authorization before I/O, validation, resource limits, timeout, bounded retry, idempotency key, provider-call telemetry, cancellation behavior, and the typed outcome for missing configuration or partial failure.
- For URL retrieval, require authorization before DNS resolution, validation of every redirect, and connection to the public address that was validated so a later DNS resolution cannot redirect the request into a private network.
- For retryable or durable work, bind each attempt to the active run, workflow version, execution generation, corpus revision, step, and attempt. Check the active generation before the external call and again before persistence; late or cancelled results cannot advance state or trigger another paid call.
- Any resume that can make work `running` must claim the visitor's execution slot atomically. Provider absence or disabled paid work is an explicit typed blocked or reviewable state, never a silent empty success.

Protect every exposed server operation with the authorization, validation, idempotency, resource, and security controls appropriate to that operation. Never rely on disabled UI controls for enforcement.

## Frontend Standards

These rules govern the React + TanStack Start + Convex + shadcn/ui (`base-luma` style, `hugeicons` library) layer of the prototype. They are enforced by Biome where the rule is statically detectable; the rest is review-time.

### Analyst Experience Direction

- The current interface does not yet meet the intended standard for restraint, ergonomics or ease of learning. Within authorized UX changes, progressively make the workflow calmer, easier to understand and less demanding of the analyst's attention.
- Use clear defaults, progressive disclosure and an obvious next action. Keep secondary detail accessible without making it compete with the current task. Each control, confirmation or review step must serve an analyst decision or a documented invariant.
- Let the system prepare and organize work proactively, resolve routine steps autonomously within the evidence rules, and advance work that does not require analyst judgment. Do not make the analyst coordinate internal execution or confirm every internal step.
- Apply the [product's judgment boundaries](PRODUCT.md#assessment-and-review): grouped appraisal review and targeted material exceptions, with final analyst authority. Keep routine preparation system-owned and detailed inspection optional. Preserve the implemented checkpoints during transition and retain individually traceable decisions within grouped actions.

### User-facing product copy

- Technical requirements, implementation plans, ADRs, and backend terminology are internal product truth, not ready-made interface copy. Translate them into the minimum information the user needs to understand what happened, why it matters, and what to do next.
- Public and analyst-facing surfaces must never render raw exceptions, request IDs, server function names, internal enum or event keys, environment-variable names, provider error codes, invitation-pool details, anonymous-session mechanics, or deployment instructions.
- Translate persisted workflow and provider state at the presentation boundary. Keep the domain value as the source of truth, but render an audience-appropriate label, consequence, and next action.
- Operational terminology and diagnostic detail are permitted only inside explicitly protected administration surfaces. Even there, lead with a readable status and present raw technical detail secondarily.
- Preserve user-relevant integrity disclosures such as `illustrative`, `showcase`, or `not live`. These labels protect the audience and are not implementation leakage.
- Tests for new or changed analyst-facing states must verify both the intended actionable copy and the absence of raw backend or workflow details.

### Key principles

- **Design system continuity:** Follow `DESIGN.md` for visual rules and style ownership. Reuse the existing shared primitives and component variants.
- **Navigation & URLs:** Never use hardcoded URLs. Route through TanStack Router's typed navigation (`<Link>`, `useNavigate`, `redirect`) and Convex HttpApi routes.
- **Type Safety (single source of truth):** Never manually define TypeScript interfaces or DTOs for Convex data. Use generated Convex types from `@convex/_generated/api` and `@convex/_generated/dataModel`.
- **Domain logic boundary:** Keep domain rules, claim classification, and evidence policy out of React UI components and TanStack Start server functions. Convex remains the state and policy owner.

### Import paths

- **`@/` alias is mandatory for any cross-directory import.** `../` and deeper relative parent paths are strictly prohibited in application source code. This is enforced by Biome (`style.noRestrictedImports`) and validated on dynamic imports by `scripts/check-imports.ts`.
- Same-directory `./` imports are acceptable (e.g., `import Foo from './foo'`).
- For `convex/` modules imported from `src/`, use `@convex/...` (configured in `tsconfig.json` and `vite.config.ts` `resolve.tsconfigPaths`).
- `import.meta.glob` patterns must start with `/` (project-root absolute) or `./` (relative). Vite's glob plugin does not honor aliases. `import.meta.glob('@convex/*.ts')` will fail at build time with a cryptic error. Enforced by `scripts/check-imports.ts`.
- TS-to-TS imports must not use `.js` extensions unless a real `.js` runtime sibling exists (e.g., a `.d.ts` + `.js` paired shim). Enforced by `scripts/check-imports.ts`.
- Examples:
  - ❌ `import { X } from '../../types/ui'`
  - ✅ `import type { X } from '@/types/ui'`
  - ❌ `import schema from '../../convex/schema'`
  - ✅ `import schema from '@convex/schema'`
  - ❌ `import.meta.glob('@convex/**/*.ts')`
  - ✅ `import.meta.glob('/convex/**/*.ts')`

### React 19 & TanStack Start Critical Standards

- **React 19 conventions:** Pass `ref` directly as a prop; ref callbacks must return `undefined` or a cleanup function. Do not use `defaultProps`, `propTypes`, or `forwardRef`.
- **Data fetching & mutations:** Use Convex React hooks (`useQuery`, `useMutation`, `useAction`, `usePaginatedQuery`) wired through `@convex-dev/react-query` where cache integration is needed. Never bypass Convex with ad-hoc HTTP `fetch()` calls (see `convex/http.ts` for narrow HTTP transport exceptions).
- **Optimistic state:** Use Convex's built-in `optimisticUpdate` or `@tanstack/react-query` mutations for non-Convex effects. Never hand-roll optimistic state for Convex-owned data.
- **Server functions:** Reserve TanStack Start `createServerFn` for pure SSR/edge concerns (auth context, redirects). Evidence policy, claim classification, and workflow logic belong strictly in Convex.
- **Route files must export ONLY `Route`:** TanStack Router code-splits each route file into its own chunk. Any non-type export beyond `export const Route` breaks code-splitting and triggers bundle bloat warnings. Sibling components must live in a separate file (e.g. `start-route-component.tsx`). Enforced by `scripts/check-imports.ts`.

### Icons & Notifications

- **Icons:** Always render icons through `@/components/icon` (`<Icon iconNode={...} />`). Prefer Hugeicons (`@hugeicons/core-free-icons`); use Lucide (`lucide-react`) only when a Hugeicons equivalent does not exist. Do not import `HugeiconsIcon` or `LucideIcon` directly in feature components, and do not mix icon sets in the same component.
- **Toasts:** The global `Toaster` is mounted in the root layout via Sonner (`@/components/ui/sonner`). Trigger toasts imperatively via `toast.success` (completed user actions), `toast.error` (non-field failures), or `toast.warning` (recoverable conditions).
- **Field-level validation:** Never toast field-level validation errors; parse Convex mutation errors and render them inline next to the input.

### Loading, Empty, and Error States

- Every async region must expose explicit loading (geometry-preserving skeleton), empty (`Empty` component), and actionable error states.
- Use `LoadErrorAlert` (`@/components/ui/load-error-alert`) for analyst-safe recoverable alerts, and `LoadErrorBoundary` (`@/components/load-error-boundary`) narrowly around query-owning subtrees. Form drafts and interactive controls must stay above the boundary so retries preserve analyst inputs.
- Preserve the product's [uncertainty and assessment rules](PRODUCT.md#assessment-and-review); never collapse an insufficient evidence base into a confident layout.
- Use shared shadcn chart primitives and Recharts directly; do not wrap them in bespoke chart abstractions. Never use `<Input type="date" />` or `<Input type="datetime-local" />` — use the shared date picker built on shadcn primitives.

## Test-Driven Development

Apply TDD to new or changed functional contracts: business rules, data handling, authorization, persistence, workflow transitions and custom interaction logic. Classify changes by their observable effects, not by whether they live in frontend or backend files.

- For presentation-only changes (spacing, alignment, typography, colors, borders, icon placement or copy without a change in meaning) and composition of established UI primitives that preserves functional contracts, browser verification of the affected surface is the default. Check the relevant viewport sizes and states. Do not add automated tests, manufacture a RED step or request a TDD exception merely for these changes.
- Do not write tests that freeze incidental CSS classes or pixel values, or repeat behavior already covered by a shared primitive or library. Add a focused UI regression test only when it protects a changed functional contract or a concrete recurring or materially harmful usability defect, and its value justifies its maintenance cost. Assert the user-visible failure rather than styling choices. Changes to validation, saved decisions, selection/navigation rules, async transitions and custom keyboard/focus behavior still require functional coverage; browser inspection does not replace their TDD. Do not replay unrelated admission, reconnection or provider journeys for a cosmetic change.
- For functional changes, write one minimal test through the real public boundary, run it and observe the intended failure, implement the smallest correction, then refactor while keeping focused tests green. Record the RED command and failure in the handoff. Do not copy production logic into tests or weaken assertions to obtain green. Mock only nondeterministic or external boundaries; a mocked call count alone does not establish a domain outcome.
- Default and CI test suites must never invoke paid or nondeterministic external providers.
- Never complete work with `.skip`, `.only`, hidden failures, unexplained warnings, or flaky retries.
- Keep all test files under `src/__tests__/` mirroring domain boundaries (`components/`, `routes/`, `config/`, `design-system/`, `convex/<domain>/`). Shared harness setup belongs in `src/__tests__/setup/`. Never colocate test files with production source.
- Pure Convex functions are tested under `src/__tests__/convex/<domain>/` using `convexTest`. Do not test Convex logic through the React layer.
- Do not use `convex-test` as a React subscription simulator. React integration tests use the shared reference-routed Convex hook harness; subscription and reactivity behavior is verified with Playwright against the local Convex backend.
- Browser E2E tests must use real anonymous authentication and access-code admission. Seed and inspect state exclusively via internal E2E functions gated by `E2E_FIXTURES_ENABLED`; never introduce public test endpoints or CLI identity impersonation.
- Add JSDoc comments to any shared component, hook, or utility whose intent is not immediately obvious.

Select the verification layers needed for the changed contract: React integration tests for rendering and component-to-hook wiring, Convex tests for authorization/persistence/transitions, and Playwright against the local backend for actual subscriptions, protected checkpoints and reconnection. A task does not automatically require all three layers. The shared React harness routes generated function references to stable snapshots and explicit handlers, never by hook call order. Include a real module import where isolated helpers would otherwise conceal a broken consuming module.

Browser scenarios use local Convex only, real anonymous sign-in and access-code admission. Internal fixtures derive ownership from a claimed invitation slot and never accept fabricated browser identities. Their inspection is bounded and read-only; setup reuses production authorization-sensitive operations and persisted workflow events. Local fixture keys are deterministic and idempotent. Remove `E2E_FIXTURES_ENABLED` at teardown; leaving it enabled makes the verification incomplete. Evaluation fixtures that require loopback deployment must enforce both that check and the fixture flag. No cloud deployment, public fixture endpoint, CLI identity impersonation, client-side access bypass or manually edited generated Convex type is permitted.

Coverage must protect concurrent quota reservations and access attempts, framing and research-start separation, delegated selection authority, source and passage integrity, assertion admission and question-specific uses, grouped appraisal decisions, revision freshness, rejected-use exclusion, mission completion, synthesis coherence and outcomes, analyst history, partial failures, recovery and one-running-workflow enforcement. Preserve existing corpus and dimension-decision regressions for paths still using those contracts. Use fast deterministic checks for these rules; reserve live experiments for explicit bounded authorization. Critical browser gates exercise the intended protected role, desktop/mobile states, keyboard/focus, relevant hover behavior, reduced motion and fresh post-action state, including console errors.

## Demo Integrity and Human Authority

Never present cached, seeded, or precomputed output as live. Label showcase and fixture data clearly. Persisted stages may be shown, but not hidden chain-of-thought or theatrical agent activity.

The analyst must be able to inspect evidence, uncertainty, counter-evidence, proposed conclusions, decisions, and overrides. A polished landing page or one successful model response does not constitute completion.

## Completion and Communication

Use the [product acceptance criteria](PRODUCT.md#mvp-acceptance) as the MVP checklist and the roadmap as its delivery record. Before declaring a meaningful implementation complete, run the applicable verification above and report:

- what user-visible or invariant-backed behavior now works;
- files and architectural boundaries changed, including the reason for each reference-document update;
- exact verification commands and results;
- cost or deployment implications;
- assumptions, remaining gaps, and blocked uncertainties;
- the next smallest coherent slice.

Keep routine implementation details, test counts and verification steps in the handoff. Create reports only for durable verification evidence; do not create another report, checklist or index merely to narrate the task, record its documentation review or explain an existing document.

For a critical user journey, a public or unauthenticated page render does not prove the protected workflow. Verify the complete path with the intended role and access state, including reconnection when access is durable. Browser gates must cover the meaningful desktop and mobile states, keyboard access, relevant focus/hover interactions, reduced motion where animation changes, and console errors. If credentials or an admitted session are unavailable, report the gate as incomplete rather than substituting a component test or a nearby public screen.

Do not hide failing checks, unsupported provider behavior, incomplete security controls, or mocked integrations behind optimistic wording.

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->
