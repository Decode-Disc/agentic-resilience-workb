# Approval Requests and Honest Sources Time Limits

**Status: accepted design, 2026-11-16; implementation pending.** The user accepted every section below during the brainstorming session of 2026-11-16, which followed the delivery of [ADR-027](../decisions/027-settle-sources-at-limits-and-let-the-analyst-renew-the-window.md) in commit `c0d74f1`. This dated record preserves the decisions and their rationale. The executable sequence is the implementation plan (removed on 2026-11-17; retained at `git show f012626^:docs/plans/2026-11-16-approval-requests-and-sources-time-limit.md`). Current obligations move to [PRODUCT](../../PRODUCT.md), [TECH](../../context/TECH.md) and an ADR when the work is delivered.

## Destination

One coherent design covering a single configurable Sources window, honest handover outcomes including the case where nothing was prepared, a general mechanism through which the system and any agent can ask the human for an approval in the chat, the two open Sources-page defects, and the reopening of dossiers that failed because of the time-limit defect.

## Research foundation

- **The window was hardcoded twice.** `SOURCE_PREPARATION_DEADLINE_MS = 15 * 60_000` in `convex/resourcePolicy.ts`, and the research mission deadline fell back to a second constant, `EXECUTION_WINDOW_MS`, in `convex/execution/missions.ts`. The counts already came from the `SOURCES_MISSION_ENVELOPE` deployment setting and were pinned on each preparation.
- **The split between policy and settings.** `resourcePolicy.ts` is imported by the browser and never reads deployment settings; `resourceLimits.ts` is server-only and reads them. Deployment settings are declared in `convex/convex.config.ts`.
- **"Completed with limits" misled.** `completeSources` records `blocked` when the handover keeps no document, and `sourcesPreparationPhase` mapped every non-complete outcome to `completed_with_limits`. The automatic handover also stamped every need with the same note, so needs with contributions read "Unfinished" without their counts.
- **Needs read "In progress" during a pause.** `convex/sourcesWorkspace.ts` returned `in_progress` for every need without a handed-off result, whatever the run state.
- **Workbench could not act on a request for help.** `control_research` acts only when the analyst's own message matches a closed command grammar; there was no operation for the handover, no approval surface, and Workbench speaks only after the analyst writes.
- **The failed dossier cannot recover by itself.** `researchWorkflow.onComplete` marked the run `failed`, which is terminal, and the durable workflow that waits for the Sources mission had ended. The failed run consumed one of the visitor's three analyses; `admin.restoreQuota` only restores unused reservations.
- **Agent names lived only in the frontend.** `src/components/chat/conversation-agent.ts` owns "Sources Agent"; backend copy wrote the bare word "Sources", which also names the page and the documents.
- **Reusable pieces.** `AgentQuestion` and assistant-ui's external-store runtime render the chat; `recordControlExchange` already writes app-authored replies without a model call and syncs them passively into the native history; the `@assistant-ui` registry provides `elements-approval-card` with Allow once, Always allow and Deny.

## Decisions

### Approval requests are a general chat mechanism

- **Cards appear in both cases:** the system posts a card as soon as a decision is needed, and an agent offers the same card again when the human asks for help.
- **Every state change an agent infers from ordinary text needs approval.** Exact commands keep acting immediately. The model never approves anything.
- **Deny and Always allow both work.** Always allow is remembered per dossier and per action, applies to decisions the system raises, and can be revoked from the Commands picker or from the card's receipt.
- **Names are general.** Nothing in this mechanism is named after the analyst: the requester is the system or an agent, and the decider is recorded with the existing actor shape.
- **One stored record and one catalogue (option 1).** `approvalRequests` and `approvalGrants` are written only by `convex/execution/approvals.ts`. `convex/execution/approvalCatalog.ts` lists the approvable actions like `agentCatalog.ts` lists agents; each action declares its availability, how it runs through its existing owner, whether it can be granted for good, and which grants exclude it. A single `approvals.decide` serves the chat card and the page buttons.
- **The card is assistant-ui's `elements-approval-card`, adapted** to Hugeicons, the project's tokens and `Button` variants. It defaults to Allow once / Always allow / Deny, and each use can replace the choices.
- **The time-limit card names both options.** Its title is "The Sources Agent reached its time limit", its buttons are "Use what's prepared", "Continue once" and "Always continue", and each option's consequence is stated. Deny is not used for a two-option decision.
- **Continuing is not capped in number.** Each Continue spends what remains of the dossier's counts and model budget; when they run out the material is handed over automatically. With Always continue the system continues by itself unless another dossier holds the execution slot or paid work is switched off, in which case the card appears with Continue disabled and its reason.
- **Awareness.** Workbench's facts include pending requests and active grants, and each decision is recorded as a control exchange synced passively into the native history.

### Sources time limits

- **Window setting.** `SOURCES_PREPARATION_WINDOW_MINUTES` is a required deployment setting, read only by `sourcePreparationWindowMs()` in `resourceLimits.ts`, with no value in code. Missing or invalid, starting or continuing Sources is blocked with the existing configuration-unavailable reason. Each preparation keeps the window it started with; each Continue reads the current value. A research mission's deadline follows its preparation. `SOURCES_QUALIFICATION_RESEARCH_WINDOW_MS` stays, because it belongs to recorded evaluation campaigns.
- **Honest outcomes.** A new phase `ended_without_material` ("No usable material prepared") covers a handover that keeps no document; `completed_with_limits` is reserved for real partial results. During a pause, needs read "On hold" with their counts. After a handover, each unfinished need carries a note stating the actual cause, and unfinished needs show their counts.
- **One dark button.** While a decision is pending, the card holds the only primary action and "Inspect sources" is outlined.
- **Agent names.** `convex/domain/agentIdentities.ts` owns each agent's id and display name; every agent definition points to its identity; the frontend adds only icons. Copy never uses the bare stage word for the agent.

### Reopening failed dossiers

An internal mutation run from the Convex CLI reopens a dossier only when it failed because of this defect: research purpose, not withdrawn, failed in the Sources phase with `run_failed` as its latest event, preparation still `started` without result or handover request, and the Sources mission blocked by `execution_deadline` or `operation_outcome_unknown` past its deadline. It reclassifies the stop as a time limit, starts a new research workflow that re-attaches to the existing preparation and mission, raises the time-limit request, and writes an audit event. Running it on the ServiceNow dossier is a separate step after explicit confirmation.

## Ruled-out paths

- **Approval as a step of every tool call (option 2).** Ruled out on evidence: the time-limit decision is raised by the system, and suspending a tool call across turns would change every agent's execution.
- **Decisions derived from state without storage (option 3).** Ruled out on evidence: denials and agent proposals need storage anyway, which yields two mechanisms.
- **No cards from the model (option 4).** Ruled out by the user's requirement that the agent offers the card when asked for help.
- **A default window constant in `resourcePolicy.ts`.** Rejected by the user as an unnecessary second place for the value.
- **Refunding the analysis or leaving the dossier failed.** Rejected by the user in favour of reopening it.

## Remaining uncertainties

- **Whether the live model calls `request_approval` correctly** is unverified; it needs a bounded paid qualification authorized separately.
- **The quality of material gathered after a Continue** and how often real runs reach the window remain unmeasured.
- **Rendering of the approval part by assistant-ui 0.15.31's external-store runtime** is expected from its documented tool-call parts; the plan checks the installed types first.
