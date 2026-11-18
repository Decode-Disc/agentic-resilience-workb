# ADR-029: Ground Workbench Framing and Carry Coverage Through Handoffs

## Status

Accepted design on 2026-11-18. [PRODUCT](../../PRODUCT.md#operating-context) owns the analyst-facing behavior, [TECH](../../context/TECH.md#workbench-conversation-steering-and-instructions) owns enforcement, and [the roadmap](../ROADMAP.md#phase-6--framing-and-controlled-transition) owns implementation and qualification status.

## Context

In a local NVIDIA dossier, Workbench received the exact question about surviving a recent crisis. The first model response framed research around an early-2025 episode and the existing framing operation saved it. The published reply described that interpretation as unconfirmed. The offered tools could inspect the dossier and save framing. Public-event lookup was unavailable. The coverage preset was stored on the dossier, while active Sources discovery used the mission's need and query without using the preset.

## Decision and rationale

- **Verify context within the framing turn and bind its provenance at the write.** Prompt guidance alone would still allow an unobserved event to become the saved scope. Starting lookup at turn admission fixes the order of calls but can spend resources on edits that require no lookup or where the need becomes clear only during the turn. Shared search and reading integrations serve the narrower lookup under framing authority. Provenance can be checked when writing the draft. Choosing the relevant event and framing useful questions remain matters for qualification.
- **Let Workbench consult existing work and route decisive gaps.** The receiving mission can confirm whether a check is admissible or already underway. Keeping that judgment and its receipt with the mission makes the analyst's conversation useful while preserving the versioned research record and its authority.
- **Carry the applied coverage policy in the prepared-material handoff.** Reconstructing coverage from the journal at read time could give later consumers a different account from the one Investigation received. Creating mandatory per-family needs would use question capacity for a coverage quota. A versioned handoff carries the actual work and its limitations so later judgments can explain their effect on the conclusion.
