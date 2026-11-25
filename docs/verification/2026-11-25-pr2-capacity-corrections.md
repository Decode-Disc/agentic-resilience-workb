# Retained response capacity corrections

Date: 2026-11-25. Scope: corrections following the independent reviews of [PR 2](https://github.com/Decode-Disc/agentic-resilience-workb/pull/2), starting from `f4af3901a9946b849d052b0317f188ce998ef970`. This report distinguishes deterministic capacity checks, local backend journeys and still-open deployment acceptance.

## Corrections

Both authenticated history APIs now return retained-body references regardless of the historical `bodyAccess` argument. Listing deliveries no longer hydrates their retained text. The separate authenticated body reader preserves exact text, pagination, access checks and hash validation. Unmigrated Convex Agent messages remain readable until the separately gated retirement.

Pi prepares canonical operation arguments and bounded completion refusals in its existing action. Original argument bytes remain in the immutable invocation receipt; refused requests reference that receipt rather than copying the body into a database document. Finalization matches the response digest and retains current authority, instruction, database-backed validation and domain effects in the mutation. Working-note exhaustion and blank textual completion refusals preserve completion correlation. The visible-text requirement is shared by action preparation and the two textual domain completion owners; blank original text stays immutable instead of crossing finalization. Operation arguments whose input alone exceeds the existing database document capacity receive an explicit refusal; this does not impose a generated-response limit.

Generated API startup exposed a type-inference cycle hidden by the previously checked-in declarations. Type dependencies now derive from the defining modules, and the local watcher regenerated the API and successfully published the backend. Workflow regressions now reconstruct published text through the authenticated body reader instead of asserting obsolete inline storage. The native admission race test injects its edit at the current reference-based admission boundary.

Browser checks also reproduced two remount defects. The research conversation now restores its position before enabling native growth-following, preventing the native initializer from overriding the saved position. A controlled research-context panel no longer has its open state overwritten by the uncontrolled layout default. Existing layouts, draft persistence, close controls and native scroll behavior remain covered.

## Reproductions and focused checks

- Before correction, default history exceeded a 131,072-byte query budget while explicit separate access reconstructed the same text. After correction, both default APIs pass that budget with two published bodies of 16,777,217 UTF-8 bytes each; list output is below 16 KiB. Publication, exact reconstruction, pagination, replay, wrong-hash refusal and access checks run through the real registered Convex functions.
- Before correction, a malformed operation produced a 1,100,750-byte refused-request document. After correction, immutable originals are retained separately and the refused record fits the existing document capacity.
- Six platform-sized argument cases passed with `LARGE_RESPONSE_PROBE_BYTES=16777217`: malformed operation, malformed JSON completion, schema-invalid completion, whitespace-heavy valid operation, schema-valid operation exceeding document capacity, and oversized completion notes. These check correlation, original bytes, normalized outcomes and accounting; they do not call a provider. Two additional blank-text cases passed at the same size on historical text and native tool transports, preserving the original domain refusal and native correlation.
- The final history capacity probe passed in 20.80 seconds of test execution and 25.32 seconds wall time, with process maximum RSS 742,920 KiB. This includes the test runner, fixture database and both retained responses; it is not an isolated Convex action-memory measurement. The probe uses the installed Convex transaction limits, with the two history list calls additionally constrained to 128 KiB. The ordinary regression keeps its smaller fixture and tighter transaction budget.
- The capacity and research-screen integration run passed 34 tests across three files. After adding the blank-text sibling cases, the two capacity suites passed all 24 tests. The earlier native transport/recovery selection passed 84 tests. Full Vitest discovery exercised 347 files; after updating the obsolete storage consumers, rechecking all 25 initially failing files passed 438 cases with one local-runtime process test timing out under concurrent load. That exact test passed alone in 5.55 seconds without assertion or timeout changes. A subsequent `pnpm check` run passed 345 files and 3,465 cases but failed the two blank-text cases while their correction was in progress and the 20-second web restart test. The final capacity run passed both blank-text cases, and the final frontend/backend typecheck and production build passed separately. The web restart timeout remains an unresolved local check; its precise cause is not established, and an isolated pass is not treated as a green aggregate. CI on the stabilized commit remains the final full-run check.
- Protocol tests passed all 237 cases. Backend/frontend typechecking, generated skill checks, documentation checks, design synchronization, lint and formatting passed. Existing lint/CSS warnings, five oversized historical JSON formatting warnings and the build's existing large-chunk warning remain visible.

The platform history probe initially exceeded the ordinary test's 15-second deadline and also exposed that a 128 KiB budget for *every* transaction is too small for its large manifest traversal. The final probe uses a 120-second test deadline and the actual platform transaction limits, retaining 128 KiB specifically for the history list queries under review. No production resource limit or ordinary test timeout was enlarged.

## Local runtime and browser evidence

The existing local Convex watcher successfully published the changed backend at 12:39:22 local time, then published the final blank-text refusal correction at 13:11:28. The native journal browser scenario passed at desktop and mobile widths, including reload/reconnection. The saved-material simulation passed on that backend: four Pi invocations, the expected three documentary operations, exact returned quotation in context, one completion and zero provider calls, with its persisted snapshot unchanged after reload.

Earlier attempts encountered cold development-server navigation timeouts and a waiting simulation under concurrent validation load. The isolated replay completed within the unchanged test budget in approximately 1.4 minutes. Cancellation/fenced writes observed after test teardown are not presented as the cause of the earlier wait. No paid qualification ran.

All 36 focused browser cases passed after correction, including desktop/mobile reading continuity, controlled panel state, copying, growing replies, draft retention and keyboard interactions. The final CI result remains revision-specific. The complete pre-correction gallery run had 168 passing and nine failing cases; obsolete expectations were repaired and the remaining remount failures were reproduced before the two scoped UI corrections. No failing assertion was removed to obtain a passing result.

## Reproduction commands

```sh
pnpm exec vitest run src/__tests__/convex/execution/large-response.test.ts src/__tests__/convex/execution/conversation-capacity.test.ts src/__tests__/components/workspace/start-screens.test.tsx --maxWorkers=1
LARGE_RESPONSE_PROBE_BYTES=16777217 pnpm exec vitest run src/__tests__/convex/execution/large-response.test.ts -t 'recovers the exact retained' --testTimeout=120000 --maxWorkers=1
pnpm workbench-ui:check launched-layout.spec.ts chat-surfaces.spec.ts conversation-continuity.spec.ts conversation.spec.ts
pnpm test:e2e e2e/agent-harness.spec.ts --workers=1
pnpm test:protocol
```

## Open acceptance boundaries

This correction does not certify cloud cutover, deletion of Convex Agent, a new migration of existing conversations, or paid model quality. The earlier reported migration of 68 idle conversations, 257 deliveries and 96 outcomes was not repeated; the 31 excluded unfinished browser-test scopes remain untouched.

Peak action memory in the actual Node and default Convex runtimes, largest-conversation reconciliation, aggregate manifest traffic, and every large-record purge/retirement combination remain operational acceptance checks. The Node test-runner RSS above cannot substitute for them. The complete retained Sources preparation graph is absent from the supplied archive; it contains outcomes and context excerpts, not all capture, qualification, contribution and predecessor records needed for the requested full benchmark. The existing 27-payload traversal comparison remains unchanged evidence: 65 document reads on both revisions and no measured improvement for that workload. No missing graph or authority was fabricated to close this gap.
