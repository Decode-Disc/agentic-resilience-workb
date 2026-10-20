# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Document Authority

This file captures durable product context for design work. It summarizes, rather than replaces, the authoritative project documents: [AGENTS.md](AGENTS.md) governs agent conduct and product guardrails, [context/PROJECT.md](context/PROJECT.md) owns purpose and framing, [context/TECH.md](context/TECH.md) consolidates technical contracts, the [product design](docs/product-architecture/2026-07-20-agentic-resilience-evidence-workbench-design.md) defines MVP acceptance, and accepted records in [docs/decisions/](docs/decisions/) explain individual decisions. Material changes to those contracts require an explicit product decision.

## Users

Raphaëlle d'Ornano is the primary audience evaluating this original unsolicited application. The prototype must make the author's analytical judgment, rigor, and ability to execute visible within the first minute.

The intended operators are strategy, finance, and investment analysts working around Decoding Discontinuity and D'Ornano + Co. They prepare architectural assessments of US-listed technology companies and need to assemble, locate, classify, challenge, and review public evidence without surrendering their judgment.

## Product Purpose

The Agentic Resilience Evidence Workbench is a private research prototype that accelerates preparation of evidence-backed architectural assessments. Its primary artifact is the evidence matrix. Architecture maps and briefs are derived views.

Success means demonstrating that an analyst can prepare a credible, inspectable dossier faster while retaining control over sources, uncertainty, and conclusions. Acceleration must be measured before it is claimed. The candidature should demonstrate value to Raphaëlle and her team rather than breadth of AI tooling.

## Positioning

The workbench connects evidence about technical architecture to possible economic consequences: who receives user intent, owns operational context, controls workflows, can act across systems, and may retain or lose value as agents change the unit of execution.

It is an independent contribution to a public research problem. It does not reproduce ARAF™, Durable Growth Moat™, or any other proprietary methodology. It is not an autonomous investment analyst, a generic chat application, or a report generator whose citations cannot be inspected.

A technical harness makes model intelligence operational. Economic orchestration concerns control of the relationship between intent, context, workflow execution, and business outcomes. Sophisticated internal AI tooling does not itself establish a company's durable economic position.

## Operating Context

The analyst selects and confirms a public company, optionally supplies a research angle and public HTTPS references, reviews discovered sources, approves the corpus, inspects precisely cited claims, and reviews proposed assessments by dimension. The completed product derives its map and brief from validated evidence. These are product requirements, not a claim that the entire journey has already been delivered or verified.

Company search and preflight are available before workspace admission. Research dossiers and administration require the appropriate access. Durable access lets an admitted analyst return to their dossiers and decisions.

The demonstration combines a clearly labelled curated dossier with genuinely live company resolution, source discovery, persisted progress, and an explicit corpus-approval checkpoint. Cached, seeded, illustrative, and precomputed material must remain distinguishable from live research. A selected showcase company or deterministic fixture does not establish a completed, analyst-approved dossier.

The current interface does not yet meet the intended standard for restraint, ergonomics or ease of learning. It is a starting point for progressive improvement, not a finished interaction model. The goal is a calm, understandable workflow that makes research easier and avoids unnecessary cognitive load for the analyst.

The system should prepare and organize work proactively, resolve routine steps autonomously within the evidence rules, and advance work that does not require analyst judgment. Human review should focus on exceptions and material decisions rather than repeated confirmation of every item or internal step. Prefer clear defaults, progressive disclosure and grouped review where appropriate. Preserve the mandatory corpus-approval checkpoint and final analyst authority over analytical decisions.

## Capabilities and Constraints

- Source discovery and evidence extraction are separated by a mandatory, durable human approval checkpoint. Only accepted sources in the approved corpus may contribute downstream. Rejected and pending sources cannot support conclusions.
- Claims are atomic and classified as `Fact`, `Inference`, `Hypothesis`, or `Unknown`. Every material claim references precisely locatable source passages. Supporting evidence, counter-evidence, and critical unknowns remain inspectable before dimension review.
- Each assessment dimension has separate position, evidence-based confidence, and three-year direction outputs. There is no aggregate resilience score or investment recommendation. Weak evidence may remain mixed, hypothetical, unknown, or insufficient.
- Analyst decisions and justified overrides are append-only and audited. Retries and later model output cannot overwrite them. Briefs use only analyst-approved claims. Map entities and relationships require validated supporting claims.
- Progress reflects persisted workflow events. Never simulate progress, expose hidden chain-of-thought, or stage agent activity. Retries and resumes must not duplicate evidence or external side effects.
- Manual source intake accepts public HTTPS references, including public PDF URLs. Local file upload, non-US markets, continuous monitoring, simultaneous analyst collaboration, trade execution, fine-tuning, general-purpose crawling, and autonomous publication are outside the approved MVP.
- Convex owns application state and evidence policy. Keep the established stack and provider boundaries. Product scope and evidence controls do not change with a provider, model, or research angle.

Detailed assessment dimensions, workflow contracts, security boundaries, and current implementation limitations belong in the authoritative documents and scoped [verification records](docs/verification/). This context record is not an acceptance report.

## Brand Commitments

Use the existing Agentic Resilience Evidence Workbench name and project identity. Application copy, code, fixtures, and documentation are in English. Write for an institutional research audience with precise language about evidence, uncertainty, consequences, and next actions. Keep internal architecture, operational configuration, and raw backend errors out of public and analyst-facing copy.

Preserve the incumbent interface and established interactions during refinement. Existing visual constraints and their rationale remain in [AGENTS.md](AGENTS.md) and the [design-system reference](docs/design-systems/2026-07-24-evidence-workbench-design-system.md). This product record introduces no new visual direction.

## Evidence on Hand

- The accepted [CCC Intelligent Solutions showcase scope](docs/showcases/2026-07-21-ccc-showcase-selection.md) defines a bounded photo-led US auto physical damage claim workflow and a falsifiable orchestration question. The selection predetermines no analytical conclusion and is not proof of a completed dossier.
- The [CCC showcase fixture entry](src/__tests__/fixtures/evidence/ccc-showcase-manifest.ts) exposes deterministic test material. Fixtures establish neither current external facts nor live provider performance.
- The repository contains an existing landing page, research workspace, source review, and evidence-matrix implementation. Their presence does not establish complete protected-journey acceptance. Historical verification reports retain their failures, limits, and unrun checks.
- Existing logo assets are in [src/assets/logos/](src/assets/logos/). Visual references and design-system documentation are project assets, not customer endorsements or proof of an assessed company's resilience.

Do not invent testimonials, customers, benchmarks, investment outcomes, or measured time savings.

## Product Principles

1. Make the author's analytical judgment and its economic relevance legible.
2. Keep evidence provenance, uncertainty, and counter-evidence inspectable.
3. Preserve human authority through explicit approvals and reversible, audited revisions.
4. Make analyst work easier through proactive preparation, exception-driven review and the smallest honest end-to-end slice.
5. Prefer deterministic, reusable mechanisms and proportionate controls over speculative breadth or orchestration theatre.

## Accessibility & Inclusion

Support desktop and mobile web use, keyboard navigation, semantic HTML, visible focus, explicit labels, sufficient contrast, and status cues that do not depend on color alone. Respect reduced-motion preferences. Loading, empty, partial-failure, review, cancellation, and insufficient-evidence states must remain understandable and actionable. Critical journey verification must cover the intended admitted role and access state.
