# PR 2 storage migration implementation review

Date: 2026-11-25. Verdict: **request changes before accepting the exposed capacity contract or merging the current candidate**. The additive migration architecture is coherent, but two whole-body paths remain and the candidate's CI is failing. This review does not authorize implementation, deployment, migration, component deletion or paid qualification.

## Reviewed revision and independent lanes

[PR 2](https://github.com/Decode-Disc/agentic-resilience-workb/pull/2) was reviewed at `f4af3901a9946b849d052b0317f188ce998ef970`, against `ab98abfb6800eb35f8262ceb7fd034e2c6ee23bb`. The PR head was rechecked after the three lanes completed and had not changed. The primary checkout stayed on the base branch; candidate execution used a disposable Git archive with the existing, unchanged installed dependencies. No production files were edited.

The user selected three independent reviews. Their full reports are retained: [Oracle](validation/pr2-f4af3901-review/oracle.md), [Code Reviewer](validation/pr2-f4af3901-review/code-reviewer.md), and [Performance](validation/pr2-f4af3901-review/performance.md). Oracle used Codex GPT-6 Astra xhigh; the other lanes used Codex GPT-6.1 Sol xhigh. Each inspected candidate Git objects without communicating with the other lanes. Their original local line links refer to candidate lines even though the primary checkout contains the base; use the pinned GitHub links below for precise implementation locations.

- Oracle: **WATCH**, no confirmed blocking architectural defect within the explicitly partial migration scope.
- Code Reviewer: **COMMENT**, no additional confirmed correctness defect; no merge approval while CI fails.
- Performance: **REQUEST CHANGES**, two remaining capacity gaps.

The independent reviews are source inspections, not runtime certifications. The parent subsequently checked their critical paths and ran the targeted validations below. The implementation thread's reported local migration and browser checks were read as supplied evidence, not reproduced on that deployment.

## Findings requiring correction

### Medium: both public history APIs still permit whole-body reads

In [readConversationPageBodies](https://github.com/Decode-Disc/agentic-resilience-workb/blob/f4af3901a9946b849d052b0317f188ce998ef970/convex/integrations/agentStorage.ts#L1008), omitting `bodyAccess: "separate"` passes all deliveries to `readConversationMessages`. Its retained-body branch calls `readRetainedText`, loading all fragments inside the same query transaction. Both `execution.conversations.listMessages` and `workbench.history` expose this optional contract. Paginating delivery rows therefore does not bound the bytes loaded for those rows. This affects new retained replies, independently of legacy component retirement.

The parent reproduced this through both authenticated public readers using the existing large-response integration fixture and its 128 KiB transaction read budget. The default calls fail with `Read too much data in a single function execution (limit: 131072 bytes)`; explicit separate access succeeds, and the existing assertions reconstruct the complete text and preserve delivery pagination. This is a deterministic capacity regression probe with real production readers and persistence, not a deployed 16 MiB benchmark.

Correction: make body references and independently paged body access the server-enforced retained-history contract, converting the remaining consumers. Do not make safe capacity depend on callers knowing a storage option. Oracle classified the same path as a nonblocking remaining item in this partial PR; Performance classified it as a required correction. This consolidation retains the distinction: the migration architecture can proceed, but the currently exposed history contract cannot be accepted as safe for large retained bodies.

### Medium: unsuccessful preparation falls back to a complete response argument

[preparePiReply](https://github.com/Decode-Disc/agentic-resilience-workb/blob/f4af3901a9946b849d052b0317f188ce998ef970/convex/integrations/piInvocation.ts#L324) returns no prepared reply for malformed completion JSON, invalid completion schemas, and operation responses. [The native driver](https://github.com/Decode-Disc/agentic-resilience-workb/blob/f4af3901a9946b849d052b0317f188ce998ef970/convex/integrations/piMission.ts#L1525) then passes the complete normalized response to `finish` when `useReference` is false. [The mutation](https://github.com/Decode-Disc/agentic-resilience-workb/blob/f4af3901a9946b849d052b0317f188ce998ef970/convex/execution/invocationLifecycle.ts#L1801) serializes it again and parses/validates original completion arguments before returning correction feedback.

Fragmented receipt storage therefore does not remove aggregate mutation arguments or processing from refusal and operation branches. An envelope above the platform's function-argument capacity cannot reach the intended correction logic. The parent verified the control flow; no oversized deployed mutation or provider-generated instance was reproduced. This is a remaining capacity gap, not evidence that every ordinary malformed response fails or that this PR introduced the entire pre-existing behavior.

Correction: extend the existing retained-response preparation path to provide bounded, content-bound validation/refusal and correlation data. Preserve original argument bytes in immutable receipts and retain current authority checks, database-backed validation and effects in the mutation. Verify malformed completion and operation-envelope branches separately; successful prepared prose does not cover them.

### Medium: three CI tests still assume replaced contracts

The exact candidate's `quality` job reports 3 failures out of 3,460 tests. The parent reproduced all three locally; the same two suites pass all 12 tests on the base.

- `workbench-native-admission.test.ts` injects an analyst edit only when invocation admission returns `ready`. The revised driver requests and receives `ready_reference`, so the test never applies the edit. This explains both the missing-scope assertion and the later budget exhaustion. Changing only that test condition in the disposable archive makes both targeted cases pass with their behavioral assertions retained.
- `pi-deferred-wake.test.ts` expects inline `mission.result.text`, while the revised persistence contract stores `textualOutcome`. A disposable probe checks the compact outcome and the actual public assistant message, retaining the zero-provider-call and deferred-operation assertions; all six tests in that file pass without a production change.

These failures establish incomplete test migration. They do not demonstrate a lost analyst edit or absent public reply in production. Correct the tests at their behavioral boundaries and rerun CI; do not weaken production validation or restore duplicate result storage to satisfy old assertions.

## Acceptance watches and test-quality limitation

All remaining independent-review observations are retained here; none is presented as a newly reproduced runtime defect.

| Area | Remaining obligation |
| --- | --- |
| Reconciliation versus functionality | Matching inventories and reopening a scope establish reconciliation, not successful deployed journeys. Component retirement still requires separate evidence bound to the deployment, code and data. No premature deletion path was found. |
| Action memory | Several actions collect fragments, join strings and sometimes parse/render additional copies. Measure peak memory and duration in both Node Pi execution and the default migration runtime on the largest retained cases. |
| Whole-conversation reconciliation | Individual queries are bounded, but one action still scans the entire conversation and retains ownership state. Interruption restarts the reconciliation. Measure the largest selected scope before adding checkpoints. |
| Growing manifests | Each staging/read operation can reload a complete manifest. Traversing all fragments can accumulate quadratic manifest traffic; late-offset range selection also scans preceding offsets. No material latency regression was measured. The 8,192-entry guard is a platform array constraint, not an arbitrary generation cap. |
| Purge and component retirement | Existing byte-aware batching and supplied fixtures do not prove every large-manifest/shared-owner/parent combination. The component deletion evidence covers a 75,000-byte plain-text record, not embeddings, files or active streams. Retain largest-record and interruption evidence before retirement. |
| Complete retained context | Sources, Workbench, standalone consultation and predecessor ancestry need complete retained-graph measurements. Stale-authority refusals leave the full Sources benchmark open. |
| Recovery test doubles | The reviewed native recovery test replaces the definition's `simulate` method and injects a fault through internal Pi storage. Under the strict TDD rules these cases are supplementary, not standalone proof of preserved historical recovery; the separate in-place rehearsal remains relevant. |

The supplied traversal comparison shows no measured improvement for that workload: both revisions used 2 consultations, 65 handler-yielded document reads and 28 event reads; document bytes were 109,193 versus 109,205, and event bytes were 53,313 in both. All 27 payload hashes matched. These measurements exclude outer dispatch, index overhead, deployed I/O, action memory and the missing retained preparation graph.

Source inspection supports the old-stream drain/freeze/backfill contract, both historical textual-result conversions, action preparation with mutation-owned adoption, full response-facts binding, native terminal recovery and first-fragment/superseded preparation cleanup. No lane identified a need for another storage framework, second completion executor, restored repetition stop, or loss of existing analyst features.

## Parent validation and limits

Evidence and temporary probe patches are retained in [the review evidence directory](validation/pr2-f4af3901-review/request.json). All temporary test changes were confined to disposable archives and restored; no proposed fix was applied to the PR or primary checkout.

| Check | Observed result |
| --- | --- |
| Deferred wake and native admission, exact candidate | 9 passed, 3 failed; matches the `quality` failures. |
| Same two suites, base checkout | 12 passed. |
| Native admission probe correcting only the injection trigger | 2 targeted cases passed. |
| Deferred wake probe asserting new storage and public reply | 6 passed. |
| Candidate `pnpm convex:check` with checked-in generated declarations | Passed. This does not reproduce CI backend startup/code generation. |
| Migration, large response, Pi recovery, dossier purge, response control | 92 passed, 4 failed across 5 suites. The 4 failures concern workflow test setup in the disposable archive, before the targeted settlement assertions. |
| Isolation control for those 4 workflow failures | The candidate and base archives both fail with `Cannot read properties of undefined (reading 'platform')`; the same base tests pass in the primary checkout. This identifies a validation-environment limitation, not a demonstrated candidate regression. The exact archive/dependency-resolution cause was not established. |
| Default versus separate history capacity probe | Both public default readers fail under the fixture budget; separate access and exact reconstruction pass. |

The latest PR checks remain red: `quality`, three Workbench UI shards and all four browser-e2e shards. Browser-e2e logs report 94 Convex type errors in 20 files before browser execution. The local typecheck passes, so the CI startup discrepancy remains unresolved. UI failures were read from CI and not reproduced in a browser or established as regressions against the base. Do not interpret the local focused probes as an all-green candidate.

The supplied migration of 68 idle conversations, 257 deliveries and 96 completed missions was not rerun. The 31 excluded unfinished browser-test conversations were explicitly left outside acceptance and are not a finding. Cloud cutover, component retirement, deployed large-volume behavior and full retained-context performance remain unaccepted. No live provider calls, migration, service lifecycle changes, PR comments, commits or pushes occurred during this review.
