# Source preparation utility across companies and dossier types

Date: 2026-10-21

## Outcome and interpretation

This implementation evaluates whether an analyst can inspect useful source material, see limitations, adjust a proposal and approve a durable corpus across eight scenarios. It uses Adobe, Nvidia, Snowflake and CrowdStrike, with general overviews, targeted technical questions, supplied HTTPS references and uncertain arguments. It does not optimize a single retrieval numerator. The frozen needs are in [utility-scenarios.json](../../scripts/evaluations/source-selection/fixtures/cross-company-20261020/utility-scenarios.json).

The recorded material supports useful preparation, with uneven relevance and remaining manual reading. The historical Snowflake qualification displayed in this journey does not supply the requested quarterly revenue table. That observation must be separated from the comparison input: read-only inspection on 2026-10-22 found an equivalent table in both repaired retrieval modes. See the [interpretation correction](2026-10-21-evidence-retrieval-repair.md#interpretation-correction-2026-10-22). Successful approval, useful comparison context and adequate displayed qualification are distinct observations; none proves a completed analytical answer.

Two demonstrated defects were repaired. Otherwise equal source candidates previously used database IDs as their final ordering key, so recreated records could change which distinct documents were recommended. Policy `source-selection-v11` now uses the existing canonical URL identity before database ID, preserving authority, provider order, recency and research-angle precedence. This makes ties repeatable, not semantically better. Existing v10 drafts are refreshable through the existing local mutation, without rediscovery or new provider calls. The prior proposal and analyst decisions remain immutable. Older policy migrations retain their existing behavior. The approved-state coverage notice also allowed long labels to enlarge its grid column and overflow on mobile. Minimum width and label wrapping are corrected only in that consumer.

## Scope and preservation

| Surface or contract | Treatment | Evidence and effect |
| --- | --- | --- |
| Source inspection, adjustment, human approval and reconnection | Preserve | Protected browser journeys use the existing screens and mutations. |
| Claims, source rejection rules, provenance and provider configuration | Preserve | No change to these owners or their activation. |
| Proposal ordering | Modify | Four regression cases showed selection changing when only source IDs were exchanged. Canonical identity now breaks ties under a new policy version. Existing immutable proposals remain unchanged. |
| Coverage notice | Modify | An approved mobile notice had 289 pixels of content within 238 pixels of available width. Scoped wrapping repairs this overflow without changing shared alert or badge defaults. |
| Evaluation fixtures and runner | Extend | Reuse the existing guarded source-review fixture, real qualification preparer/materializer and real proposal/approval boundaries. No parallel evaluator or copied domain algorithm. |

No component, workflow engine or interface interaction was removed or replaced. No dependency, remote deployment, commit, new agent or broader-goal resumption is included.

## Analyst needs and observed limits

These are investigator judgments against the frozen needs, not independently adjudicated model accuracy. Every row retains its original failure or uncertainty.

| Scenario | Useful preparation available | Remaining analyst work or limitation |
| --- | --- | --- |
| Adobe general overview | Firefly product/API material, quarterly filing and external analysis are inspectable. | Annual qualification remains unavailable: its historical response exceeded the finding envelope. Some filing excerpts are XBRL metadata rather than readable business context. Review the annual original if needed. |
| CrowdStrike general overview | Platform, filings, integration material and incident reporting remain accessible. | Separate company descriptions from external reporting, and a historical incident from a general architectural conclusion. |
| Nvidia targeted integration question | NIM deployment examples, platform descriptions and the annual filing provide technical starting points. | The captured GitHub title is unhelpful (`> [!IMPORTANT]`). Descriptions of an offering do not establish actual customer control or outcomes. |
| Snowflake targeted architecture question | The architecture page describes storage, compute and cloud services. SQL API material remains inspectable and can be included. | The final initial proposal retains a documentation index while SQL API is an alternative. The historical qualification misclassified the index. The tie repair does not fix this relevance error. Explicit inclusion of SQL API and rejection of the index are exercised. |
| Adobe supplied terms | The supplied URL remains in the proposal. Scope, grant and third-party terms have locatable passages. | General terms do not establish Firefly-specific indemnification. No such conclusion is credited. |
| Snowflake supplied quarterly filing | The supplied filing is retained and can be approved, with recorded passage and partial-reading information. | The displayed historical qualification does not contain the requested revenue table. Both repaired comparison inputs contain an equivalent table, although the exact-reference score misses it. Its use in a new qualification or downstream analytical answer is unverified. |
| Nvidia uncertain switching-cost argument | External argument and licensing context are retained for inspection. | The economic causal claim is unresolved. No fresh comparison or factual validation of switching costs was performed. |
| CrowdStrike uncertain AI-authority argument | External analysis and incident context are inspectable. | Consolidation language, file-processing terms and an incident do not establish delegated AI authority. No such inference is credited. |

The manually supplied references exercise the persisted intake-origin and review behavior; the runner does not submit a fresh public URL through live discovery. Each company uses the same captured eight-document pool in its two scenarios. This tests different analyst intents and human-review paths, not independent fresh discoveries. The pools and qualifications had already been observed in earlier work and are not a new holdout set. Stable SEC CIKs are retained, while run labels clearly identify recorded review.

## Historical response and retrieval boundaries

All 32 qualification capture hashes, historical wire request hashes and original prepared input hashes are checked. Historical DeepSeek V4.1 Flash outputs are materialized only against their exact original company, date, text and research angle. They are persisted with `executionMode: showcase` and displayed as illustrative assessments. Changing the dossier angle never reinterprets an old output as a fresh qualification. The rejected Adobe annual response remains rejected. The valid historical outputs are not independently semantically verified merely because their schemas pass.

The existing [retrieval replay](evidence-retrieval-repair-20261021/replay-final.json) is considered only where its controls are compatible with these needs. Both saved modes retain the reviewed Nvidia integration and Snowflake architecture passages. Both also contain an equivalent Snowflake quarterly-revenue table; the earlier statement that both missed the table is withdrawn. Lexical retains the reviewed Nvidia licensing context that hybrid misses, but that context cannot prove switching costs. Adobe indemnification and CrowdStrike AI delegation remain unresolved controls. This evidence does not establish either method's superiority or justify another paid model. No new embedding, search, inference or native retrieval evaluation was run for this correction.

Keep the inexpensive existing approach provisional and judge it by useful retained sources, missing evidence and analyst effort. The next quality improvement should target document substance and question-specific passage selection across multiple companies, with the same approval checkpoint. Do not enlarge the context budget or choose a different model merely to improve the old aggregate denominator.

## Verification and reproducibility

Detailed outcomes and exact input identities are in [results.json](source-utility-20261021/results.json). Browser timing is automated local journey duration, including persistence queries. It is not a measurement of analyst time saved. Deliberate removal and reinclusion exercise analyst controls and must not be counted as necessary extra work for every dossier.

The browser gate uses real anonymous authentication and the existing analyst invitation, with independent recorded runs for eight desktop and four mobile journeys. It reads an actual recorded quotation, rejects an index control, removes/reincludes or includes the selected source, approves with the keyboard, reloads and verifies the persisted accepted/rejected decisions. Mobile source drawers close with Escape. Geometry assertions check the coverage notice after approval. Reduced motion is enabled. Viewports are 1440×900 and 390×844.

Decorative company images and favicons are isolated. Recorded source-preview caches explicitly say that they are fixtures and direct the reader to Source details. This prevents the local rendering service from fetching public source pages during the final gate. The first preliminary browser probe did attempt that local preview path before isolation was added. It launched no model inference, but provider-call telemetry alone does not account for preview rendering. The existing external image-service CORS issue remains outside the isolated browser gate and is not repaired or called a clean unsimulated external-media check.

Earlier failed browser attempts remain under `/tmp/source-utility-20261021`. Failures include a missing Source details tab selection, selectors matching the outgoing overview during its exit animation, and navigation contexts being destroyed during concurrent browser probes. The final test selects the actual Source set region, runs sequentially and requires a fresh draft before each approval. No forced click, raised timeout or retry is used. A later visual audit detected that full-page capture temporarily changed the browser viewport from 1440×900 to 1×1, causing responsive remounting and resetting Source details. Mutation-observer evidence isolated the change to screenshot capture: the selected tab stayed stable before capture and remounted afterward. Final checks use viewport captures and assert that the reading tab and quotation remain open. No additional application change was made for that tool artifact. The initial synthetic-CIK fixtures were invalid baselines and are retained separately. Later fixtures preserve real CIK and SEC form metadata.

Reproduction requires the existing local Convex and Vite services and the existing admitted analyst fixture. No secret is printed. Temporarily enable the guarded local fixture flag, choose a new output directory and restore the flag afterward:

```sh
pnpm exec convex env set E2E_FIXTURES_ENABLED true --deployment local
node --experimental-strip-types scripts/evaluations/source-selection/source-utility.ts --phase seed --out-dir /tmp/source-utility-new-run
UTILITY_SEEDED_FILE=/tmp/source-utility-new-run/seeded.json pnpm exec playwright test --config playwright.utility.config.ts --output /tmp/source-utility-new-run/browser
pnpm exec convex env remove E2E_FIXTURES_ENABLED --deployment local
```

Use `--phase audit` for read-only local hash/materialization checks without database writes. Use `--scenario` with comma-separated frozen IDs to select cases without editing the script. Reports refuse overwrites. The completed seed manifest is published only after every selected scenario is seeded; intermediate progress has a separate filename. The standalone mobile regression test requires the Adobe mobile approval run, so select an appropriate Playwright test filter when running only another scenario.

## Remaining acceptance limits

Live discovery, new-angle model quality, comparison verdicts, unfamiliar-company robustness and later analytical claims are unverified here. Corpus approval does not validate each assertion. The supplied quarterly source is retained but the specific numeric task remains insufficiently prepared. The documentation-index classification and unhelpful captured title remain visible quality issues. These limits must remain distinct from successful local interface and persistence checks.


## Final verification results

| Check | Result |
| --- | --- |
| Original-input audit through `source-utility.ts --phase audit` | All 32 capture/request/input bindings reproduced. The selected-case audit also selected Adobe overview and CrowdStrike uncertainty without script edits. No model call. |
| Database-ID regression | Four company-parametrized tests failed before the tie repair and passed afterward. Four desktop/mobile scenario pairs also produced identical ranked URLs with different database IDs. |
| Previous-policy refresh regression | Failed with `outdated` before the compatibility repair. It now creates a ready v11 proposal from stored candidates, preserves the old v10 proposal and rejected-source decisions, and performs no fetch, DNS lookup or provider call. The combined fixture, proposal and live-review tests passed: 34 tests. |
| Mobile geometry regression | Failed before the CSS repair with content width 289 and available width 238. Passed afterward. Final journey assertions found no notice overflow in any tested viewport. |
| Protected browser gate | 14 tests passed: eight fresh desktop approvals, four fresh mobile approvals, one mobile layout regression and one persistent-reading check. All twelve approvals preserved the explicitly included and rejected sources after reload. A postflight query found zero recorded provider calls in all twelve runs. Both read-only browser regressions passed again after the final compatibility repair. |
| `pnpm test` | Final candidate: 144 files, 1,137 tests passed in 150.75 seconds. Existing jsdom messages for unsupported navigation and `scrollTo` remain visible. |
| `pnpm typecheck` | Client and Convex checks passed after the final compatibility repair. |
| Focused Biome lint/format and import check | Task TypeScript files passed scoped lint/format; `scripts/check-imports.ts` passed. The browser specification is outside the global Biome include and was separately checked/formatted through its TypeScript stdin interface. |
| `pnpm build` | Passed after the final compatibility repair. Plugin-timing advice remains informational. |
| `pnpm check` | Design synchronization and typechecks passed, then the existing array-index key error at `src/components/workbench-shell/analyzed-company-list.tsx:114` stopped the command. That file is byte-identical to the initial snapshot. |
| `pnpm format:check` | Twenty existing errors outside this task's changed files. No unrelated formatting repair. |

An earlier full-suite run had one assertion tied to the previous ID order and one unchanged navigation test exceeding its five-second limit while browser checks ran concurrently. The ordering expectation was updated to assert both dispositions under canonical ordering. The navigation test passed in isolation and in subsequent complete runs without increasing its timeout. Earlier failure logs are retained.

Final automated review journeys took 15.6–19.2 seconds, with a median of 16.8 seconds. These durations include local persistence queries and artificial control exercises. They establish neither a human review-time baseline nor a percentage of analytical time saved. New inference expenditure was USD 0. Historical qualification output was reused, with no provider activation.

Visual evidence: [mobile coverage before](source-utility-20261021/mobile-coverage-before.png), [mobile coverage after](source-utility-20261021/mobile-coverage-after.png), and [approved Snowflake passage reading](source-utility-20261021/snowflake-reading-desktop.png). The before/after mobile captures are from the isolated layout regression; final viewport geometry is recorded separately in the journey evidence. The initially misleading full-page reading capture and its 1×1 viewport diagnosis remain in the temporary evidence directory, not as evidence of successful reading.

The scope audit compares 1,689 pre-existing files: eight changed, ten added, none deleted. Product/agent instructions, dependencies, source comparison/retrieval preparation and the external image client retain their initial hashes. Eight changed files comprise three production modules, the existing fixture module, three test files and the technical context. The broad uncommitted working tree is preserved. Both original local services remain listening on ports 3000 and 3210. The temporary local fixture flag was removed. No remote deployment or commit occurred, and the broader goal remains paused.

Exact command logs, failed attempts, initial hashes, postflight query results and all browser captures remain under `/tmp/source-utility-20261021`. The durable result file contains code/input hashes, case-level observations and the scoped file audit. No private invitation or credential is included.
