# Shared operation contracts and refusal recovery — 2026-11-04

## Boundary and decision

This implementation addresses the controller-off qualification's demonstrated harness failures without another provider batch or Sources activation. Stable source selection and immutable capture identity remain distinct. All registered operations declare their result contract, and execution owns serialization, structural validation and adoption. The current obligations are in [TECH](../../context/TECH.md); the [original qualification](2026-11-04-sources-controller-off-gpt-oss120b-qualification.md) preserves the paid observations and archive.

## Demonstrated corrections

The registry-wide refusal reproduction originally returned `operation_not_allowed` for retained `invalid_operation_input`; the corrected path preserves the admission receipt after current authority checks. A wrong-table input now carries its field and expected ID type. Acquisition returns `sourceId`, `captureId` and content hash through the canonical material reference; legacy inspection fields remain at their established boundary. Missing or unconstrained result contracts are rejected, and malformed observations remain inspectable without becoming adopted effects. A two-version regression demonstrated that reading selected an older retained capture after acquisition returned the newer one. The retrieval owner now selects the newest authorized committed capture; a previously pinned read receives an explicit version conflict instead of changing its representation. Importing the Sources consumer directly also exposed an eager catalogue initialization cycle; deferring imported-definition reads preserves the static catalogue while allowing either module import order.

The real simulated Pi worker originally stopped after a completion omitted a need. Its regression now exercises correction through a fresh invocation, immutable initial output, once-only working notes and the shared non-progress ceiling for repeated refusal. The optional response controller is unchanged.

## Verification

The meaningful REDs were exercised through registered execution boundaries and the real simulated Pi worker. Before correction, registry-wide invalid-input dispatch returned the wrong refusal, acquisition/read disagreed on capture identity, result registration accepted absent or unconstrained schemas, malformed results escaped structural adoption checks, and omitted-need completion stopped after one response. Nested-object diagnostics also reported the received `Array` prototype instead of the expected schema type. The consuming-module import test exposed the catalogue initialization cycle. Local failure logs are retained under `/tmp/workbench-contracts-` with the `red`, `reference-red`, `diagnostic-red`, `correction-real-red`, `unconstrained-red`, `nested-diagnostic-red` and `capture-head-red` suffixes; these are implementation evidence, not provider qualification.

Executed final checks:

```sh
pnpm test src/__tests__/convex/execution src/__tests__/convex/sources src/__tests__/convex/integrations src/__tests__/convex/admin/model-configuration.test.ts --maxWorkers=1
pnpm exec vitest run src/__tests__/convex/execution/pi-input-capacity.test.ts --maxWorkers=1
pnpm test src/__tests__/config/execution-boundaries.test.ts src/__tests__/convex/sources/sources-discovery.test.ts src/__tests__/convex/execution/operation-result-contracts.test.ts src/__tests__/convex/sources/sources-completion-correction.test.ts --maxWorkers=1
pnpm typecheck
pnpm exec node --experimental-strip-types scripts/check-execution-boundaries.ts
pnpm exec node --experimental-strip-types scripts/check-imports.ts
pnpm build
pnpm docs:check
git diff --check
```

The selected backend battery passed **1,236 tests across 135 files**. The separate installed-profile check passed three tests already included in that battery. After the runtime-directive correction below, 20 tests across four selected files passed, including the architecture checker's accepted and rejected directive fixtures; the affected backend cases were deliberately rerun rather than repeating the entire battery. Application/backend types, execution ownership, imports, build and whitespace checks passed. Scoped Biome checking passed for the task's TypeScript and generated profile files. The build emitted bundle-size and plugin-timing advisories; documentation checking reported no errors and retained its advisory technical-document word warning. No project-wide test or lint suite, independent review or paid provider evaluation was run in the initial correction stage. Subsequent independent review and its corrections are recorded below.

The result-contract, refusal and continuation coverage spans all registered definitions, native and mission dispatch, source/capture table identity, malformed observation preservation, refused replay, immutable outputs, working notes and the existing three-turn non-progress ceiling. Historical saved-material guards, operation effects, accounting, cancellation/recovery and optional response-control regressions are included. Provider calls are forbidden in deterministic tests. These checks do not establish model-quality acceptance or general crash/OCC recovery.

## Local publication and configuration

The first local publication failed before upload because newly added imports preceded `sourcesMissionActions.ts`'s `"use node"` directive. Biome had rendered the displaced string as a parenthesized expression, so Convex compiled its Node-only imports for the default runtime. This was an implementation defect, not a provider or model failure. The directive is restored to the prologue. A RED fixture and the real repository scan demonstrated that the existing architecture checker missed displaced and parenthesized runtime directives; its new AST rule now rejects both and accepts a real directive before imports. The original failed publisher and checker outputs remain in `/tmp/workbench-contracts-local-publication.log` and `/tmp/workbench-contracts-node-directive-real-red.log`.

```sh
pnpm convex:sync --url http://127.0.0.1:3210
node /tmp/workbench-contracts-runtime/admin.mjs refresh
pnpm convex:sync --url http://127.0.0.1:3210 --release
```

Final publication succeeded on the existing `local-aboul_panga-dd_proto` backend at `http://127.0.0.1:3210`, including generated bindings, backend typechecking and schema validation, with no index deletion or service restart. The installed CLI emitted Node's optional disk-backed `localStorage` warning; it did not prevent publication. Publication admission was held while code changed and explicitly released after profile preparation. The final registered status query returned `held: false` and `hasActiveWorkers: false`.

A real protected administrator session refreshed all 19 profile pages for the five ready catalogue models using the existing offline preparation owner. Cross-publication comparisons preserved assignments, immutable model revision IDs, enablement, selectability and response-control settings. The controller remained disabled. Twelve authenticated catalogue reads after refresh succeeded; these are administration checks, not the failed historical analyst queries or a Sources browser journey. Read-only runtime checks confirmed Sources and E2E fixtures remained disabled and the five latest provider receipts were unchanged before and after publication. No provider inference, search or capture was executed during implementation.

## Runtime limit

Saved runtime metrics establish four one-second failures before the Adobe handoff, with no documentary growth capable of proving the cause. The original logs do not distinguish the underlying runtime mechanism. Current local checks are a separate code stage and cannot retrospectively establish that cause. Sources remains disabled while protected runtime reliability and fresh documentary usefulness remain unqualified.

## Independent review corrections — 2026-11-04

Five independent read-only lanes reviewed the frozen 49-path correction. API and performance approved; architecture remained clear with a documentation comment. The consolidated review identified one medium settlement-replay defect and two low findings concerning rejected-observation retention and an overbroad documentation guarantee. The initial claim that rejected results could not replay as success omitted direct settlement replay: normal dispatch was protected, but repeating `recordResult` returned its raw rejected success.

The settlement owner now checks the retained adoption refusal after current authority on replay. It also preserves an observed success when a domain validator returns a refusal, recording that code separately through the existing adoption-failure path. This protects every applicable operation without changing individual domain validators. Refused observations receive no adoption timestamp or domain progress; their immutable observed-event payload remains exact. TECH's notes guarantee is narrowed to completions refused for correction; the pre-existing behavior for other invalid completions is not changed.

New native replay and native/mission identity-refusal regressions failed for the reviewed defects before implementation. Logs: `/tmp/workbench-review-fixes-settlement-red.log` and `/tmp/workbench-review-fixes-observation-red.log`. After correction, all 13 result-contract tests passed; 59 preservation tests across eight selected files passed. Application/backend typechecking, execution ownership, imports, scoped Biome checking and whitespace checks passed. No paid provider call is included in these correction results.

The reviewed corrections were subsequently published successfully to the same existing local backend. Twelve protected administrator catalogue reads passed; assignments, model availability and the disabled response controller remained unchanged. The publication hold was released and Sources/E2E fixtures stayed disabled. A proposed new paid lot is separate from these unpaid correction results and requires its own explicit authorization.
