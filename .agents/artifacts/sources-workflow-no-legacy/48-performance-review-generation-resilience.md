---
type: review
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "168981b3c48a7d20062e39e2a2df71689c1036d4"
flow: tdd
status: comment
reviewer: performance-reviewer
model: gpt-6.1-sol
reasoning_effort: xhigh
reviewed_tdd_sha256: "dbb90b8720ca2e0f9b4760046da41e667d1b3583c28e5a8e163f1b436896409a"
reviewed_outline_sha256: "643db3d37d5273167701ae4ceb5f44b12e29cd0fa5824ec7b98f6090b33297c7"
---

# Independent Performance Review: Generation Resilience

**Verdict: COMMENT.** The independent performance-reviewer found no blocking performance/resource defect in the pause-corrected design and outline. Two MEDIUM/WATCH verification refinements should accompany implementation. The previous code-reviewer's HIGH pause finding is adequately corrected at design level. This is readiness to enter isolated implementation within this lane's scope, not complete correctness approval, implementation authorization or measured runtime performance.

The user requested correction followed by one independent performance-reviewer. A fresh, bounded native Codex review used the fixed `gpt-6.1-sol` / `xhigh` specialist profile. The reviewer read the full corrected documents, original finding and relevant current source. It did not participate in drafting or modify files. The full substantive findings, positive coverage, measurement recommendations and limits are preserved below.

## Prior HIGH Pause Finding: Adequately Corrected in Design

The reviewed TDD lines 215–221 and outline lines 269–288 specify the missing transition: the operation owner durably fences its worker, research control recognizes only the declared safe `waiting_provider` state, and the run actually becomes paused with its slot released. Tests distinguish that path from legitimate `cancel_pause`, exercise another engaged operation, and require contended then successful public Resume without seeded paused state.

Current source confirms the original problem: `pauseResearchAtBoundary` treats waiting research requests as engaged in [researchControl.ts](../../../convex/execution/researchControl.ts), line 141; `recordResult(waiting)` returns early in [operations.ts](../../../convex/execution/operations.ts), line 1047; public Resume then takes `cancel_pause` at researchControl.ts line 719. The correction addresses those mechanisms and preserves live-worker protection. Its runtime behavior has not been reproduced or implemented.

## MEDIUM / WATCH: Make Abort Versus Capture Ordering Discriminating

**Reviewed locations:** TDD line 169, outline line 188 and its Phase 4 validation at lines 196–208. Line numbers identify the frozen reviewed inputs, not the later refinement.

The current raw middleware awaits visible-output writing before forwarding a delta in [modelTransport.ts](../../../convex/integrations/modelTransport.ts), line 491. The writer applies backpressure at line 241 and uses the generation signal for append cancellation at line 899. A detector at this seam needs explicit ordering: awaiting capture before detection can delay cancellation behind a journal RPC; aborting first through the current signal can interrupt capture of the boundary-crossing delta.

The 61,440-character packing threshold does not bound raw provider delta size. For a delta of length B, the detector can encounter character 4,096 while the rest of that already-received delta still requires retention. Counter state is O(1), observation time is O(B), and 4,096 is not a memory or retained-byte ceiling.

**Smallest correction:** Clarify Phase 4 ordering and extend its existing regression. Deliver a boundary-crossing delta larger than the packing threshold while delaying a real capture RPC acknowledgement. Verify generation cancellation before acknowledgement release, exact retention of received text and drain/seal under existing settlement grace. Retain the explicit incomplete-capture outcome if that grace expires.

**Why nonblocking:** The design already requires exact received-text retention, boundary-crossing inspection and bounded finalization. The missing item is a test distinguishing the implementation order. No new duration or byte cap is justified. This is a source-backed design risk, not a reproduced defect in unimplemented detector code.

## MEDIUM / WATCH: Preserve Native Waiting Without Log Hydration

**Reviewed locations:** Outline line 218, Phase 5 validation at line 239 and Phase 6's new waiting phase.

Current `unchangedScheduledWait` skips Pi writer admission and log hydration only while the owned scheduled job is pending or in progress in [piControl.ts](../../../convex/execution/piControl.ts), lines 342–389. A recovery wait deliberately outlives that generation job. Merely replacing the scheduling fields can therefore lose this optimization for `waiting_provider`.

Each unintended hydration replays O(H) retained log bytes: `PiConvexStorage.open` scans/reconstructs the log in [piStorage.ts](../../../convex/integrations/piStorage.ts), lines 195–226. Across W unchanged wakes the cost becomes O(W × H). A 1 MiB log reopened at 30 otherwise-idle wakes would transfer about 30 MiB; this is scenario arithmetic, not a measured production figure.

**Smallest correction:** Explicitly preserve the existing fast path for unchanged owned recovery waits and extend [pi-deferred-wake.test.ts](../../../src/__tests__/convex/execution/pi-deferred-wake.test.ts), line 299. Exercise `waiting_provider` after the original generation job ends. Verify no writer/log reopening on unchanged fallback delivery while a final result or relevant observation still resumes promptly. Pair the case with retained-log replay-byte measurements on the matching local runtime.

**Why nonblocking:** The outline already updates `piControl`, preserves native behavior and prohibits paused metadata recovery from repeatedly scheduling research workers. The proposed test makes preservation concrete. A second cache or polling mechanism would add unnecessary complexity. This is a source-backed preservation risk, not a measured regression in the future implementation.

## Positive Performance and Resource Coverage

- The lexical observer is proportionate: O(n) time, O(1) state, before packing, with native SDK parsing retained. Exact threshold, escaped strings, fragment splits, initial reasoning and shared callers are covered.
- Compact operation receipts remove repeated full diagnostics from tool results. Complete controls remain authoritative journal data with existing paged inspection; compact receipts do not eliminate all storage/native-context cost.
- Existing indexed receipt and run/status queries, plus transaction-local `SourceReviewReads`, provide appropriate foundations. Shared projection avoids distributing new permission calculations. No persistent cache change is warranted without measurements.
- Normal receipt accounting remains a constant number of projection updates. Reconciliation raises their frequency, but one owned claim/wake, attempt fencing, existing `retryAt` and the unchanged logical deadline remain effective.
- Automatic recovery stays within attempts one and two. Separate receipts, both financial reservations, exact input reuse and retained-result-first recovery prevent duplicated work becoming spending authority.
- Rebase is O(R) over authoritative receipts in each complete projection scope. Atomic scope, admission fence, writer drain and explicit oversized-scope blocker are appropriate. Unknown target sizes are an empirical cutover preflight, not a design defect.
- Native checkpoint feasibility and post-retirement resume are explicit target cutover gates. The plan does not assume catalogue defaults migrate retained sessions.

The owner split passes the code-smell trade-off: operations owns epochs/wakes, invocation lifecycle closes attempts, receipt owners maintain accounting, and Sources interprets documentary use. Phase-valid records and concrete recovery opt-in express real lifecycle differences. No generic retry engine, migration framework, replacement parser or second history authority is needed.

## Measurements Still Required During Implementation

Record actual serialized v2 input/schema size, compact receipt bytes, full control/journal bytes, native-context use and projection read volume on representative retained material. Exercise high-cardinality associations supported by the actual envelope; a fixture with 12 needs and 20 controls does not establish target maxima.

Inspect jobs, lookups and transaction conflicts per receipt through worker loss, duplicate delivery and pause/resume. Shared run/context accounting rows are plausible contention points, but actual contention is unknown and does not justify sharding or denormalization now.

Target inventory must establish receipt counts/bytes per atomic run/context scope, writer quiescence and safe native checkpoints before conversion. No target database inventory was performed in this review. Runtime latency, memory, contention and conversion capacity remain unmeasured.

## Evidence and Verification Boundaries

The reviewer read complete revised TDD/outline, verification record, original code review and context files; compared the correction to preserved inputs; inspected current transport, capture, scheduler, pause/slot, receipt/accounting, Sources projection, native storage and representative tests/fixtures; and applied code-smell and harness-development guidance.

Commands were limited to repository identity/status, source reads/searches and read-only Python hashing/comparison. No files, tests, probes, benchmarks, network/provider calls, services, publication, migration, notifications or nested agents were run or modified by the reviewer. Historical verification results were read, not rerun. The performance lane does not replace complete correctness review or demonstrate runtime acceptance.

## Parent Disposition and Subsequent Refinement

The parent accepts both WATCH items after independently reading the current middleware/writer, `unchangedScheduledWait`, `PiConvexStorage.open` and real deferred-wake tests. Both are localized clarification/test refinements within the existing owners. They were added after this review to the TDD and outline: Phase 4 now specifies abort/retention ordering and delayed-acknowledgement/grace-exhaustion cases; Phase 5 preserves and tests unchanged `waiting_provider` delivery without log hydration; Phase 7 records the proposed resource measurements. No production code changed and those tests/measurements were not executed.

These subsequent clarifications have not received another independent review. The verdict above remains attached to the frozen pause-corrected inputs. Original code-reviewer and Oracle/Architect reports remain historical evidence for their own candidates. The original HIGH has a specified correction that this reviewer considers adequate, not an implemented runtime fix.

## Reviewed Identity

| Input | SHA-256 |
| --- | --- |
| HEAD on `t3/check-dev-tools-availability` | `168981b3c48a7d20062e39e2a2df71689c1036d4` |
| TDD | `dbb90b8720ca2e0f9b4760046da41e667d1b3583c28e5a8e163f1b436896409a` |
| Outline | `643db3d37d5273167701ae4ceb5f44b12e29cd0fa5824ec7b98f6090b33297c7` |
| Verification record | `66af0d6edb3863a11999b13505dfd2aec71bcb12ffe0bc81819bcbe40bd2d3c9` |
| Original code review | `c7b03f7aa413388aaa4681da16d3030f145089e0c0663e28c4b5e03a9e5b8b0f` |
| Performance review context at inspection | `9ecc3dc7c145015b995c3b64801d37f71f1dfec3fa3905f34a2e5fb6165aa228` |
| Correction context | `52c310a0502cf4cb6d2a903c681d3cc16207f4478533dc630ff80e03e7a8ed8e` |
| AGENTS.md | `ff2870c2e84dd5db94635d2c7c1cefc11290c7dd6260655fdc1fd8dd79654fbb` |
| PRODUCT.md | `55abce3cefe5586b410cc339bd2079c1966cdca92ee6389488f1c43cc207c251` |
| context/TECH.md | `62eaa262ecfc134142d85f2c56393a7d55df6650c5eb51353deeb8572ce0bfe1` |

Both revised frozen snapshots match their originals at review time. Pre-correction inputs retain TDD hash `7c690f8ccc33452f10912d690654020709557f3722e104a0651ad51adff3b169` and outline hash `a1d8766b25116316b336850b44d4295a40ff8e1f5940d489c01a617881a73720`. The [review context](generation-resilience-performance-review/context.json) retains snapshot paths, final document identities and verification/notification metadata; its inspected bytes are preserved separately as `context-reviewed.json`.
