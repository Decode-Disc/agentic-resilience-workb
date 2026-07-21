# AGENTS.md

## Mission

Build the Agentic Resilience Evidence Workbench as the central proof in an original unsolicited application to Raphaëlle d'Ornano. The product is a private, evidence-first research prototype that helps analysts assess the architectural resilience of US-listed technology companies.

This is not a generic AI chat application, an autonomous investment analyst, or a reproduction of Decoding Discontinuity's proprietary methodology. The system accelerates research and structures judgment; the analyst remains the final authority.

The first-minute objective is to make the author's judgment, rigor, and execution visible to Raphaëlle. Work that does not materially improve that demonstration must not delay the prototype.

## Document Authority and Required Reading

The repository separates agent conduct, product context, technical contracts, and decision rationale:

- `AGENTS.md` defines how agents work and the non-negotiable guardrails they must preserve.
- `context/PROJECT.md` defines why the product exists, whom it serves, and what it must demonstrate.
- `context/TECH.md` consolidates the active technical architecture, implementation contracts, and verification expectations.
- `docs/plans/2026-07-20-agentic-resilience-evidence-workbench-design.md` defines the complete product design and MVP acceptance contract.
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

Documentation-only edits do not require a failing automated test. Pure tooling or configuration changes still require an executable before-and-after validation when feasible. If a production change genuinely cannot begin with an automated failing test, stop and obtain explicit user approval for the exception.

Always refer refer to `tdd` skill for complete guidance for test-driven-development.

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
