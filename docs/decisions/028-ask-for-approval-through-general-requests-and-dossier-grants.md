# ADR-028: Ask for Approval Through General Requests and Dossier Grants

## Status

Accepted on 2026-11-16. Current obligations live in [PRODUCT](../../PRODUCT.md#workbench-conversation-and-research-control) and [TECH](../../context/TECH.md#native-commands-and-delivery). Partially supersedes [ADR-027](027-settle-sources-at-limits-and-let-the-analyst-renew-the-window.md).

## Date

2026-11-16

## Context

`control_research` previously let the Workbench model mutate research execution state (`pause`, `resume`) directly from natural-language interpretation, while Sources time limits rendered bespoke page-only settlement/continue buttons. Both blurred analyst consent: conversational interpretations could change running research without explicit confirmation, and Sources decisions lived outside the general conversation timeline and had no reusable "always allow / always continue" consent mechanism across repeated windows on the same dossier. In addition, dossiers that had failed under the pre-ADR-027 time-limit settlement defect needed a bounded, idempotent internal recovery path back to the decision checkpoint without resetting consumption.

## Decision

- **General approval requests and dossier grants.** Replace `control_research` as a model-offered tool with `request_approval` backed by `convex/execution/approvalCatalog.ts` and `convex/execution/approvals.ts` (`approvalRequests` and `approvalGrants` tables). Each request carries its originating actor, action, optional `alternative` action, dossier execution generation, and decision/outcome.
- **Revocable dossier-scoped grants.** Choosing `Always allow` / `Always continue` creates an active `approvalGrants` record on that dossier. Matching future `request_approval` calls and subsequent Sources time limits with remaining capacity apply automatically while the grant is active and the action is permitted, each application being recorded on its request and posted in the conversation; grants are exclusive where actions conflict and revocable by the analyst at any time from the composer's Commands picker (`Allowed actions`) or from a decided card's `Stop allowing` action. Explicit `/pause` and `/resume` commands continue to act directly through their existing command exchange. Exact natural-language pause or resume commands handled by `request_approval` record approved requests through `recordCommandApproval`.
- **One neutral card UI across conversation and pages.** Render approval requests through `ApprovalCard` and `ConnectedApprovalCard` inside assistant messages (ordered with `conversationMessageContent`), on the Research progress header, and on the Sources workspace page, using `approvalCardPresentation` and `approvalBlockCopy` so raw internal codes are never displayed.
- **Reattach recovery for failed time-limit dossiers.** Add `runRecovery.reopenAtSourcesTimeLimit`, `sourcesMission.reattach`, `missions.rebindCompletionEvent`, and the `reattachSources` workflow branch so an eligible dossier failed by the 2026-11-15 time-limit defect can reopen at `sources_time_limit` without resetting counters or repeating unknown outcomes.

## Alternatives Considered

- **Keep `control_research` with a prompt-only instruction to ask first.** Rejected: prompt instructions are non-binding and leave no persisted consent, stale-execution fence, or revocable dossier grant.
- **Store approvals and grants inside Workbench conversation messages only.** Rejected: system stops (such as Sources time limits) occur outside conversation turns, and Research/Sources pages must project the exact same pending request and availability checks without scraping messages.
- **Auto-grant Sources continuation globally per visitor across all dossiers.** Rejected: cost and time-window consent belongs to a single dossier mandate; cross-dossier automation would quietly consume future analyses without explicit dossier consent.

## Consequences

- Conversational research-control interpretations require explicit analyst confirmation via cards unless the analyst has granted automatic permission for that dossier; explicit `/pause`, `/resume`, and workspace buttons remain direct.
- All pending decisions synchronize into native Workbench history through passive `approval_decision` exchanges and `readApprovalFacts`, preventing duplicate system requests.
- `runRecovery.reopenAtSourcesTimeLimit` repairs eligible failed dossiers on demand after explicit operator/user confirmation, while preserving immutable historical observations.
- Live model tool-selection behavior for `request_approval` and real-run continuation quality after renewed Sources windows remain unverified until authorized live checks run.
