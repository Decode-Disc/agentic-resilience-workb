# ADR-027: Settle Sources at Its Limits and Let the Analyst Renew the Window

## Status

Accepted on 2026-11-15 (design) and implemented on 2026-11-16. Current obligations live in [PRODUCT](../../PRODUCT.md#source-preparation-and-corpus-review) and the [Sources technical contract](../../context/TECH.md#sources-mission-and-prepared-material).

Superseded in part on 2026-11-16 by [ADR-028](028-ask-for-approval-through-general-requests-and-dossier-grants.md): the time-limit decision is an approval request and grants may continue automatically. The window now comes from the required deployment setting; eligible failed dossiers have an internal recovery path. The historical alternatives and failure disposition below describe the earlier implementation.

## Date

2026-11-16

## Context

On 2026-11-15 a local ServiceNow dossier used its fifteen-minute Sources window before its counted envelope: five of six acquisitions were used and documentary controls remained. A control was still in flight at the deadline, so its outcome became unknown and the mission was blocked. The research workflow then asked `sourcesMission.finish` to hand off the retained material, but the handoff read the preparation through the paid-work fence, which refuses anything after the deadline; `completeSources` repeated that check and also refused exhausted model budgets. The workflow failed, `researchWorkflow.onComplete` marked the run `failed`, and that state is terminal. The analyst saw "Needs attention" with no available action, the Sources page described material as available although nothing had been handed off, and Workbench could only say that a problem needed attention.

The product already required the opposite: hard ceilings may leave work unfinished, a controlled partial result is handed back with its limits, unknown outcomes stay unfinished, and recovery never resets consumption. The defect was one fence answering two questions — may more paid work start, and may the system settle what already exists — so the cases that most need settlement were exactly the ones refused.

## Decision

- **Settlement is separate from dispatch.** System handoff uses a settlement fence that keeps currency, generation, ownership and cancellation checks but not the dispatch deadline, lease or model budget. Paid dispatch and model-authored completion keep their fences.
- **A time limit with remaining capacity asks the analyst.** The stop becomes a recoverable `execution_time_limit` before any completion notification and pauses research with `sources_time_limit`. The analyst chooses Continue preparation, which renews the installed window for the same mission without resetting counters or repeating unknown outcomes, or Use what's prepared, which hands off with limits without claiming the execution slot. Continue is shown disabled with its reason when the slot, paid work or capacity does not allow it.
- **No remaining capacity settles automatically.** The material is handed back with its limits; there is no added cap on continuations because the existing counters and budget bound them.
- **One phase owner.** Convex derives the Sources phase once; the workspace, the conversation mission card and Workbench translate the same value.

The design kept the existing recovery path: the same-mission resumption that `execution_interrupted` already uses, rather than a new continuation mission, so the agent keeps its history and the research workflow keeps waiting on its original completion event.

## Alternatives

- **Hand off first, then offer Continue.** Rejected by the user and the evidence: continuing would reopen a frozen result and give the analyst and Workbench two versions of the prepared material.
- **Pause and offer only Resume.** Rejected: an analyst unwilling to spend more time would have no way to obtain the material.
- **A separate settlement state machine on the preparation.** Rejected: it would duplicate the run's pause state as a second lifecycle owner.
- **Move settlement out of the durable workflow.** Rejected for now: it would decouple workflow failure from dossier failure more completely, but rewrites the workflow structure that legacy paths and generation fences rely on.
- **Remove the time window and rely on counts only.** Deferred: the fifteen-minute window is an installed limit. Reconsider it if measured runs show the window, rather than the counts, usually ends preparation.

## Consequences

A genuine defect can still mark a run `failed`; its copy now states that the analysis cannot continue and that gathered sources remain visible, without offering an action that cannot work. The existing failed dossier of 2026-11-15 is not repaired; a new analysis replaces it. The frequency of real time limits and the quality of continued material remain unmeasured.
