---
type: structure-outline
repos:
  - identifier: agentic-resilience-workbench-proto
    sha: "2816370980accf0155c09d62054ca83511ca43d3"
flow: tdd
status: ready-for-review
---

# Implementation Outline: Documentary Engine Unification

Implement the [approved technical design](18-tdd-documentary-engine-unification.md) in a separate worktree, using the existing capture and retrieval owners. Deliver six testable implementation phases after worktree preparation. Keep current default bindings until the shared path, compatibility and recovery checks pass; intermediate phases are not a claim that the complete feature is ready.

The [research](17-research-documentary-engine-unification.md), [initial review](19-review-documentary-engine-unification.md) and [Oracle recheck](20-recheck-documentary-engine-unification.md) explain the existing paths and required corrections. The final bounded corrections were user-approved without a third Oracle review. This outline adds sequencing and checks, not new architecture or implementation authority.

## Desired End State

Workbench acquires metadata-only captures before Start, then explicitly searches or reads through the same engine as Sources and retained consumers. A contextual match can continue to document end through returned references, including after an agent save. Framing citations enforce the configured server policy, default false and fixed for the active turn. Start makes existing captures consultable by Sources without acquisition, qualification or retained membership; post-Start Workbench retains read-only consultation. Historical import, uncertainty, immutable evidence and cleanup remain truthful.

## Implementation Overview

- [ ] Phase 0: Prepare the worktree, evidence and baseline.
- [ ] Phase 1: Acquire a new framing document into shared capture storage.
- [ ] Phase 2: Search and continue reading that capture across an agent save.
- [ ] Phase 3: Save framing citations under the effective server policy.
- [ ] Phase 4: Reuse captures through Sources and post-Start Workbench.
- [ ] Phase 5: Recover historical imports and purge owned documentary storage.
- [ ] Phase 6: Activate the complete bindings and verify the integrated contract.

```text
Worktree and baseline
  → acquire a capture
    → search / read / save / continue
      → enforce citation policy
        → Start / Sources / Workbench consultation
          → historical recovery / cleanup
            → binding activation / integrated verification
```

Each phase starts with RED through its real consuming boundary, implements the smallest correction, then refactors while keeping focused tests green. Record the actual RED command and intended failure, GREEN result, changed owners and remaining limitations in one implementation record in this task directory. Do not count unknown bindings, missing profiles or broken fixtures as the behavioral RED. Never copy production parsing into tests or replace internal collaborators with call-count mocks.

## Phase 0: Prepare the Worktree, Evidence and Baseline

**Result:** The implementer has the approved inputs and captured bytes in the intended checkout, with an explicit baseline and no connection to the primary checkout's runtime.

### Change Outline

Use `2816370980accf0155c09d62054ca83511ca43d3` as the reviewed code baseline. The user will implement in a worktree; creating one is not part of this planning task. If the chosen worktree starts elsewhere, inspect the actual diff from this baseline and reconcile affected owners before changing code. Do not merge or reset unrelated work to manufacture the baseline.

RPI documents, captured inputs and the probe report/archive record are local or gitignored and do not follow Git automatically. A companion verified handoff archive is prepared with the repository's `evaluation:archive` owner. Its receipt records every selected path and hash. It contains the request/questions/research/TDD, review records and input snapshots, approval evidence, this outline, the probe report/provenance, captured annual text/raw HTML and selected probe source/wire outputs. It excludes environment files, local runtime/configuration directories, access credentials, administrative identity files and unrelated campaign artifacts.

Verify and extract that archive into an empty staging directory using its `archive.sha256` and `files.sha256`, as documented by `scripts/archive-evaluation.ts`. Copy the selected `repository/.agents/artifacts/sources-workflow-no-legacy/` documents into the worktree at the same relative path, together with the selected probe report and historical plan files. Use `record.json` mappings for external inputs: the probe expects `captures/nvidia-annual.txt`, `captures/nvidia-annual.raw` and `selected-source-records.json` under `scripts/evaluations/source-selection/fixtures/cross-company-20261020/`.

The archive owner deliberately excludes archive/record-storage paths. Its new receipt verifies the transferred inputs; the older probe's record at `scripts/evaluations/archives/20261120T122604301Z-long-document-local-probe/` remains historical evidence in the source checkout. Copy that record directory separately if preserving the old report's relative archive link in the new worktree. Do not bypass the archive owner's path guard or recursively include archive storage.

Do not extract archived backend snapshots over the worktree or copy the primary checkout's `.env*`, `.convex` or runtime manifest. Source links in historical research may point to the primary checkout; resolve every execution/edit path against the active worktree. Keep captured inputs outside the default test dependency graph. If dependencies are missing, apply `dependency-installation` and the pinned project package manager rather than editing the manifest or copying `node_modules`.

The existing launcher owns isolated worktree configuration, fixed ports and instance identity (`scripts/local-runtime.ts`, `scripts/local-dev.ts`, `context/TECH.md#local-development`). When local runtime verification becomes necessary, start/reuse one watcher through that owner in the implementation worktree, verify its identity and preserve the primary watcher. Never point the worktree at the primary backend or start a second `convex dev --once`.

### Validation

#### Automated Verification

```sh
git branch --show-current
git rev-parse HEAD
git status --short
git diff --stat 2816370980accf0155c09d62054ca83511ca43d3
pnpm dev:status --json
pnpm exec vitest run src/__tests__/convex/execution/workbench-documentary-continuity.test.ts src/__tests__/convex/execution/saved-material-progress.test.ts --maxWorkers=1
```

Verify the approved TDD hash from `documentary-tdd-approval.json` and captured normalized-text hash `194970e58b71a169c90fac9b522152c5c3fadee4ffca8c7cadca73b6884b12fd`. The previous 53 passing research tests are baseline evidence, not results from this worktree. No dependency installation or service startup is implied by the commands having been listed.

#### Manual Verification

Confirm that the checkout/path is the intended worktree, transferred approval/review records are readable, and any local runtime belongs to this worktree. Record existing baseline failures separately; do not weaken assertions to proceed. No product or architectural question remains open at this checkpoint.

## Phase 1: Acquire a New Framing Document into Shared Capture Storage

**Result:** A real registered Workbench operation acquires an observed candidate or supplied URL into a committed shared capture and returns metadata without body text. The initial case has no matching source row.

### Change Outline

- Extend `sourceCaptureActions.ts` and `sourceCaptures.ts`; mechanically move reusable public acquisition branches before changing their behavior. Keep discovery in its existing owner and use the existing normalization sequence without qualification selection.
- Add the concrete `domain/documentaryAccess.ts` authority boundary and shared `acquire_document` descriptor. Its query-safe acquisition pin binds target URL/cause/input identity without requiring a source ID. The authorized reservation transaction creates/reuses the source and retains its binding without changing the admitted pin.
- Introduce canonical capture metadata, explicit unknown completeness and optional preparation provenance in the existing schema. Preserve original grant mapping through `providerCalls.ts`, retries, scheduled execution, cancellation and settlement.
- Add the finite input/result selector and required existing projection support alongside the first new result contract. Include both runtime `modelOperation` and prepared `nativeToolSets`; keep old fingerprints and exact legacy results. New bindings can be explicitly pinned in tests; current defaults stay unchanged until Phase 6. Inspection does not receive acquisition.

### Validation

#### Automated Verification

```sh
pnpm exec vitest run src/__tests__/convex/integrations/workbench-public-context.test.ts src/__tests__/convex/sources/source-captures.test.ts src/__tests__/convex/integrations/provider-calls.test.ts --maxWorkers=1
pnpm convex:check
```

RED/GREEN must cover candidate and analyst URL without a pre-existing source, stable re-pinning after insertion, concurrent reservation identity, exact capture hash/metadata and metadata-only tool output. Invalid/foreign targets refuse before DNS/reservation. Drive the registered scheduled operation for cancellation, unknown dispatch and acknowledgement loss; known costs survive without stale adoption or a duplicate call. Verify legacy acquisition preservation and no provider receipt for cached reuse.

#### Manual Verification

Inspect the retained request/pin, source/capture binding and actual serialized acquisition result. Confirm that source creation did not alter grant authority or inject an opening page. If a worktree watcher is running, verify its successful push after the backend edit; a typecheck alone is not publication evidence.

## Phase 2: Search and Continue Reading Across an Agent Save

**Result:** The acquired pre-Start capture supports targeted search, contextual reading and a genuine next page after a successful provisional save, without reacquisition or a fabricated Sources preparation.

### Change Outline

Extend `domain/savedMaterial.ts`, `savedMaterialOperations.ts`, `savedMaterialAgentOperations.ts`, `sourceRetrieval.ts`, `sourceRetrievalActions.ts` and `sourceRetrievalPolicy.ts`. Use the approved short schemas:

```ts
search_available_material({ reference, query, continuation? })
read_in_context({ reference })
```

References resolve issuer/cause, capture/hash and extent at one owner. A match opens from its contextual start through capture end; each next page is explicitly requested. Beginning reads do not depend on keyword matches or successful indexing. Promote existing neighbor/page bounds into the resource-policy owner with unchanged values/units.

Centralize the capture namespace and update index publishers, metadata/state queries, vector filters, `SourceReviewReads`, reader backend and fixture/evaluation consumers together. Preserve approved-corpus prerequisites for retained callers, legacy ranges and optional hybrid behavior. Remove all 60/61-source cutoffs on the new material inventory path, including the internal query, while preserving actual native/platform capacity checks and multiple captures per source.

### Validation

#### Automated Verification

```sh
pnpm exec vitest run src/__tests__/convex/execution/workbench-documentary-continuity.test.ts src/__tests__/convex/execution/saved-material-progress.test.ts src/__tests__/convex/sources/source-retrieval.test.ts src/__tests__/convex/sources/approved-source-search.test.ts --maxWorkers=1
```

The primary integration uses an analyst/open basis for its provisional save if public reference writes are not yet delivered by Phase 3. Assert actual capture/ranges, first and next visible text, unchanged immutable identity, same valid cause after save and no acquisition. Also cover multi-message references, steering/foreign/fabricated refs, cold/warm index, parser/index failure, Unicode/final-page boundaries, multiple captures and inventory beyond the former count. No guessed locator or omitted match can become observed evidence.

#### Manual Verification

Read the recorded acquisition/search/read/save/continue sequence and check that later pages are new displayed extents. Confirm the same engine serves retained consumers; an empty search is not documentary absence and no application summary/history store was added.

## Phase 3: Save Framing Citations Under the Effective Server Policy

**Result:** The complete pre-Start acquisition → search → context → save → continue → new citation path works, and the contextual-reading requirement is enforced at the write in both modes.

### Change Outline

Add protected `framingCitationPolicy.ts` configuration with the canonical validator/default in framing contracts and its settings row. Snapshot the effective revision/default-false policy when `execution/conversations.ts` creates a turn. Resume, save and steering within that turn do not reload global settings; analyst projections omit the raw field.

Extend `framingProvenance.ts`, framing public/conditional basis validators, `framing.ts` and `workbenchContext.ts` to resolve adopted displayed references query-safely. The same eligibility owner handles the context-required mode and rejects metadata, acquisition/beginning refs and unconsumed continuation refs. Retained associations and historical pins retain their contract. No model instruction, self-reported flag or regex enforces this policy.

### Validation

#### Automated Verification

```sh
pnpm exec vitest run src/__tests__/convex/execution/workbench-documentary-continuity.test.ts src/__tests__/convex/execution/workbench-framing-receipts.test.ts src/__tests__/convex/execution/framing-citation-policy.test.ts src/__tests__/convex/execution/workbench-native-interface.test.ts --maxWorkers=1
```

`framing-citation-policy.test.ts` is a new integration file at that path. Test administrator-only setting/CAS conflicts, default false, next-turn changes, stable active snapshot and omission from analyst projections. Exercise real writes for event and conditional bases: context readings work in both modes, search-only references fail when required and work when disabled, invalid writes preserve revision/provenance, unchanged inherited associations survive later policy changes, and missing new-version snapshots refuse. Capture the actual Pi request after acquisition, reading, save and continuation; schema-only assertions do not replace write enforcement.

#### Manual Verification

Inspect the canonical saved program, references and retained policy beside the actual serialized requests. Confirm that policy display describes the contract and skills teach judgment without carrying the enforcement rule.

## Phase 4: Reuse Captures Through Sources and Post-Start Workbench

**Result:** Start exposes both cited and uncited pre-Start captures through Sources' existing availability ledger. Sources can later read, qualify and materialize an uncited capture without another acquisition; Workbench can consult during pause/settlement without progressing research.

### Change Outline

Update the real Start/preparation initialization in `framing.ts` and its existing Sources owner. Generalize `sourcesMission.reserve`/`retainCapture` and shared ledger updates for common acquisition/import, preserving acquisition work/accounting rather than adding a new counter. Visibility is neither qualification nor retained membership.

Wire Sources and inspection bindings to the shared reader, with their distinct authority. Add the closed `workbench_read` mapping for active post-Start conversations; reject manual acquisition under it. Update `sourceUsage.ts`, `SourceReviewReads`, `sourcesWorkspace.ts` and retained preparation/materialization consumers to the common identity/namespace. Sources keeps indexed analytical evidence; a raw range without a verified indexed quotation is not qualifiable.

Render unknown completeness honestly through `sourceCaptureState.ts` and the existing source presentation mapping; apply `workbench-frontend` to that actual UI change without redesigning the screen.

### Validation

#### Automated Verification

```sh
pnpm exec vitest run src/__tests__/convex/sources/sources-mission.test.ts src/__tests__/convex/sources/sources-workspace.test.ts src/__tests__/convex/evidence/inspected-source-materialization.test.ts src/__tests__/convex/sources/source-qualification-action.test.ts src/__tests__/convex/execution/workbench-documentary-continuity.test.ts src/__tests__/lib/presentation/sources.test.ts --maxWorkers=1
```

Capture two documents before real Start and cite only one. Assert both availability registrations, zero automatic qualification/membership/acquisition work, then successful explicit qualification/materialization of the uncited one with zero new acquisition receipt. Test post-Start conversation reads during pause/settlement with unchanged research/work/qualification state, denied acquisition and stale-turn refusal. Preserve retained inspection approval and rejection/restriction handling. Test unknown-completeness copy and absence of raw backend fields through the relevant presentation boundary.

#### Manual Verification

For any changed visible source state, compare the existing screen before/after at desktop/mobile using the worktree's isolated local runtime. Check only the affected completeness/read state; default CI/browser suites and paid-provider qualifications remain separate.

## Phase 5: Recover Historical Imports and Purge Owned Storage

**Result:** First reuse of historical retained public text converges on one canonical capture, can recover interrupted local storage work safely, and dossier purge removes owned text/indexes without deleting shared blobs.

### Change Outline

Implement retained-root pinning and lazy import in `sourceCaptureActions.ts` / `sourceCaptures.ts`; query-only pinning never uploads. Keep the original bytes, hash, ranges, known dates and unknown original provenance. Use one root/hash key with exclusive attempt ownership/revision checks. Define the approved transitions for committed reuse, attached-byte finalization, abandoned/reconciled recovery and live-owner refusal.

Update `evidenceArtifacts.ts` reconciliation to recheck current owner/attachment before deletion. Extend `dossierPurge.ts` through `deleteRetainedTextBatch` so operation text is cleaned before dropping its owner. Preserve storage reference checks, old operation results/read IDs and historical callable contracts. Translate the remaining legacy public reader through the common range implementation; do not leave a second parser/search/continuation engine. Local recovery grants no external retry or network fallback.

### Validation

#### Automated Verification

Add `src/__tests__/convex/sources/documentary-import.test.ts` as integration coverage of real capture mutations and operation adoption, mocking only storage failure boundaries as needed. Run it with:

```sh
pnpm exec vitest run src/__tests__/convex/sources/documentary-import.test.ts src/__tests__/convex/sources/source-captures.test.ts src/__tests__/convex/access/dossier-purge.test.ts src/__tests__/convex/execution/workbench-native-interface.test.ts --maxWorkers=1
```

Cover concurrent imports and interruptions before upload, after upload/attachment and after commit acknowledgement loss. Assert one committed identity, old-worker refusal, active-attachment protection, abandoned-blob reclamation and immutable historical observations. Unknown completeness/conflicting dates must remain unknown/conflicting through reading and provenance. Purge batching/replay must remove exclusively owned fragments/indexes and retain shared source-version/capture/lease blobs until their final reference disappears.

#### Manual Verification

Inspect import attempt and cleanup records rather than inferring crash safety from a successful happy path. The deterministic tests do not establish live crash/OCC behavior. Record that remaining runtime uncertainty instead of claiming an unrun deployed migration or orphan cleanup.

## Phase 6: Activate the Complete Bindings and Verify the Integrated Contract

**Result:** New conversations use the completed tools and existing conversations replay their exact supported contracts. All relevant consumers use the common engine, with an honest delivery/qualification record.

### Change Outline

Only now switch default bindings to the next verified free versions, expected at the design baseline to be Workbench 10, Sources 7 and inspection 3. Sources 6 remains the retained-method binding. Update skills/examples using native Pi loading and the actual tools; keep old validators/results and all runtime/prepared input/result selectors consistent. Regenerate profiles through their owner, not by editing JSON.

Update `context/TECH.md` in place for the approved contracts, correcting its old indexed-search limit statement. Update `docs/ROADMAP.md` for verified capability and remaining quality limits; keep raw evidence in the implementation record. Search earlier references/history for superseded mechanisms and add dated pointers as required without rewriting old decisions. Review design smells by actual owner/caller changes, not by file count or short-function rules.

### Validation

#### Automated Verification

```sh
pnpm exec vitest run src/__tests__/convex/execution/operation-conformance.test.ts src/__tests__/convex/execution/pi-input-capacity.test.ts src/__tests__/convex/execution/native-state-observations.test.ts --maxWorkers=1
node --experimental-strip-types scripts/check-execution-boundaries.ts
pnpm agent-skills:sync
pnpm agent-skills:check
pnpm resource-policy:check
pnpm docs:check
```

When profiles changed, first use the established writer `UPDATE_PI_INPUT_PROFILES=1 pnpm exec vitest run src/__tests__/convex/execution/pi-input-capacity.test.ts --maxWorkers=1`, then rerun without that variable. Compare every applicable prepared `nativeToolSets` variant with its matching runtime declaration, including retained fingerprints and an already-admitted old invocation. Formatting/lint target task files after behavior stabilizes; never format the whole checkout merely for this feature.

Run `pnpm check` once after integration: this change is transversal across operation admission, durable storage, native contracts and source presentation, and that is the repository's CI aggregate. Do not run the aggregate after routine edits or treat it as hosted browser/provider proof. A successful isolated worktree watcher push and changed runtime scenario are required when validating against a live local backend; never substitute `convex:check` for synchronization.

Repeat the real captured long-document probe through the new registered path using controlled local SSE, with output in a worktree-owned evidence directory. Preserve the original probe/results. Adapt only its fixture wiring to the current approved path; import production owners, keep the captured hashes, assert the full pre-Start chain, and inspect actual serialized bodies for the requested ranges and absence of the complete 372,714-byte document after acquisition. Report bytes as bytes, not tokens or cost. Keep ignored capture-dependent probes out of default CI; deterministic stable fixtures cover regressions there.

#### Manual Verification

Review all original and recheck Oracle findings against actual implementation evidence, including first acquisition, post-Start reads and profile variants. Record which checks ran, what remains unverified, and the documentation ownership/duplication review. The earlier design reviews are not code acceptance. Browser CI is pending until its real run on the relevant revision completes. Hosted retrieval relevance, live model judgment and paid qualification require a separate mandate; passing controlled traces does not establish them.

## Worktree Handoff and Completion

Execute commands from the chosen worktree root. The companion archive is a local handoff, not an off-machine backup, deployment, environment snapshot or implementation authorization. Use its recorded baseline/allowlist to transfer the documents and fixtures; archive source locations are provenance, not permission to write to the primary checkout. Keep one implementation record with phase evidence, unresolved findings and the final current-reference updates.

The intended next-session command, after restoring this directory in that worktree, is:

```text
$rpi implement .agents/artifacts/sources-workflow-no-legacy; flow: tdd; use 18-tdd-documentary-engine-unification.md and 21-structure-outline-documentary-engine-unification.md
```

## Open Questions

None about the approved product/architecture. The worktree path and runtime identity are operational setup inputs to verify in Phase 0. If its code baseline differs, reconcile that measured drift before changing dependent contracts. No implementation phase or proposed verification has been executed by creating this outline.
