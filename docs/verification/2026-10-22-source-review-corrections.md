# Source review corrections

## Scope and authority

The user authorized correction of all ten findings from the independent review of the current working tree at `a9f30ae29dd0d796dc8b3f1f04055c7067e330b6`, using test-driven development. The reviewed implementation spans source selection, retrieval, corpus revision approval and the visual preview dependency. The original broader goal remains paused. No model replacement, paid provider evaluation, remote deployment or commit is included.

The extensive pre-existing working tree is the baseline. Its 1,699 tracked and untracked file hashes were recorded before editing in `/tmp/source-review-fixes-20261022/before-hashes.json`; original contents of affected production and test directories are preserved under `before/`. The independent review is `/tmp/source-quality-independent-review-20261021T225918Z/report.md`. A task-specific file inventory is maintained in `/tmp/source-review-fixes-20261022/task-files.json`.

## Corrected behavior

| Reviewed defect | Result and regression boundary |
| --- | --- |
| Eligible captures disappear behind scope-wide top-k results | The actual retrieval action retains both requested captures with 300 matching distractors outside their scope. Lexical reads are capture-specific transactions. Vector filters include capture identity before top-k. Legacy cached vectors are relinked without another provider request. |
| Reopened legacy corpus cannot be approved | Public reopen, adjustment, approval and repeated approval exercise the existing evidence handoff. Only accepted sources are frozen. The older revision remains unchanged. |
| Preview can reach a private destination after initial validation | A real Chromium gate renders a controlled public page, blocks a private redirect and private resources, refuses DNS rebinding, enforces the redirect allowance and rejects credentials on a redirect. A per-render CONNECT proxy pins the actual numeric destination. |
| Unavailable inspection removes an analyst reference | Valid supplied references remain recommended for Snowflake and NVIDIA while coverage stays empty and inspection remains visibly unavailable. |
| Qualification loses distinct reporting periods | Two qualified quarterly periods remain recommended for Adobe and CrowdStrike under the existing ceiling and series rules. |
| A document can satisfy only one coverage role | A single qualified technical document covers platform and integration needs. Neither need appears in the supplement-driving coverage gaps. Independent-producer constraints remain separate. |
| A local caveat restricts unrelated contributions | The real proposal, review projection and evidence-use guard preserve an unrelated documentary fact and restrict the flagged assertion. An unlocated caveat still restricts both. |
| New revision immediately has a stale fingerprint | The first public read of the new revision is ready, based on its own decisions rather than the old revision's rejection. |
| Preview cache is anonymously readable | Anonymous and foreign-user reads return no image. The admitted owner can read a fresh pending-source preview. |
| Revoked or late preview results remain usable | Visitor or invitation revocation denies reads and rendering. Revocation during the external request prevents delivery and atomic cache persistence. |

Policy v12 can refresh saved v10/v11 proposals without discovery or provider calls. The prior proposal and analyst decisions remain immutable. The correction does not turn unknown or disputed content into factual evidence.

## TDD and verification evidence

Each defect was reproduced before its production correction. Focused RED/GREEN logs are retained in `/tmp/source-review-fixes-20261022/`, including `manual-retention-*`, `period-retention-*`, `coverage-*`, `contribution-restriction-*`, `preview-cache-auth-*`, `preview-revocation-*`, `preview-late-*`, `reopened-approval-*`, `revision-fingerprint-*`, `retrieval-scope-*`, `retrieval-legacy-*`, `preview-egress-*`, `preview-redirect-url-*` and `policy-refresh-*`.

- `pnpm test`: 145 files and 1,153 tests passed. Existing jsdom navigation and `scrollTo` notices remain visible in `full-tests.log`.
- `pnpm typecheck`: passed for the application and Convex.
- `npm run typecheck --prefix services/playwright-browser`: passed for the separately packaged preview service.
- `pnpm check`: design synchronization and typechecking passed. The chain stopped at the pre-existing `noArrayIndexKey` error in `src/components/workbench-shell/analyzed-company-list.tsx:114`. That unrelated file was preserved. Tests and build are checked separately rather than reporting this command as green.
- Scoped Biome lint and formatting checks plus `scripts/check-imports.ts`: passed. Global `pnpm format:check` reports 20 pre-existing formatting failures. Every affected file's hash matches the pre-task baseline.
- `pnpm build` and `npm run build --prefix services/playwright-browser`: passed. No remote service was deployed.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome pnpm exec vitest run --config services/playwright-browser/vitest.config.ts src/__tests__/services/preview-egress.spec.ts`: all 10 dedicated browser boundary tests passed. They use real Chromium, temporary loopback HTTPS pages and mocked DNS/socket destinations. They never request an external website. The service's expected bundled Chromium was unavailable locally, so the already installed Chrome executable is supplied only to the test. TLS trust is relaxed only for the generated test certificate, not in production code.
- `/tmp/source-review-fixes-20261022/native-scope-final.mjs`: both lexical and vector retrieval retained the two requested captures on the real local Convex indexes despite 300 out-of-scope candidates. Vectors were synthetic, cached inputs. The final gate ran after the bounded-memory refactor and generated zero new provider records. This proves scope enforcement, not embedding relevance or model quality.
- After the complete suite, the final contribution-restriction assertions and fixture guards passed 43 focused tests. The retrieval memory refactor then passed its eight focused tests. No production behavior changed after these checks.

The local backend was already running. `convex dev --once` initially refused to start another instance. Functions were then pushed directly to `127.0.0.1:3210` using its existing local credentials. The CLI removed the local deployment selector despite the explicit alternate environment file; that selector was restored and other environment entries preserved. Neither the existing backend nor Vite was stopped. The preview container was not deployed or restarted.

The source-review browser command used `UTILITY_SEEDED_FILE=/tmp/source-review-fixes-20261022/utility/seeded.json pnpm exec playwright test --config playwright.utility.config.ts --output /tmp/source-review-fixes-20261022/browser`. The initial execution passed 13 of 14 tests. The CrowdStrike uncertainty desktop case lost its tab locator during the transition to the inspection URL. The test now explicitly waits for that URL and for the selected source's heading before clicking its details tab. It preserves the original deadlines, assertions and single-click behavior. The affected scenario then passed with `--grep 'crowdstrike-uncertainty desktop'` and a separate output directory. The original failure remains in `local-gates.log` and the browser error context. This is 13 initial successes plus one successful focused revalidation, not an uninterrupted 14/14 run and not a claim of a production UI repair.

These 14 browser cases cover eight scenarios across Adobe, CrowdStrike, NVIDIA and Snowflake, including desktop/mobile inspection, recorded source reading, adjustment, rejection, keyboard approval, reconnection and retained approval. Each scenario's inspection reported zero run-bound provider calls. The navigation revalidation also recorded zero new global provider calls. The fixture flag was restored to its original disabled value after both successful and failed executions.

The scope audit lists 21 existing files changed and three files added, with no files deleted. The other 1,678 baseline files retain their hashes. Both existing service processes remain listening on their original ports and process IDs. No commit was made.

## Unexpected website lookup during validation

The global provider audit found one unintended Exa call while the initial browser suite displayed the new synthetic retrieval fixture. That fixture had no website metadata. The existing company-list backfill therefore invoked `resolve_company_website` for `e2e-scope-20261022`. The call returned no accepted company website and recorded `website_not_resolved`, but the provider reported **USD 0.007**. This was a validation mistake and violates the intended zero-paid-call boundary. The earlier zero-cost statement is withdrawn. A failed website resolution does not imply a free request.

The provider record is preserved. Its operation key is `company:e2e-scope-20261022:resolver:exa-company-website-v1:window:691`; the sanitized audit is `/tmp/source-review-fixes-20261022/local-provider-audit.json`. No model or embedding call occurred. The synthetic fixture alone was assigned an explicit `https://example.invalid/` placeholder through the existing internal metadata mutation, with no fabricated provider provenance. The native gate now prepares that placeholder before browser use. The later navigation and final native gates recorded zero additional provider calls. No credentials were removed, replaced or exposed, and normal application provider configuration was preserved.

## Interpretation and limits

These corrections protect useful preparation and analyst control. They do not establish that every future company, research angle or dynamic source will be covered. The recorded cross-company review remains an illustrative replay of known captures and original model outputs. The native synthetic vector gate is an algorithmic regression check, not a semantic benchmark. Index classification and Adobe annual qualification limitations remain recorded. The [Snowflake interpretation correction](2026-10-21-evidence-retrieval-repair.md#interpretation-correction-2026-10-22) distinguishes a missing exact reference from an equivalent table already present in comparison input. This corrects the evaluation narrative; it does not establish a successful displayed qualification, model answer or downstream analytical use.

No additional model capacity, local embedding model, external evaluation budget or remote provider activation is required by this patch. Applying the preview-service correction to a remote container remains a separate deployment action. The accepted corpus checkpoint, append-only analyst decisions and distinction between preparation and analytical evidence remain in force.
