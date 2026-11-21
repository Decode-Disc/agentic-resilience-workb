# Documentary operation qualification — 2026-11-21

## Result and capability decision

The authorized backend qualification did not reach inference. Its single lot finished with an official failed execution verdict. All documentary behavior checks remain inconclusive: no model, acquisition, search, reading, framing write, Sources qualification or handoff was exercised. The first scenario was blocked during Workbench 11 admission; the second scenario was not run. Reconciled usage is zero model calls, zero documentary calls and USD 0, with no outstanding provider reservation. This result neither rejects nor qualifies the corrected documentary operations.

The campaign is closed, its context revoked and native cleanup completed. No production-code corrections, second lot, model substitution, upstream-provider pin or automated reviewer were used. The next correction should address native-profile readiness and the evaluator's handling of a paused admission failure before proposing another paid qualification.

## Intended measurement

The reviewed worktree was `/home/abdwhb/.herdr/worktrees/agentic-resilience-workbench-proto/refactor-documentary-engine`, branch `refactor/documentary-engine`, base `2816370980accf0155c09d62054ca83511ca43d3`. The admitted candidate hash was `a043220183b7eedf4ef23ebf7f849a98b99b898506f86ed40ccde07de4393320`; its source, checks and fingerprints are preserved in the native lot archive. Defaults resolved to Workbench 11 and Sources 7. The configured model was `z-ai/glm-5.3-flash`, with recommended reasoning resolving to high, through OpenRouter-managed routing and the existing price guardrails. No dispatched request exists to establish model execution or serialized effort.

The user authorized one lot across two NVIDIA dossiers, at most 80 model generations/documentary controls and USD 1 cumulatively, with manual evidence assessment and no code correction or additional lot. Both scenarios retained the complete previously captured filing. The first intended to exercise acquisition, search, contextual reading, citation persistence, accurate publication, continuation after saving and explicit beginning reading. The second intended to exercise provisional-save continuity, actual Start, Sources capture reuse/control/handoff and post-Start Workbench consultation. The concurrent Sources settlement race was separately covered by deterministic regressions; the planned live path would not guarantee that race occurred.

The original prepared mandate duplicated the complete filing three times and failed admission at 1,124,501 Convex value bytes. This was an agent preparation error, not a documentary-operation defect. The user approved a replacement with the same two requests, ordered steps and complete framing documents: its redundant Sources replay was removed, external search/acquisition authority reduced to zero, and its value measured 751,446 bytes against Convex's 1,048,576-byte limit. Sources was to reuse the framing capture. No campaign or paid call was admitted under the oversized draft.

## Observed execution and causes

### Native-profile preparation reports readiness without the required runtime key

The prepared catalogue reported the GLM entry ready and compatible. `prepareQualificationModel` therefore skipped recalibration at [model-preparation.ts](../../scripts/evaluations/workbench-browser/model-preparation.ts). Its compatibility predicate comes from [modelConfiguration.ts](../../convex/modelConfiguration.ts), comparing status, serializer and the catalogue revision. It does not establish that every key required by the selected binding exists.

The first dossier's native Workbench 11 admission failed at [modelInput.ts](../../convex/integrations/modelInput.ts): the exact input-profile lookup returned no overhead and raised `model_input_profile_unavailable`. The persisted conversation had `queuePaused: true`, one queued initial message, that admission failure, no active turn and no mission. Framing remained the empty initial revision. No provider call was recorded.

An explicit, bounded refresh through the existing authenticated `modelConfigurationActions.refreshProfiles` owner completed over two revision pages, without changing the selected model revision or assignments. The catalogue was compatible both before and after. Read-only table inspection observed 135 input-profile rows created during that refresh, out of 1,044 total observed rows. This establishes incomplete cached coverage despite the global compatibility flag. It does not establish that the blocked turn would subsequently admit: the queue was not resumed and no model call was made.

Correct readiness at the existing preparation boundary: verify coverage for the selected current binding/tool contracts before accepting the global compatibility flag, and use the existing refresh owner for missing keys. An integration regression should retain a compatible catalogue with predecessor profiles and prove admission of the current binding after preparation, using controlled inference rather than a live provider.

### The evaluator does not terminate on a pre-turn admission refusal

The wait loop in [scenarios.ts](../../scripts/evaluations/workbench-browser/scenarios.ts) recognizes a blocked conversation mission only when an active turn and mission already exist. This refusal happened before both. The runner kept waiting for native settlement despite the persisted paused queue and admission failure. Parent inspection located that state; the task-owned runner was interrupted through SIGINT to perform its normal evidence capture and cleanup. The archive preserves the interruption separately from the earlier admission cause.

Handle `queuePaused` plus `admissionFailure` explicitly in the existing observation loop. Report the actual refusal instead of waiting for a mission that was never created. If preparation recovery is explicitly part of a future run, use the existing authenticated queue-resume operation through the runner's admitted session; do not patch state or impersonate the analyst. Cover the pre-turn refusal and cleanup through the runner integration boundary.

## Validation and accounting

The parent ran `pnpm exec vitest run src/__tests__/convex/execution/workbench-documentary-continuity.test.ts src/__tests__/convex/sources/sources-completion.test.ts --maxWorkers=1`: 30 tests passed, including beginning/continued-reading citations and terminal Sources settlement before reservation/during held retrieval. These are deterministic evidence for their exercised boundaries.

The runner's preflight passed backend/frontend types, import checks, lint, execution ownership, 232 protocol tests and 234 domain tests across 19 files. Its candidate archive contains the executed logs. No browser validation or full aggregate rerun was performed by the parent. Static/preflight success did not establish runtime profile-cache completeness.

The first automated scenario ran from `2026-11-21T11:53:00.538Z` to its controlled interruption at `2026-11-21T12:06:06.198Z`, approximately 13 minutes 6 seconds. This was admission waiting and investigation, not model latency. Preparation, prerequisite repair and approval waits occurred separately. The second scenario was explicitly recorded unrun. Reconciliation confirmed all four usage counters at zero. The unused grant is not authority for a second lot.

## Setup, restoration and boundaries

The worktree-specific Convex service on port 3238 and site port 3239 were verified; its existing web service on 5187 was preserved. Before admission, the existing prepared GLM model was assigned to Sources through the standard authenticated administration API because only Workbench had an assignment. That standard Sources assignment and the added profile cache entries remain.

Two local prerequisites were restored without publishing code: the runner's private invitation input was reconstructed from existing private worktree material, and missing OpenRouter/SEC/Exa values were temporarily supplied to the local backend from the primary checkout's secure configuration. Secret values were never printed or copied to an environment file. The task-created invitation input was removed. All three temporarily added environment values were removed after checking for concurrent changes; no conflicts occurred. The fixture activation flag was removed at teardown. Native model/controller configuration and runtime services were preserved.

Live retrieval ranking, model quality, citation/publication behavior, Sources control and concurrent settlement remain unqualified. No correction to production code was authorized by this mandate, and none was made. The existing paused-queue authority was not bypassed to force inference.

## Retained evidence

- [Native lot archive](../../scripts/evaluations/archives/20261121T120611993Z-campaign-documentary-operations-corrections-20261121-v2-lot-1/record.json): candidate source/fingerprints, executed checks, scenario snapshots, zero usage, cleanup and the original observed failure state.
- [Manual assessment archive](../../scripts/evaluations/archives/20261121T120842409Z-campaign-documentary-operations-corrections-20261121-v2-lot-1-as/record.json): reconciled manual findings and official failed execution verdict, with behavioral checks inconclusive.
- [Supplementary diagnostic archive](../../scripts/evaluations/archives/20261121T121140874Z-documentary-requalification-20261121-closeout/record.json): original oversized draft, size proof, exact admission observations, explicit profile refresh and cache additions, closed state and restoration evidence; 14 files, 2,057,313 bytes.

All three archives were verified through the existing archive owner. Archives are machine-local; byte preservation does not establish successful behavior. The original local work directory is `/tmp/workbench-documentary-requalification-20261121-hm5pbklc`; durable evidence does not rely on that temporary directory remaining available.

The final source comparison matched the admitted candidate exactly (`a043220183b7eedf4ef23ebf7f849a98b99b898506f86ed40ccde07de4393320`), with no changed fingerprinted paths. The diagnosis did not modify the frozen source.

## Outcome receipt

Notification accepted for project `agentic-resilience-workbench-proto`, sender `Codex`, event `qualification-blocked`, key `documentary-native-profile-a0432201-bca4c806`, candidate `a043220183b7eedf4ef23ebf7f849a98b99b898506f86ed40ccde07de4393320`, message ID `973`. Receipt: `/home/abdwhb/.local/state/agent-stack/notify/8fbcaaae357dc51a270a5899cd0feb6e8d5d02cdeead63b790c2c341c667e2b4.json`.
