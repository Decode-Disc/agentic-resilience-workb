# Independent Oracle Review

Profile: native Codex Oracle, GPT-6 Astra, xhigh. Scope: current Sources implementation including the generated-response storage extension present at review launch. The report below preserves the reviewer's conclusions; the parent records subsequent checkout identity separately.

## Verdict

BLOCK for acceptance of the uncommitted large-response extension. The Sources ownership, history, completion and recovery architecture is coherent, but allowing large replies exposes an existing whole-page hydration assumption that can make saved conversations unreadable. This is a source-derived finding; no tests or runtime calls were executed.

## Medium / P2 — Blocking: Conversation pagination does not account for fragmented message size

`convex/integrations/agentStorage.ts:47` flattens all fragment references into one `getMessagesByIds` query. Both `convex/workbench.ts:831` and `convex/execution/conversations.ts:696` hydrate complete bodies for pages containing up to 20 deliveries.

The installed Convex Agent stores plain text twice, in `message.content` and extracted `text` (`node_modules/@convex-dev/agent/src/component/messages.ts:348`), and its reader loads full documents (`messages.ts:874`). Eight replies of the newly supported 1,100,001-byte size require at least 17,600,016 bytes of component reads, exceeding the installed 16 MiB transaction budget before metadata. Eight replies and their user messages fit inside the existing 20-delivery page. Publication can therefore succeed while subsequently reopening that conversation fails repeatedly.

The new regression tests one large reply at a time (`src/__tests__/convex/execution/large-response.test.ts:51`); it does not cover this aggregate read.

Recommended correction: make conversation page selection account for logical body sizes before hydrating fragments, preserving existing delivery identity and cursors. Keep complete text retrievable without reinstating a generation-size ceiling. Add a consuming-boundary regression with several individually valid large replies, exercising both public conversation readers under transaction limits, then run affected message/history tests and fragmented native recovery. Reviewer's effort estimate: short, 1–4 hours; not verified by implementation.

## Original Architecture Watches

- Native terminal settlement: covered structurally. Session-prefixed lookup, retained completion correlation, `afterTools` terminal bypass, writer fencing and bounded terminal retries exist in shared owners. Four crash-boundary cases are present in `pi-recovery.test.ts:475`; fragmented responses are rehydrated before correlation. Tests inspected, not rerun.
- Preparation projection/read cost: covered structurally with historical measurements. Sources and Workbench pass transaction-local `SourceReviewReads` into consuming projections (`sourcesAgent.ts:377`, `workbenchContext.ts:48`). Capture, qualification, effective-use and reading-window facts stay separate from handoff membership. Archived measurements include reads outside the cache but are not current deployed measurements.
- Profile preservation/stored refresh: covered in code and test design. Merging preserves active and retained keys under the same SDK tuple, rejects conflicting measurements and fingerprints changed contracts separately. Stored refresh tests cover unchanged additive and changed catalogue revisions (`model-configuration.test.ts:956`). Actual deployment refresh remains unverified.

## Other Conclusions and Limits

Convex remains sole domain-completion authority. `submit_completion` acknowledges retained disposition; mixed rounds retain refusals while sibling operations follow normal execution. Installed Pi termination semantics match. No additional architectural blocker found in those paths.

Response/result fragmentation is encapsulated behind shared readers with ownership/hash checks and conflict detection. Added purge paths remove response/result references and invocation payload fragments. Purge is not complete physical erasure: existing session-fragment and Convex Agent component retention remains, explicitly acknowledged at `dossierPurge.ts:595`. This predates the extension and was not classified as a new regression or an expanded cleanup requirement.

Approved legacy retirement was respected. Removed obsolete paths were not judged against superseded execution compatibility promises.

Read-only inspection covered current diffs, relevant domain/execution/storage consumers, installed Pi/Chord/Convex Agent sources, regression implementations and design/verification artifacts. No other reviewer report was opened. No tests, formatting, generation, dependency operations, backend publication or provider calls ran. Start/end observations matched branch `sources-workflow-no-legacy`, HEAD `09b1fff502d1aac05bec3f33feda66325a38519a`, 29 modified tracked files and two specified untracked files; no source changes observed by the reviewer. Live recovery, deployment compatibility and model usefulness remain unverified.
