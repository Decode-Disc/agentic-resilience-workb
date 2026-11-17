# Documentary instruction context correction

Date: 2026-11-04. Code base: `523c98aebed055eada7eeca41741c59afd0cb7ee` with the retained working-tree changes. This correction follows the [offline Jev reassessment](2026-11-04-workbench-phase-guidance-jev-comparison.md#offline-reassessment-of-jev-judgment-quality). It repairs a demonstrated missing capability fact, not a demonstrated classifier error. No new inference or paid retrieval was performed.

## Cause and correction

Workbench could record a documentary request after preparation had closed, while delivery correctly limited that request. The bounded preparation context supplied to generation and Jev omitted this treatment limit. Recorded advice could therefore suggest advancing preparation through another instruction without exposing the fact that registration could not reopen it.

`convex/domain/sources.ts` now owns one derived instruction-admission rule: open, at the need ceiling, or closed. The bounded preparation summary includes its explanation. `convex/domain/workbenchInstructions.ts` uses that same rule against the current batch state before delivery. Workbench and response review receive the same projection through their existing context owners. No persisted schema, provider route, threshold, phrase filter or lifecycle mechanism was added. Open admission still requires framing, authority, execution and request-specific capacity checks; it is not a promise of completed treatment.

The owning statement in `context/TECH.md` now identifies this shared rule. The roadmap records the corrected capability gap and keeps semantic usefulness and calibration pending. Product scope is unchanged: recording an instruction cannot initiate another documentary phase.

## Executed verification

The integrated regression freezes a real Sources result before registering an instruction, starts the real Workbench turn, supplies an isolated generator receipt, and prepares the host-owned semantic-review request without dispatching it. It checks that both model context and the serialized Jev request carry the closed treatment limit, that real delivery returns the same limitation, and that the dossier remains idle in `sources_prepared`. Additional cases compare projected open and need-capacity states with actual delivery.

The meaningful RED was `pnpm test src/__tests__/convex/sources/sources-instructions.test.ts --maxWorkers=1 -t 'closed instruction treatment'`: context lacked `instructionTreatment`. Earlier simulation-admission and missing-receipt failures were fixture setup errors, preserved separately. The final selection passed **48 tests across six files**:

```sh
pnpm test src/__tests__/convex/sources/sources-instructions.test.ts src/__tests__/convex/sources/sources-instruction-capacity.test.ts src/__tests__/convex/sources/sources-instruction-projection.test.ts src/__tests__/convex/execution/response-control.test.ts src/__tests__/convex/execution/response-control-eligibility.test.ts src/__tests__/convex/execution/operation-conformance.test.ts --maxWorkers=1
pnpm typecheck
pnpm exec biome lint convex/domain/sources.ts convex/domain/workbenchInstructions.ts src/__tests__/convex/sources/sources-instructions.test.ts
pnpm exec node --experimental-strip-types scripts/check-imports.ts
pnpm exec node --experimental-strip-types scripts/check-execution-boundaries.ts
git diff --check
```

These checks passed. Local publication through `pnpm convex:sync --url http://127.0.0.1:3210` succeeded; `--release` then released the publication hold. Read-only runtime checks confirmed no active workers and no hold, Sources/Workbench/evaluation fixture flags unset, and Jev disabled at policy revision 4 with unchanged support 0.80 and contradiction 0.90 thresholds. This establishes publication and deterministic boundary behavior, not a fresh protected browser journey or provider answer quality. No global suite or application build was run for this scoped change.

## Frozen controller evaluation preparation

Eight development requests are prepared under `/tmp/workbench-instruction-treatment-20261104-xfit3cfs/frozen-jev`: four supported replies, three explicit contradictions and one unsupported attribution. Two retain recorded tentative framing replies. Five use recorded follow-up facts with the current production preparation summary substituted as an explicitly counterfactual replay; their replies isolate honest status, false status, false completion and false reopening advice. One minimal attribution fixture supplies no original role-bearing message. The ambiguous original CCC economic reply remains preserved and unscored.

Requests use the real `coherenceRequest` serializer and current Sources summary owner. Expected labels and rationales remain in a separate references file, outside provider inputs. The manifest hash is `50a4eb0fa47a90c0fe7bc9b5cce85137f5eaa97870bbea371f761eba78b23772`; total request bytes are 103,079, with a maximum of 21,768 per request, below the existing 32 KiB limit. References were curated by the coding assistant, are exposed development examples, and are neither independent human gold nor held-out evidence.

No request in this battery has been dispatched. There is no new confusion matrix, calibrated confidence estimate or threshold recommendation. A subsequent bounded controller-only lot would compare categorical choices with these references, then report class scores and the unchanged notice/correction rules separately. Existing historical paid approvals do not authorize that new lot.

The [verified archive](../../scripts/evaluations/archives/20261104T211956259Z-documentary-instruction-context/record.json) retains 51 files and 947,627 bytes: exact request fixtures, separate references, preparation script, relevant source snapshots, runtime checks and validation logs, including setup failures. Its report snapshot precedes this link addition. Storage is local only; byte verification does not establish semantic correctness.

## Capability decision

The shared capability-fact omission is corrected and locally published. This makes the relevant fact available; it cannot guarantee that generation uses it or that Jev detects every contradiction. Fresh advice quality, semantic correction, protected browser execution after this change and useful controlled Sources material remain unqualified. Sources stays disabled. The next useful semantic check is the frozen controller-only battery, followed by a decision on controller selectivity rather than automatic threshold tuning or another whole application lot.
