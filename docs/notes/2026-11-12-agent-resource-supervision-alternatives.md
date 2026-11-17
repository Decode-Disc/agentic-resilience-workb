# Agent resource supervision instead of fixed turn budgets

Date: 2026-11-12. Status: deferred exploration. These are tentative alternatives, not an accepted design, implementation plan or change to current execution authority. No work on these alternatives is requested now.

## Motivation

The user questions whether fixed turn budgets are an appropriate way to govern agents: the number of consultations or generations does not reliably predict the work needed to complete a mission. In their day-to-day Pi setup, `pi-subagents` turn budgets repeatedly interrupted workflows and made delegation frustrating. The user recalls that `turnBudget` was ultimately removed. The affected repository/version, removal history and rationale have not been independently verified.

Reference: [pi-subagents package](https://pi.dev/packages/pi-subagents?name=pi-subagents). The package documentation checked on this date describes parent/child sessions, supervision and steering; it does not by itself establish the reported turn-budget removal history or prove suitability for Workbench.

The [CCC qualification](../verification/2026-11-12-native-api-ccc-live-qualification.md#first-failure-completion-formatting-consumed-the-remaining-progress-allowance) illustrates a related local concern: two consultations and a first malformed completion exhausted a shared no-progress counter before corrective feedback could be used. This does not establish that all limits are wrong or that a supervisor would necessarily make a better decision.

## Alternatives to explore later

- **Agent-initiated requests to a parent.** An agent could ask its parent for help, clarification, changed scope or continued work when it encounters a blocker or cannot finish under its current allocation. The parent could assess retained progress, unresolved needs and the reason for the request rather than treating a turn count as a completion forecast.
- **Boundary-triggered parent notification.** Reaching a legitimate boundary could create a durable checkpoint and notify the parent instead of merely terminating with a generic partial result. The parent might continue within existing authority, revise the approach, accept an explicit partial outcome, or stop. Approaching-boundary notification is another possibility, not a chosen mechanism.

The parent is deliberately unspecified: it could be deterministic system policy, a supervising agent such as Workbench, or a combination. Routine internal supervision need not become another task for the analyst. Requests and notifications are related alternatives; neither requires a new orchestration framework by assumption.

## Questions left open

- Which boundaries should prompt supervision, and which must still stop external work immediately? Turn counts, observed repetition, spending authority, provider capacity, deadlines, stalled I/O and cancellation serve different purposes.
- How can the parent distinguish useful consultation or first-time correction from genuine repeated failure without requiring a database mutation on every turn?
- What evidence and continuation state would let the parent make a useful decision without reconstructing the entire run or replaying uncertain effects?
- Who can authorize continuation or a larger allocation? A notification or parent reply cannot automatically enlarge the user's approved spending or other hard authority; work outside that authority would remain paused pending a valid grant.
- How would this avoid moving the same arbitrary cutoffs into the parent, endless extensions, noisy alerts, extra model calls or unnecessary analyst confirmations?
- Before selecting an approach, what can existing Pi and Workbench supervision, persistence, accounting and continuation mechanisms already provide?

The present completion-recovery proposal remains a separate question. This note does not approve that patch, replace current safeguards, authorize new inference, or commit the project to parent-supervised execution.
