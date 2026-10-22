# Evidence retrieval implementation and comparison

Date: 2026-10-21

## Result and activation status

**Interpretation correction, 2026-10-22:** exact-reference retention does not measure every useful equivalent passage. The original hybrid final inputs already include an equivalent Snowflake quarterly revenue table, and both modes include it in the repaired replay. See the [evidence and limits of this correction](2026-10-21-evidence-retrieval-repair.md#interpretation-correction-2026-10-22). Preserve the original scores below; they establish neither semantic answer accuracy nor a definitive retrieval winner.

**Subsequent diagnostic correction:** the 17/32 versus 12/32 result is a historical final-input recall measurement, not sufficient evidence of retrieval quality or a definitive technology choice. Read-only inspection of the actual persisted ranked rows found complete reference coverage before final selection in 27/32 lexical conditions and 25/32 hybrid conditions. Final selection loses 10 and 13 of those conditions respectively. Some historical query/reference pairs also need semantic adjudication, including the Nvidia survey query paired with a general accelerated-computing passage. The lexical preference is provisional. See the [follow-up diagnosis](2026-10-21-evidence-retrieval-diagnosis.md). Original measurements remain unchanged.

The original provisional recommendation was structured lexical retrieval using native Convex full-text search. The tested hybrid combines native lexical and Cloudflare BGE-M3 dense retrieval using equal-weight reciprocal rank fusion with constant 60. It failed the original final-selection gate, whose interpretation was subsequently withdrawn as described above. The [authorized repair report](2026-10-21-evidence-retrieval-repair.md) records current retention results and the limits of this comparison.

The implementation is integrated behind a new preparation snapshot and is ready for review. Live activation remains gated. `SOURCE_RETRIEVAL_MODE` is unset, the existing `SOURCE_QUALIFICATION_ENABLED` flag is unset, and model credentials are not configured in the running Convex deployment. Existing workflow activation and generative routing were not changed. The broader project goal remains paused. No commit, remote deployment, new subscription, Worker or local embedding model was created.

## Measured comparison

The experiment reused the existing 32 immutable public captures across four companies and the 16 historical controls. Each control was evaluated with its focused primary-document scope and with additional eligible primary documents as distractors. This produces 32 conditions, not 32 independent controls. Adobe was used for development. Nvidia, Snowflake and CrowdStrike were reserved for the subsequent comparison, but their historical appearance in prior investigation means this is not a blinded independent test.

Complete-evidence recall requires the full reference span set, including the table/date/unit context present in those spans, to survive the real comparison request preparer. The measurement imports and executes `prepareSourceComparisonInput`; it does not duplicate its selection rule. It is a retrieval measure, not model-answer accuracy or confirmation of the underlying public assertions.

| Company | Lexical complete reference sets | Hybrid complete reference sets |
| --- | ---: | ---: |
| Adobe | 6 / 8 | 2 / 8 |
| Nvidia | 3 / 8 | 2 / 8 |
| Snowflake | 4 / 8 | 4 / 8 |
| CrowdStrike | 4 / 8 | 4 / 8 |
| Total | 17 / 32 | 12 / 32 |

Lexical retained 19 of 34 required reference spans and hybrid retained 12. Neither arm introduced a quotation or offset provenance failure. Both arms completed their native backend evaluation with real embeddings available, without silently substituting lexical retrieval for the hybrid measurements. Hybrid failed the Adobe numeric and capability reference sets in the final selection envelope. The lexical method recovered the Adobe annual revenue table containing USD 23,769 million together with its table context.

Qualification input preparation was also checked against one frozen reference span per document. The historical preparation retained 24 of 32 anchors. Each new variant retained those same 24 and added the CrowdStrike annual-report anchor, reaching 25 of 32. This verifies input availability, not a new live qualification-model verdict. Seven anchors remain unavailable in the bounded selected inputs.

Additional lexical checks used eight explicitly synthetic variants, moving or rotating financial evidence in the existing captures. Adobe retained both required spans in both variants. CrowdStrike retained its reference in the reordered variant but lost it in the late variant. Nvidia and Snowflake did not recover their numeric reference in either variant; their original focused numeric cases were already misses. This demonstrates a remaining position/chunking sensitivity, not general robustness. A further real-backend lexical replay after runtime cleanup recovered the Adobe numeric evidence and context. No extra inference was used for these variants or the replay.

The recorded cached comparison-preparation median was about 437 ms for lexical and 1,395 ms for hybrid. These timings exclude embedding generation, source acquisition and generative analysis. They describe the tested execution, not an end-to-end latency guarantee. The hybrid implementation's bounded candidate pools and post-filtering can affect its recall; these results do not establish that hybrid retrieval is universally inferior.

The references are investigator-authored and were not independently adjudicated by a human. Missing a chosen reference can also miss an alternative relevant passage that this reference set does not recognize. Do not interpret these results as proof that dynamic-source selection is solved.

## Cost and provider evidence

The Cloudflare experiment used 4,264 distinct document/control-query texts and 15 qualification-role query texts. The complete run made 537 embedding inference calls: an initial smoke, one initial 32-text call, and 535 subsequent batches of at most eight texts. The latter comprise 533 document/control batches and two role-query batches, with at most two calls in flight.

The MCP truncates large result arrays at approximately 24,000 output characters. The first 32-text model response succeeded but its tool representation lost most vector coordinates, so it was excluded from indexing and its attempted input remained charged to the allowance. Subsequent responses packed each eight-vector batch as float16 only after checking exact equality against every original value. The reconstructed arrays passed the production vector validator for count, 1,024 dimensions, finite values and nonzero vectors. This transfer introduced no numeric quantization loss.

The corrected conservative input projection is **USD 0.051473712**, below the separately approved USD 0.10 ceiling. It uses one input token per submitted UTF-8 byte and a rounded tariff ceiling of USD 0.012 per million input tokens. This is an allowance estimate, not an invoice. Actual billed cost and remaining shared free allowance were unavailable. The original derived score allocated 48 bytes to the 50-byte initial smoke; the two-byte correction is recorded in the provider summary while the original score and reservation journal remain preserved. See [Cloudflare's official pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).

The selected lexical path issues no embedding request. Existing acquisition and generative-processing costs are separate and unchanged.

The MCP could invoke Workers AI. It could not inspect account token permission groups or mint an application token because the account-token endpoint returned 403 for missing scope. No Cloudflare application token was configured. Direct authenticated Convex-to-Cloudflare execution therefore remains unverified. Its HTTP transport, limits, cache, reservations and failure behavior were tested with only external I/O mocked. Real inference for this experiment ran through the Cloudflare MCP, and the resulting vectors were evaluated through actual native Convex indexes.

## Implementation boundaries

- `convex/domain/sourcePassages.ts` owns whole-capture structured units and bounded materialization. The legacy default remains unchanged. Exact quotations preserve source offsets. Small tables retain their caption, reporting columns and notes in a coherent quotation. Tables exceeding the 4,000-character quotation bound remain bounded units and can still lose distant context under the final selection envelope.
- `convex/domain/sourceRetrievalPolicy.ts` owns retrieval version, short-query construction, reciprocal rank fusion and retrieval metadata. Queries prioritize financial metric/period/basis terms over a long company introduction and never use the claimed financial number as a matching criterion. Both native and historical retrieval remain bounded and explicit about omissions.
- `convex/sourceRetrieval.ts` and `convex/sourceRetrievalActions.ts` own fenced derived indexes, retrieval and exact-text/profile cache attachment. `sourceSearchCaptures`, `sourceSearchPassages` and `sourceEmbeddingCache` are preparation artifacts, not approved analytical evidence. Cached vectors have one receipt-validated writer. Attaching them to a scoped native index passes IDs instead of copying dense vectors back through the caller.
- `convex/sourcePreparationActions.ts` routes new versioned qualification and comparison through the shared retrieval implementation. Eligible captured content is ranked before the final eight-capture limit. Authority remains a separate deterministic eligibility rule. Capture indexing receives and reports its actual read allowance, preserving the 32 MiB aggregate comparison read limit even when embeddings are incomplete.
- `convex/integrations/sourceEmbeddings.ts`, `convex/providerCalls.ts` and `convex/resourceLimits.ts` own the bounded optional provider path. The dossier allowance is cumulative across retries and revisions, uses a conservative 833,333-byte input ceiling, and never refunds an ambiguous result. The batch size, text bound, dimensions and price ceiling have shared owners. Two calls per dossier may be active. Missing configuration, service failure, partial indexing and exhausted allowance explicitly degrade to lexical retrieval.
- `convex/evidenceArtifacts.ts` and `convex/evidenceActions.ts` preserve the exact qualification references and adjacent context when an approved capture becomes analytical evidence. The mandatory set is validated again at the mutation boundary. Excessive or unavailable mandatory references fail explicitly. The durable approval checkpoint and accepted-decision fence remain required.
- `scripts/evaluations/source-selection/retrieval-study.ts` extends the existing study runner with selectable retrieval phases/modes. Reference construction, scoring and synthetic transformations have separate functions. Native ranking uses the real backend. Test fixtures are internal, loopback-only, gated by `E2E_FIXTURES_ENABLED`, and reuse admitted visitors without creating invitations.

Capture preparation is limited to the existing 16 MiB artifact bound, at most 100,000 parsed blocks and 20,000 searchable units. Pathological expansion is rejected explicitly before index writes, not truncated into a misleading complete prefix. The approved/materialized passage ceiling remains 512. These are prototype resource bounds, not claims of complete reading.

No generative model route, 600-character comparison explanation contract, public endpoint, workflow engine, visual layout or analyst-decision rule was replaced. New preparation fields are optional, existing completed preparations retain their identities, and no historical reindex or corpus migration ran.

## Verification record

The durable compact evidence is in [evidence-retrieval-20261021](evidence-retrieval-20261021/reference.json): [comparison metrics](evidence-retrieval-20261021/native-metrics.json), [qualification metrics](evidence-retrieval-20261021/qualification-metrics.json), [selection gate](evidence-retrieval-20261021/score.json), [synthetic reference](evidence-retrieval-20261021/perturbation-reference.json), [synthetic results](evidence-retrieval-20261021/perturbation-metrics.json), [provider summary](evidence-retrieval-20261021/provider-summary.json), [before-call reservations](evidence-retrieval-20261021/provider-journal.jsonl), [provider result receipts](evidence-retrieval-20261021/provider-results.jsonl), [initial smoke](evidence-retrieval-20261021/provider-smoke.json) and [runtime replay](evidence-retrieval-20261021/runtime-smoke.json). Full response vectors, raw execution logs, initial failed preflight and browser captures remain under `/tmp/evidence-retrieval-implementation-20261021`.

Observed RED/GREEN cycles cover late capture evidence, separated table context, native index idempotency, generation fencing, cumulative embedding allowance, explicit degradation, native-ranked qualification input, the ninth eligible capture, mandatory materialization, approved late evidence, pathological expansion and read allowances. A successful hybrid/cache characterization also verifies that repeated retrieval performs no extra embedding request. Default tests use deterministic external-boundary mocks and make no paid provider calls.

`pnpm check` passed design synchronization and client/backend typechecking, then stopped at the unchanged `src/components/workbench-shell/analyzed-company-list.tsx:114` index-key lint error. A separate whole-project format check also reported preexisting formatting differences. Those files were not rewritten to make the global check green. The initial full test execution had a timeout in the unchanged research-composer test while browser checks ran concurrently. That route file passed all 14 tests in isolation without changing its timeout. An isolated full run subsequently passed 1,121 tests. Later cache/read-allowance coverage and the final candidate were verified separately as recorded below.

Two implementation errors found during cleanup, a missing constant import and a malformed edit, were corrected before final validation. Their failed logs are preserved. The runtime directive is at the beginning of each Node action file. No failed run is represented as an acceptance run.

The protected browser gate uses real anonymous authentication and normal analyst admission, keyboard approval, immutable late evidence materialization into at most 512 passages, reload/reconnection, and both 1440×900 and 390×844 viewports. It verifies no raw retrieval configuration or backend names appear in the page. App page errors and console errors are checked. Google favicons for synthetic domains returned external 404s; following the repository's existing protected-browser practice, the gate aborts only that documented presentation dependency and correlates every resulting failed request. It does not fabricate evidence responses. Two cold load-event timeouts and the original external favicon errors remain recorded; their failure evidence was retained. The isolated favicon gate passed both viewports without raising timeouts or adding retries.

Final verification results are appended after the final candidate checks. Until the global baseline blockers and the existing preparation activation are resolved, this report does not authorize live activation or claim a completed live analytical workflow.


## Final candidate checks

- `pnpm typecheck`: passed for the client and Convex backend. Log: `/tmp/evidence-retrieval-implementation-20261021/release-typecheck.log`.
- `pnpm test`: 143 test files and 1,123 tests passed in 169.19 seconds. Existing jsdom navigation and scroll warnings remain visible. Log: `/tmp/evidence-retrieval-implementation-20261021/release-suite.log`.
- `pnpm build`: passed. The build reports plugin timing diagnostics. Log: `/tmp/evidence-retrieval-implementation-20261021/release-build.log`.
- `pnpm exec biome format` and `pnpm exec biome lint` on the 26 task TypeScript files: passed. The final accounting-only CLI edit was formatted and linted separately, followed by another successful `pnpm typecheck` and `node --experimental-strip-types scripts/check-imports.ts`.
- `pnpm exec playwright test --config playwright.retrieval.config.ts`: both protected desktop and mobile cases passed without retries. Log: `/tmp/evidence-retrieval-implementation-20261021/browser-isolated-favicons.log`. This verifies corpus approval, late-evidence materialization and reconnection with the documented external favicon isolation. It does not verify a new live generative research run.
- The final candidate generator and query builder produce exactly the same document metadata and cases as the measured frozen reference. A separate offline scoring replay verifies the corrected 50-byte smoke allowance and conservative USD 0.051473712 projection. This is an accounting check using preserved measurement rows, not a new ranking experiment. Original frozen references and derived results remain unchanged.
- `pnpm check` remains blocked by the preexisting index-key lint error described above. The final read-only `pnpm format:check` reports 20 preexisting formatting errors, all outside the task scope. The independent type, test and build runs above do not turn that global gate into a pass.
- SHA-256 comparison of all 1,656 preexisting files found no modified or missing file outside the explicit task allowlist. Existing unrelated work was preserved.

The temporary `E2E_FIXTURES_ENABLED` setting was removed from `local-aboul_panga-dd_proto` after runtime verification, restoring its initially absent state. The local Convex and Vite services remain running. Retrieval and source-qualification activation flags remain unset. Direct application authentication to Cloudflare remains unverified and is unnecessary for the selected lexical path. No commit or remote deployment was performed.

The next activation step is to resolve or explicitly accept the existing global-check blockers, then separately enable the existing preparation workflow with its authorized provider configuration and the selected lexical mode. This is outside the completed local implementation and comparison gate.
