# AGENTS.md

## Mission

Build the Agentic Resilience Evidence Workbench as the central proof in an original unsolicited application to Raphaëlle d'Ornano. The product is a private, evidence-first research prototype that helps analysts assess the architectural resilience of US-listed technology companies.

This is not a generic AI chat application, an autonomous investment analyst, or a reproduction of Decoding Discontinuity's proprietary methodology. The system accelerates research and structures judgment; the analyst remains the final authority.

The first-minute objective is to make the author's judgment, rigor, and execution visible to Raphaëlle. Work that does not materially improve that demonstration must not delay the prototype.

## Document Authority and Required Reading

The repository separates agent conduct, product context, technical contracts, and decision rationale:

- `AGENTS.md` defines how agents work in the project and the non-negotiable guardrails they must preserve.
- `context/PROJECT.md` defines why the product exists, whom it serves, and what it must demonstrate.
- `context/TECH.md` consolidates the active technical architecture, implementation contracts, and verification expectations.
- `docs/product-designs/2026-07-20-agentic-resilience-evidence-workbench-design.md` defines the complete product design and MVP acceptance contract.
- Accepted records in `docs/decisions/` explain the rationale and trade-offs behind individual architectural decisions.

Read `context/PROJECT.md` in full before planning, coding, installing dependencies, or changing architecture.

Read `context/TECH.md` before:

- changing production code or technical configuration;
- modifying schemas, workflows, providers, security controls, or tests;
- installing, removing, or upgrading dependencies;
- proposing an architectural implementation.

Consult the product design or relevant ADR when a task requires exact requirements or decision rationale. A summary in `context/TECH.md` does not supersede an accepted ADR.

If authoritative documents appear to conflict, stop and identify the conflict instead of selecting an interpretation silently.

Do not rewrite product requirements as part of implementation. Material changes to scope, public behavior, domain invariants, persistence ownership, workflow architecture, or provider architecture require an explicit user decision and an ADR or design update.

## Working Principles

- Work autonomously within the documented scope. Inspect the repository before asking questions that local files or code can answer.
- Verify claims against available context, code, runtime behavior, or primary documentation. Mark unresolved uncertainty explicitly; never convert it into an invisible implementation decision.
- Be critical. Compare proposed work with the product invariants and explain concrete trade-offs rather than agreeing for convenience.
- Prefer the smallest coherent implementation that proves the product thesis.
- Do not build speculative abstractions, theatrical agent swarms, or features outside the MVP.
- Keep the application, source code, schemas, fixtures, tests, UI copy, and documentation in English, even if the user communicates in French.
- Use current primary documentation before recalled APIs. For library or API documentation, generated integration code, setup, or configuration, consult both Context7 and DeepWiki as required by the repository instructions, then verify against the installed package version.
- Preserve user changes. Inspect the working tree before edits and do not overwrite unrelated work.
- Use appropriate skills for the tasks you're working on (e.g. `ai-skd` for working with ai-sdk, convex skills when using convex, `high-end-visual-design` + `frontend-ui-engineering` + `gpt-taste` for well build ui, `hyperframes` + `hyperframes-animation` for high end animations, `shadcn` skill when working with shadcn components).

## Candidature Priority and Proportionality

Prioritize work in this order:

1. make the author's analytical judgment legible;
2. make evidence provenance, uncertainty, and human control credible;
3. demonstrate concrete acceleration of analyst preparation work;
4. make the demonstrated path reliable enough for the five-visitor prototype;
5. add breadth, secondary integrations, and hardening only when required by a documented invariant, the next vertical slice, or measured risk.

Every proposed task must improve the first-minute demonstration, protect evidence integrity or analyst authority, enable the next honest end-to-end slice, or mitigate a concrete risk created by the exposed prototype. If it does none of these, it must not delay the candidature.

The earliest useful demonstration path is:

```text
Curated, clearly labelled showcase dossier
+
Genuinely live company resolution and source discovery
+
Persisted progress and explicit corpus approval checkpoint
```

Later stages remain required for the completed MVP, but must not prevent earlier slices from being runnable and demonstrable. This proportionality rule never permits fake progress, client-side bypasses, weakened evidence integrity, or deferred controls required by an exposed feature.

## Product Invariants

These rules are non-negotiable:

1. The evidence matrix is the primary artifact. Architecture maps and briefs are derived views.
2. Source discovery and evidence extraction are separated by a mandatory, durable human approval checkpoint.
3. Claims are atomic and classified as `Fact`, `Inference`, `Hypothesis`, or `Unknown`.
4. Every material claim references one or more precisely locatable source passages.
5. Rejected sources cannot contribute to claims, assessments, maps, or briefs.
6. Each assessment dimension has separate position, confidence, and three-year direction outputs.
7. There is no aggregate resilience score and no investment recommendation.
8. Confidence comes from evidence characteristics, never model self-confidence.
9. Supporting evidence, counter-evidence, and critical unknowns are visible before dimension review.
10. Analyst decisions and overrides are append-only, audited, and never overwritten by retries or later model output.
11. Briefs use only analyst-approved claims.
12. Map entities and relationships require validated supporting claims.
13. UI progress comes only from persisted workflow events. Never simulate progress or expose hidden chain-of-thought.
14. Retries and workflow resumes must not duplicate claims, quota reservations, provider-call records, or external side effects.
15. A weak evidence base may yield `0 / Mixed or unclear`, `Hypothesis`, `Unknown`, or `insufficient public evidence`. Never force a confident answer.

The exact domain records, workflow states, assessment dimensions, provider boundaries, and enforcement mechanisms are defined in `` and the product design.

## Terminology and Product Guardrails

- **Technical harness** means the internal machinery that makes model intelligence operational: routing, tools, context retrieval, memory, state, delegation, evaluation, retries, and recovery.
- **Economic orchestration** means control of the relationship between user intent, operational context, workflow execution, and the business outcome.

Do not present the prototype's workflow or harness sophistication as evidence that an assessed company has a durable economic orchestration position. Do not foreground internal orchestration as theatre.

Do not implement the following without a new explicit decision:

- investment recommendations or trade execution;
- an aggregate resilience score;
- non-US markets;
- continuous monitoring;
- simultaneous analyst collaboration;
- fine-tuning;
- general-purpose crawling;
- autonomous publication;
- claims of reproducing proprietary methodology;
- chat as the main product interface;
- a second workflow engine or persistence authority.

## Implementation Discipline

Build the smallest runnable vertical slice that preserves the relevant invariants. Introduce domain concepts when observable behavior requires them rather than scaffolding unused abstractions. Follow the implementation sequence in `` unless measured evidence justifies a change.

Keep domain rules out of UI components. Keep provider-specific types and model names out of domain records and workflow business logic. Convex remains the state owner.

Protect every exposed server operation with the authorization, validation, idempotency, resource, and security controls appropriate to that operation. Never rely on disabled UI controls for enforcement.

## Frontend Standards

These rules govern the React + TanStack Start + Convex + shadcn/ui (`base-luma` style, `hugeicons` library) layer of the prototype. They are enforced by Biome where the rule is statically detectable; the rest is review-time.

### Key principles

- **Design system continuity**
    - Do not reintroduce starter-kit visual patterns, generic SaaS dashboard defaults, or one-off styling that bypasses the `base-luma` shadcn theme in `src/styles.css`.
    - If a new visual pattern is needed, extend the shared design system (tokens, variants) rather than creating a local exception on a single page.
    - Before styling a new page, layout, evidence view, or shared primitive, verify it still matches the dedicated design system.
- **Consistency**
    - Maintain consistent UI patterns and layouts across the workbench.
    - Never use hardcoded urls. Route through TanStack Router's typed navigation (`<Link>`, `useNavigate`, `redirect`) and Convex HttpApi routes.
- **Reusability**
    - Build reusable components for common UI elements. Abstract shared logic into modules under `src/lib/` or `src/hooks/`.
    - Keep domain rules out of UI components (see *Implementation Discipline*). UI components render state; they do not own workflow transitions, claim classification, or evidence policy.
- **Type Safety (single source of truth)**
    - Do NOT manually redefine TypeScript interfaces for Convex data. Use the generated Convex types (`@convex/_generated/api`, `@convex/_generated/dataModel`) as the single source of truth.
    - Do NOT hand-write DTOs for server responses. Convex's `api.*` references and `ConvexReactClient` types already contract every query, mutation, and action.
- **High-end visual design**
    - Use ui components from `@/components/ui/*` and shadcn primitives. Those components were handpicked and vetted for consistency with the design system.
    - Do not hand-roll bespoke visual patterns for standard UI elements (buttons, inputs, modals, toasts, tables, etc.).

### Import paths

- **`@/` alias is mandatory for any cross-directory import.** `../` and deeper relative parent paths are strictly prohibited. This is enforced by Biome (`style.noRestrictedImports`).
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

### React 19 & TanStack Start critical standards

1.  **No `defaultProps`**: React 19 removed `defaultProps` for function components. Use ES6 default parameters in the function signature.
    ```tsx
    // ✅ Correct
    function Button({ size = 'md' }: ButtonProps) { ... }
    ```
2.  **No `propTypes`**: removed API. Rely on TypeScript interfaces.
3.  **Strict `ref` cleanups**: ref callbacks must return `undefined` or a cleanup function.
    - ❌ `ref={current => (instance = current)}` (implicitly returns the node)
    - ✅ `ref={current => { instance = current; }}` (returns undefined)
4.  **No `forwardRef`**: pass `ref` directly as a prop in function components.
5.  **Data fetching & mutations**: use the Convex React hooks (`useQuery`, `useMutation`, `useAction`, `usePaginatedQuery`) wired through `@convex-dev/react-query` where query-cache integration is needed. Do not bypass Convex with ad-hoc `fetch()` calls to Convex's HTTP API unless the integration explicitly requires HTTP transport (see `convex/http.ts` for the narrow cases).
6.  **Optimistic / pending state**: use Convex's built-in optimistic updates (`useMutation` with `optimisticUpdate`) or `@tanstack/react-query`'s `useMutation` for non-Convex server-side effects. Do not hand-roll optimistic state for data owned by Convex.
7.  **Server functions**: prefer TanStack Start server functions (`createServerFn`) for pure SSR/edge concerns (auth context, redirects, server-only computations). Do not put evidence policy, claim classification, or workflow logic in server functions — that belongs in Convex.

### Icons

- Always render icons through the shared `Icon` component at `src/components/icon.tsx` (`import Icon from '@/components/icon'`).
- Prefer Hugeicons for standard icons. Use Lucide only when a Hugeicons equivalent does not exist. Do not mix icon libraries in a single component.
- `Icon` accepts both Hugeicons icon nodes (`@hugeicons/core-free-icons`) and Lucide components (`lucide-react`) via the `PlatformIcon` union — keep that abstraction as the single icon surface.
    ```tsx
    import Icon from '@/components/icon';
    import { AArrowDownIcon } from '@hugeicons/core-free-icons';

    function MyButton() {
        return (
            <button className="btn-primary">
                <Icon iconNode={AArrowDownIcon} size={16} />
                Export
            </button>
        );
    }
    ```
- Do not import `HugeiconsIcon` or `LucideIcon` directly in feature components. Go through `Icon`.

### Toasts and notifications

- The global `Toaster` is mounted once in the root layout via the Sonner wrapper at `src/components/ui/sonner.tsx`.
- Trigger toasts imperatively from anywhere: `import { toast } from 'sonner'`. `toast.success(...)`, `toast.error(...)`, `toast.info(...)`, `toast.warning(...)` accept rich content.
- **Severity mapping**:
    - Use `toast.success` when an analyst-side action completed and confirmation is needed (saved override, approved source set, brief exported).
    - Use `toast.error` for non-field-specific failures (permission denied, provider call breached its ceiling, server-side business rule).
    - Use `toast.warning` for recoverable conditions that need acknowledgement (idempotent retry applied, fallback path used).
- **Field-level errors must NOT be toasted.** Validation errors belonging to a specific input should render inline next to the field via the input-error pattern.
- Do not replatform the flash layer; the Sonner wrapper already wires theme + icons.

### Loading, empty, and error states

Every async region — evidence queries, source discovery, assessment review — must expose explicit states:

- **Loading**: skeleton or placeholder that preserves layout dimensions. Never swap a populated region for a spinner-only state that causes layout shift.
- **Empty**: an explicit empty state (use `Empty` from `@/components/ui/empty` or equivalent) when there is genuinely nothing to show. The empty state must be visually distinct from "still loading."
- **Error**: surface the actionable error inline (retry, contact support). Do not swallow Convex errors into a generic blank screen.
- **Insufficient evidence**: per Product Invariant 15, a weak evidence base yields `0 / Mixed or unclear`, `Hypothesis`, `Unknown`, or `insufficient public evidence`. The UI must render these states visibly, not collapse them into a fake-confident view.

### Error handling and validation

- Prefer early returns for error / guarded conditions. Guard clauses first; main flow un-indented.
- For form validation surfaced from Convex mutations, parse the error shape and route field-level errors inline; reserve toasts for the non-field remainder.
- Custom error types live under `src/lib/errors/` (or equivalent). Do not throw ad-hoc `Error('foo')` from feature code — inherit from a named class so the UI can branch on type.

### Charts

- Use the shared shadcn chart primitives from `@/components/ui/*` and Recharts. Compose Recharts components directly; do not wrap them in bespoke chart abstractions.
- Every chart container must pair loading/empty/error states and keep container layout stable across transitions (no reflow when data arrives).
- Anti-patterns: custom SVG logic for standard analytics, global tooltip/legend overrides injected into charts that do not need them.

### Anti-patterns (do not)

- Bypassing Convex with direct HTTP fetches when a Convex hook fits.
- Storing evidence, claims, or workflow state in React component state instead of Convex (violates the *state owner* invariant).
- Hand-defining Convex payload types instead of importing from `@convex/_generated/api`.
- Importing `HugeiconsIcon` / `LucideIcon` directly in feature components instead of going through `Icon`.
- Toasting field-level validation errors.
- Using `<Input type="date" />` or `<Input type="datetime-local" />` — use a shared date picker built on shadcn primitives when date input is needed.
- Rendering hidden chain-of-thought, agent activity theatre, or simulated progress in the UI (violates Product Invariant 13).

## Test-Driven Development

Every production behavior change, bug fix, domain rule, or workflow transition must follow:

```text
RED → verify the expected failure → GREEN → REFACTOR → verify the relevant suite
```

- Write one minimal test through the public boundary that should own the behavior.
- Import the real production module. Mock only nondeterministic or external boundaries.
- Observe the test fail for the expected missing behavior before changing production code.
- Implement only what the failing test requires; never weaken a correct assertion to obtain green.
- Run the focused test, the affected suite, and the project quality checks defined in ``.
- Default and CI tests must not call paid or nondeterministic providers.
- Do not complete work with `.skip`, `.only`, hidden failures, unexplained warnings, or flaky retries.
- Write Vitest tests for components that own non-trivial rendering logic, using React Testing Library when browser-style rendering helpers are needed. Import real production modules; mock only external boundaries.
- Do not test pure Convex logic through the React layer. Convex-side behavior is tested via the `src/__tests__` integration suite using `convexTest`.
- Provide a JSDoc comment on any shared component, hook, or utility whose intent isn't obvious from the name.
- Keep all source code, schemas, copy, and documentation in English — even when communicating with the user in French.

Documentation-only edits do not require a failing automated test. Pure tooling or configuration changes still require an executable before-and-after validation when feasible. If a production change genuinely cannot begin with an automated failing test, stop and obtain explicit user approval for the exception.

**Always refer refer to `tdd` skill for complete guidance for test-driven-development and `vitest` skill for guidance on testing with Vitest.**

## Demo Integrity and Human Authority

Never present cached, seeded, or precomputed output as live. Label showcase and fixture data clearly. Persisted stages may be shown, but not hidden chain-of-thought or theatrical agent activity.

The analyst must be able to inspect evidence, uncertainty, counter-evidence, proposed conclusions, decisions, and overrides. A polished landing page or one successful model response does not constitute completion.

## Completion and Communication

Use the product design's Definition of Done as the MVP acceptance checklist. Before declaring a meaningful implementation complete, run the applicable checks defined in `` and report:

- what user-visible or invariant-backed behavior now works;
- files and architectural boundaries changed;
- exact verification commands and results;
- cost or deployment implications;
- assumptions, remaining gaps, and blocked uncertainties;
- the next smallest coherent slice.

Do not hide failing checks, unsupported provider behavior, incomplete security controls, or mocked integrations behind optimistic wording.
