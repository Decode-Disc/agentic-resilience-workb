---
type: request
repos:
  - identifier: "abdwhb-png/decoding-discontinuity-proto"
    sha: "cf757669701104f835a29fb1f0941d1c78ce3304"
flow: tdd
---

# Request: Sources execution, missing response content, and evaluation integrity

Investigate why the Sources documentary control generated 45,867 completion tokens, why its response content cannot currently be recovered, and why the operation lost its result. Investigate the evaluation defects that allowed downstream Sources preparation to block independent Workbench cases and later rejected a final model request despite low reported charges. Establish shared causes and affected callers before proposing corrections; a scenario-specific workaround does not satisfy the request.

The user selected research followed by technical design. Here, TDD names the technical design document, not the repository's separate test-driven development requirement. Start with research questions and keep research separate from design and implementation.

## Scope and available evidence

The main thread already completed six Workbench-only evaluations and a Sources timeout investigation. Reuse its retained evidence rather than repeating those evaluations. Its report describes a parent dispatcher interruption at approximately five minutes, a child model deadline at approximately nine minutes fifty seconds, and an operation with no recorded result. It also describes a missing evaluation protocol accounting policy that leaves maximum reservations budgeted after final costs become known. These findings remain inputs to verify at their actual owners, not permission to implement a predetermined fix.

The side chat queried OpenRouter MCP through Executor for generation `gen-1795023997-J0fvISV95BakDdWI2icV` in the Agentic Resilience workspace. Metadata reported 45,867 completion tokens, including 2,243 reasoning tokens, 589,336 ms generation time, Wafer, cancellation and upstream status 499. A direct authenticated `GET /api/v1/generation/content?id=gen-1795023997-J0fvISV95BakDdWI2icV` returned HTTP 404 with `Content not available for this generation`. The same configured access returned HTTP 200 for the generation metadata in workspace `19c2d15f-3d11-4fdc-b281-0abb63154f13`. This does not establish why content is unavailable or what the model generated.

Do not modify the running backend, production code, provider settings, dependencies, or historical evidence during research. No paid replay is authorized by this request. Keep Workbench framing write/persistence defects outside this task. Preserve the shared dirty worktree and coordinate any later overlapping implementation with the main thread.

## Source pointers

- Main conversation: [Workbench ignores analyst question](t3-thread://v2/fd444fb6-ad2f-436e-94ed-43654c2044a4/9f877a17-61e0-4afa-8eb9-13c14fd75d13).
- Current diagnosis: [Workbench framing and Sources timeout](../../../docs/verification/2026-11-18-workbench-framing-live-and-sources-timeout.md), especially evaluation relay interruption and Sources sections.
- Earlier campaign: [Grounded framing and coverage](../../../docs/verification/2026-11-18-grounded-framing-and-coverage.md), first authorized real-model frozen replay section.
- Local original evidence: `/home/abdwhb/.cache/workbench-evaluations/directed-framing-frozen-model-20261118-current-candidate`.
- Supplemental preserved evidence: [Archive record](../../../scripts/evaluations/archives/20261118T183803479Z-workbench-six-and-sources-diagnosis/record.json).
- OpenRouter: [Stored generation content API](https://openrouter.ai/docs/api/api-reference/generations/get-stored-prompt-completion-and-error-content-for-a-generation), [input/output logging](https://openrouter.ai/docs/guides/features/input-output-logging).

## Desired research result

Explain each observed failure through its execution or data flow, identify affected shared owners and existing test coverage, and distinguish proven causes from hypotheses and irrecoverable evidence. State whether the excessive token content is recoverable through existing authorized access; if not, explain precisely which evidence is missing. Technical design should then address shared mechanisms and preserve native Pi Durable execution, accounting, cancellation, provenance and explicit partial outcomes.

## Operational update for technical design — 2026-11-19

After the research, the user reported enabling OpenRouter input/output logging and connecting Arize to OpenRouter for future observability. Treat this as user-configured external infrastructure. A future authorized execution must verify actual log reception and correlation; this update does not establish a new observation or recover the earlier missing completion. The user requested technical design in this task directory with `flow: tdd`; implementation remains a later phase.
