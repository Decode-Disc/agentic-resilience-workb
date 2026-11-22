# Sources harness review remediation verification

Date: 2026-11-22. Branch: `sources-workflow-no-legacy`. Scope: remediation of the reviewed native Sources harness implementation, preserving retained agent definitions and existing execution authority.

Status: implementation, behavioral regressions and final static checks passed.

## Delivered behavior

- Native model catalogue metadata is separate from offline profile measurements. Catalogue invalidation uses active measured keys; historical keys remain under the exact installed SDK tuple. Profile reads and writes use 256-row batches, with readiness/catalogue publication confined to the final transaction.
- Native completion bindings reject native conversations and non-Pi backends. Unpinned historical callers resolve compatible retained definitions; explicit incompatible pins fail closed. Shared refusal rendering enforces the complete tool wrapper's byte capacity. Refused corrections restore prior working notes, including terminal capacity failures.
- Structured terminal settlement defers waiting-owner notification until success or permanent failure. Expired unclosed writers consume the same bounded settlement attempt policy as explicit worker closure. Ordinary native turns avoid terminal-invocation RPCs.
- Sources reading windows, strict decisions and admitted capture states share transaction-local reads with query/document accounting. Empty admitted capture sets issue no reading-window queries. Unadmitted committed captures do not hide capturing or unavailable states. Workbench and Sources consumers reuse loaded records.
- History fragments project loaded event parts once. Page fitting accumulates entry bytes against precomputed wrapper/state sizes and passes the remaining allowance into fragment reads. Existing receipt verification continues enforcing predecessor frontier agreement.
- Approval availability preserves inapplicable-action feedback during analyst pauses. Card decision feedback has one presentation owner. TECH terminology and scan/page limit attribution match the runtime owners.

## Behavioral evidence

All 18 plan-named suites passed: 290 tests, 273.87 seconds. After the final review found and corrected working-note rollback on terminal correction refusal, all six affected suites passed: 148 tests, 90.52 seconds. The final correction suite includes the added adoption-boundary capacity regression. The final full profile-capacity suite also passed all 12 tests, including active/retained lookup and selected-envelope arithmetic; removing either corresponding fix made its focused regression fail.

The real Sources capacity case admits a nondefault envelope and produces 65,365 bytes of correction feedback: the feedback fits the 65,536-byte result allowance, but its native refusal wrapper exceeds tool-output capacity. Adoption blocks with `operation_result_capacity` and retains the original working notes. No domain completion method is mocked.

Mutation checks failed as intended when the canonical predecessor-frontier comparison or native refusal sizing at correction adoption was temporarily removed; both owners were restored. The profile generator uses the checked-in retained measurements or an explicitly supplied baseline and does not require a local-only artifact. Native conversation regressions exercise stale instructions, Pi ToolTask's `invalid_arguments`, and genuinely waiting work that resolves to value 14 before replaying the retained completion without another generation. These use deterministic generation fixtures and real internal collaborators.

Measured logical read changes: one inline invocation fragment loads its payload once rather than twice; repeated reading windows use two index queries total rather than four, and empty capture sets use zero. A permissive decision reuses the strict result rather than doubling the observed 1,060 bytes to 2,120 bytes. Fragmented Unicode invocation history reconstructs exactly across multiple pages, each within 64 KiB. These are logical database/read measurements, not claims about physical storage I/O or live provider latency.

Reproduce the plan regression set with:

```sh
pnpm exec vitest run src/__tests__/convex/admin/model-configuration.test.ts src/__tests__/convex/execution/agent-backends.test.ts src/__tests__/convex/execution/approval-catalog.test.ts src/__tests__/convex/execution/conversation-history.test.ts src/__tests__/convex/execution/history-read-cost.test.ts src/__tests__/convex/execution/mission-history.test.ts src/__tests__/convex/execution/operation-conformance.test.ts src/__tests__/convex/execution/pi-input-capacity.test.ts src/__tests__/convex/execution/pi-native-transport.test.ts src/__tests__/convex/execution/pi-recovery.test.ts src/__tests__/convex/execution/profile-recovery.test.ts src/__tests__/convex/execution/research-state.test.ts src/__tests__/convex/execution/workbench-model-selection.test.ts src/__tests__/convex/integrations/profile-catalogue.test.ts src/__tests__/convex/sources/sources-completion-correction.test.ts src/__tests__/convex/sources/sources-completion.test.ts src/__tests__/convex/sources/sources-mission.test.ts src/__tests__/lib/presentation/approvals.test.ts --maxWorkers=1
```

## Static checks and review boundaries

`pnpm typecheck`, `pnpm lint`, `pnpm docs:check`, `pnpm agent-skills:check`, `pnpm resource-policy:check`, and `pnpm format:check` were run. The final typecheck/lint rerun passed. Formatting also passes for all changed TypeScript/JSON files. The derived NVIDIA citation test fixture required indentation normalization for the repository-wide format check; parsed JSON values were independently identical before and after. Archived raw records were not rewritten.

Existing repository diagnostics include CSS-specificity warnings, archive records above the formatter/linter scan-size allowance, and an existing benchmark type-assertion warning. These do not establish new defects in the remediation. No suppression or weakened assertion was added.

The final review was a local self-review under the project's restriction on unrequested review delegation. It is not an independent reviewer approval. No browser session, live provider qualification, Convex synchronization, deployment, push, or merge command was performed. This report establishes deterministic implementation behavior, not semantic model reliability or live analytical acceptance.

## Preserved decisions and plan rulings

The settlement operation's existing `stale_execution` result, retained historical agent definitions and additive `activeWork.progress` remain as explicitly deferred in the remediation plan. Predecessor frontier agreement was already enforced in the canonical receipt verifier; an additional copy of that check was removed after mutation testing demonstrated its redundancy. Generated measurements contain 1,372 active keys and 1,335 historical-only keys, rather than the plan's approximate counts; the 1,362-key historical baseline overlaps 27 active keys.

The plan's task helper referenced an absent supporting script directory, so task evidence was recorded locally. Related implementation and pre-existing native Sources harness changes remain on their original branch; no extra worktree or dependency change was introduced. Documentation changes revise current statements in their owning reference and introduce no new normative document.
