---
type: request
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "6043a64af02577cb3aaf13eb2a3ce1e8804f7060"
flow: tdd
---

# Original Request: Recovery from Nonproductive Generation

The user clarified that the harness weakness concerns its failure to recover from an empty or nonproductive model generation, requested an Oracle consultation, and selected targeted research followed by a technical design document. The intended result is useful completion after a recoverable generation failure, with existing evidence, authority and cumulative resource guarantees preserved. The earlier receipt/billing settlement correction does not satisfy this request.

## Incident and Desired Outcome

The November 21 documentary control produced a useful JSON prefix followed by 1,131,782 spaces and tabs after `"coherence":`. The action eventually timed out without a complete result. A preceding incomplete generation had successfully retried with the same request. Two later authorized diagnostic calls also succeeded, including the unchanged request; changing schema property order is therefore not a demonstrated repair.

Oracle identified missing structured-progress monitoring, a classification that makes confirmed cancelled documentary controls terminal for retry admission, and a scheduled-operation contract that cannot simply re-enter after its action ends. These are source-backed starting findings, not an accepted implementation design. Research must distinguish a fully empty completed response, incomplete JSON with confirmed termination, continuing whitespace, and a disconnected request whose external outcome remains unknown.

The correction should allow recoverable work to finish without replaying previously adopted effects or requiring the analyst to coordinate routine recovery. Preserve exact diagnostic prefixes, reject incomplete documentary results, account for all attempts, and enforce cancellation, freshness, deadlines and exhausted authority. Keep valid slow or large output possible. A paid cost alone must not be treated as proof that remote generation has terminated.

## Scope and Constraints

Use `workbench-harness-development`, `code-smell-guardrails` and the repository's test-first rules. Inspect existing transport, SDK, admission and durable-operation owners before proposing extensions. Retain native parsing and generation capabilities; avoid a second parser, retry service, budget mechanism, per-agent patch or semantic phrase filter. OpenRouter retains default upstream routing and existing price guards. No arbitrary token, wire-byte or inactivity threshold is approved. The duration and false-stop risk of any proposed inactivity policy remain design questions requiring temporal evidence.

This phase records the request and research questions. It authorizes no implementation, deployment or new paid evaluation. Existing paid mandates are closed. Local retained-data measurements may inform subsequent research; provider experiments require their own authority. A technical design document is distinct from test-driven implementation.

The adjacent [Sources efficiency request](22-request-sources-harness-efficiency.md) covers state projections, history and completion. Reuse its provider-degeneration evidence where relevant, but keep this request responsible for generation interruption and recovery; do not duplicate that broader investigation or reopen the documentary engine design.

## Source Pointers

- [Oracle consultation](t3-thread://v2/fd444fb6-ad2f-436e-94ed-43654c2044a4/thread:delegated-task:command%3Amcp%3A63afbfd8-e886-4fb4-992e-b4b2dc2177f5%3Adelegate-task%3A18eb4030-52c4-42c7-bf16-83b4280837c9), completed in read-only mode at the recorded SHA; no tests or inference were run by Oracle.
- [Qualification report](../../../docs/verification/2026-11-21-framing-fidelity-live-qualification.md) and [separate billing correction](../../../docs/verification/2026-11-21-one-shot-billing-settlement.md).
- Original observations: `/home/abdwhb/.cache/workbench-evaluations/framing-fidelity-method-v3-20261121/shared-material-prepared/lots/lot-1/observations/before-cleanup-8facecc3-e50c-4911-967d-c96630c144b0/nvidia-sources-capture-handoff/`, especially `invocations-10.json`, `invocations-11.json` and `invocations-9.json`.
- Local diagnosis: `.implementation-plans/framing-fidelity-progress/deep-diagnosis/comparison.json`, `arize-controls.json` and `boolean-order-probe/`. These are machine-local evidence, not normative contracts or portable archives.
- [Product](../../../PRODUCT.md), [technical contract](../../../context/TECH.md), [development skill](../../skills/workbench-harness-development/SKILL.md) and [research questions](25-research-questions-generation-resilience.md).
