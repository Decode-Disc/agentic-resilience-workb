# Evidence retrieval retention repair

> **Dated evidence.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

Date: 2026-10-21

## Interpretation correction, 2026-10-22

The original inference that Snowflake's quarterly revenue evidence was absent upstream is withdrawn. The frozen scorer checks coverage of particular reference offsets, not all passages capable of establishing the requested metric. The reviewed reference (`scripts/evaluations/source-selection/fixtures/cross-company-20261020/retrieval-reference-review.json`, local reference as of 2026-10-22; not included in checkpoint `c4f0d24`) requires `snowflake-quarterly` offsets `53212–53433`. The same immutable capture (`scripts/evaluations/source-selection/fixtures/cross-company-20261020/captures/snowflake-quarterly.txt`, local reference as of 2026-10-22; not included in checkpoint `c4f0d24`) contains an equivalent revenue table at UTF-16 offsets `84161–84585`, headed `Disaggregation of Revenue`, with units and comparative reporting periods. Its three-month totals for July 31, 2026 and 2025 are 1,546,793 and 1,144,969 in thousands. This supplies the comparative amounts needed to examine the revenue question without reproducing the originally chosen table.

Read-only inspection on 2026-10-22 verified the capture against its study hash and this quotation against SHA-256 `f98d90ede4717647085c85104602c2005004c017229880d88862e3132b665d6c`. The equivalent span appears in the original [native hybrid final inputs](evidence-retrieval-20261021/native-metrics.json) for both focused and distractor conditions, and in the [repaired final inputs](evidence-retrieval-repair-20261021/replay-final.json) for both modes and both conditions. All four repaired conditions still record `complete: false` under the exact-reference scorer. Missing the frozen reference is therefore not proof that useful revenue evidence is missing.

The tables below retain the original exact-reference measurements. They are not recalculated as semantic accuracy, and this correction declares no retrieval winner. The qualification shown in the illustrative source-review journey is a separate historical output. A table present in comparison input does not establish that it was displayed in that qualification, correctly used by a model, materialized for later claims, or verified through a fresh live journey. The next evidence audit must distinguish capture availability, retrieved candidates, prepared context, displayed qualification and downstream analytical use. Equivalent passages require explicit adjudication, including metric, units and period, rather than automatic acceptance based on similar numbers. No provider call, new ranking run, reference rewrite or code change was needed for this correction.

## Scope and result

The user authorized passage-selection repair, evaluation-reference review and protected-flow verification. No new inference call, remote deployment, dependency change or commit was authorized or performed. The broader goal remains paused. Existing local services and unrelated working-tree changes were preserved. Local Convex automatically synchronized the source edits through its existing development watcher.

The production change is confined to `convex/domain/sourceComparison.ts`. For versioned retrieval, fully contained candidate quotations share one covering quotation rather than consuming redundant priority slots. After all retained findings receive their priority passages, the preparer includes additional retrieved evidence in the shared context, ordered by reciprocal rank fusion across findings. Every quotation retains its actual capture, hash and offsets. The input and response schema together must fit the 32-KiB expansion budget. Existing priority context may exceed that soft budget and is preserved under the unchanged 128-KiB hard limit. The 64-passage limit and eight-citation response limit remain unchanged. Legacy preparation behavior is preserved. No query-generation or ranker change is included.

## Reference review and measurements

The reference review (`scripts/evaluations/source-selection/fixtures/cross-company-20261020/retrieval-reference-review.json`, local reference as of 2026-10-22; not included in checkpoint `c4f0d24`) classifies all sixteen historical controls: six comparable, four context-only and six unresolved. Each classification records its scope and rationale. Unresolved controls are not scored as successes. This is assistant-authored reference review, not independent human ground truth. The historical study, references and native measurements remain unchanged.

The offline replay uses saved native rankings, actual persisted row identities and immutable captured text through the real production preparer. It performs no new search, embedding or generative call. Each underlying control has focused and distractor conditions, so twelve comparable conditions represent six controls, not twelve independent questions.

| Measure | Lexical before | Lexical after | Hybrid before | Hybrid after |
| --- | ---: | ---: | ---: | ---: |
| Comparable references retained | 10/12 | 10/12 | 6/12 | 10/12 |
| Context-only references retained | 5/8 | 5/8 | 2/8 | 2/8 |
| Original historical reference sets retained | 17/32 | 21/32 | 12/32 | 16/32 |
| Median serialized input bytes | 20,940 | 32,525 | 20,107 | 32,570 |

Both remaining comparable exact-reference misses concern the same Snowflake quarterly-revenue control. Its required span is absent from the saved top-64 candidates, but an equivalent table is supplied as described in the interpretation correction above. The original conclusion that useful revenue evidence was absent upstream was too broad. Historical-score improvements include contextual or poorly aligned controls and must not be presented as additional validated factual answers.

Budgets of 32, 48, 64 and 128 KiB all retain 10/12 comparable conditions for both modes. Larger budgets improve some contextual and historical retention, but provide no additional comparable-reference recall on this reviewed set. The default is the smallest tested budget achieving that result, not a proven optimum for dynamic sources. Median input volume rises approximately 1.55 times for lexical and 1.62 times for hybrid. Later generative processing may therefore cost more. No new monetary cost was incurred by this replay. Neither mode is declared the winner and no model-verdict accuracy was measured.

Durable evidence: [final replay](evidence-retrieval-repair-20261021/replay-final.json), [budget comparison](evidence-retrieval-repair-20261021/budget-summary.json), [native row projection](evidence-retrieval-repair-20261021/ranked-rows.json) and [candidate-versus-selection audit](evidence-retrieval-repair-20261021/stage-audit.json). The final replay records hashes of the frozen reference, reviewed reference, native row projection and production preparer. It reports zero provenance failures.

## Verification boundaries

Regression tests first reproduced loss of the ninth ranked passage and retention of a redundant contained fragment, then passed after the production repair. Tests also cover the soft and hard budgets, legacy behavior, response citation validation and multi-finding priority preservation. The action integration test executes the actual comparison action, index/preparation logic, response validation and persistence, mocking only the external provider. It proves that an extra passage can reach the provider, be cited with exact provenance and be reused without a second provider request.

The browser verification uses real anonymous authentication and analyst admission on the local backend with explicitly illustrative source data. Both desktop and mobile reached approval, verified late-evidence materialization into one source version with at most 512 passages, and retained admission and approved state after reload. The desktop test nevertheless failed its final console-error assertion because the existing company-image client received CORS failures from `https://api.poly.io/og`. Mobile passed. The image client is byte-identical to the pre-repair snapshot. This external presentation failure is retained, not suppressed or relabelled as a clean browser pass. The existing Google-favicon isolation remains unchanged. This browser fixture does not prove a live model assessment or a complete live discovery-to-analysis run.

The local `E2E_FIXTURES_ENABLED` flag was temporarily enabled for the browser check and removed afterward. Normal preparation activation and model credentials were not changed. Changed-input model quality and ordinary live activation remain unverified.

Final commands and results:

| Command | Result |
| --- | --- |
| `pnpm test src/__tests__/convex/sources/source-comparison.test.ts src/__tests__/convex/sources/source-comparison-action.test.ts` | 26 tests passed after the regression fixes. |
| `pnpm test src/__tests__/benchmarks/source-quality-study.test.ts` | 28 tests passed, including separated reference denominators and full-span coverage. |
| `pnpm test` | Final candidate: 143 files and 1,130 tests passed in 141.96 seconds. Existing jsdom navigation and scrollTo not-implemented messages remain in the log. |
| `pnpm check` | Design synchronization and client/backend typechecks passed, then stopped on the unchanged array-index key lint error at `src/components/workbench-shell/analyzed-company-list.tsx:114`. |
| `pnpm exec biome lint` with the seven changed TypeScript production, script and unit-test files | Passed without warnings. |
| `pnpm exec biome format --write` with those same seven files | No fixes required after final formatting. |
| `node --experimental-strip-types scripts/check-imports.ts` | Passed. |
| `pnpm format:check` | Twenty existing formatting errors outside the repair scope. |
| `pnpm build` | Passed. Build plugin-timing advice remains informational. |
| `pnpm exec playwright test --config playwright.retrieval.config.ts --output /tmp/evidence-retrieval-repair-20261021/browser` | One passed, one failed. Both completed the protected functional assertions. Desktop failed the final console assertion on the image-service CORS errors described above. No retries or increased timeouts. |

The mobile approved-state screenshot also shows existing horizontal clipping in the coverage notice. No UI layout was changed by this repair, and the functional browser assertions must not be interpreted as visual acceptance. The source-selection, test and replay changes do not resolve this presentation issue.

The pre-repair snapshot covers 1,682 existing files. The final scope audit records eleven changed files, seven added files and no deleted files, all within the authorized repair and its documentation/evidence. Both the image client and the globally failing lint file match their initial hashes. The scope audit and exact command logs remain in the repair directory.

## Reproduction

All command logs, failed and passing test evidence, browser screenshots and the initial file-hash snapshot are under `/tmp/evidence-retrieval-repair-20261021`. Earlier frozen inputs remain under `/tmp/evidence-retrieval-implementation-20261021/evaluation-v2`.

```sh
node --experimental-strip-types scripts/evaluations/source-selection/check-source-comparison.ts \
  --study scripts/evaluations/source-selection/fixtures/cross-company-20261020/study.json \
  --retrieval-phase replay \
  --run-dir /tmp/evidence-retrieval-implementation-20261021/evaluation-v2 \
  --ranked-rows docs/verification/evidence-retrieval-repair-20261021/ranked-rows.json \
  --reference-review scripts/evaluations/source-selection/fixtures/cross-company-20261020/retrieval-reference-review.json \
  --report-file /tmp/new-retrieval-replay.json
```

The runner refuses to overwrite a report. Optional `--company`, `--retrieval-mode lexical|hybrid|both` and `--context-bytes` selectors require no script edits. Native execution and offline replay share the same request builder.

## Remaining work

First audit useful evidence and equivalent passages at each processing boundary before proposing another retrieval change. The Snowflake observation alone does not establish a defective query or justify tuning for one reference location. Independent reference adjudication and unfamiliar companies are still needed before claiming general robustness. Historical image-service and global lint/format failures remain recorded; subsequent interface and security corrections are documented in the [utility report](2026-10-21-source-utility.md) and [source-review correction report](2026-10-22-source-review-corrections.md). Activation or changed-input generative evaluation requires its own authorized scope and budget. The separate 600-character comparison explanation limit remains unchanged and deferred until the evidence-preservation investigation is addressed.
