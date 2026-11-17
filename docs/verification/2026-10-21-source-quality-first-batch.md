# First common-case source-quality comparison

> **Dated evidence.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

DeepSeek V4.1 Flash is the provisional first choice for the prototype's next evaluation. Both DeepSeek conditions retain all 28 substantive documents under the agreed usefulness proxy and match 14 of 16 frozen control dispositions. The 1017 condition has no observed advantage on those primary measures. This is a recommendation for further evaluation, not production activation or proof of grouped qualification quality.

## Scope and authority

The user authorized the first batch after selecting a progressive comparison: 64 common cases across five current candidates, at most 320 calls and USD 1.25 cumulatively. The user prefers retaining useful sources with reviewable limitations over avoidable exclusion. No zero-error gate applies. The second batch, broader paused implementation goal, application provider configuration, deployment and publication remain outside this authorization.

The 64 cases contain 32 document cases, 16 comparison controls, four historical ServiceNow regressions, eight numeric repeat/order sensitivity cases and four longer-context variants. They are not 64 independent new documents. The new-company corpus covers Adobe, NVIDIA, Snowflake and CrowdStrike. Every inference in this batch is a common decision task. No grouped production qualification or comparison was invoked.

## Results

| Candidate | Substantive documents retained / 28 | Control dispositions matching reference / 16 | Recorded cost for 64 calls, USD | Median call duration, seconds |
| --- | ---: | ---: | ---: | ---: |
| DeepSeek V4.1 Flash | 28 | 14 | 0.019904522 | 0.9240 |
| DeepSeek V4.1 Flash 1017 | 28 | 14 | 0.021017562 | 0.8840 |
| Jev 1.14.0 | 26 | 14 | 0.021494550 | 0.4245 |
| Microsoft Decision 1 | 27 | 10 | 0.016372692 | 0.6685 |
| GLM 5.3 Flash | 28 | 10 | 0.022272140 | 7.8845 |

"Retained" means the common usefulness answer is `useful` or `limited`. It does not mean that the application selected or accepted the source. All 28 non-index documents have known useful contributions in the investigator reference. Four index distractors are reported separately in the machine artifacts. Among all 32 document cases, 29 have an unambiguous positive usefulness reference, one has an unambiguous negative reference and two permit either limited or unestablished usefulness. On those 29 positives, the two DeepSeek conditions and GLM retain 29, Jev retains 27 and Microsoft retains 28.

The two DeepSeek conditions make the same two control-disposition mistakes: treating the full NVIDIA integration list as consistently established from partially overlapping primary evidence, and accepting the complete CrowdStrike ARR statement when the supplied passages do not establish acceleration for four consecutive quarters. These errors remain visible. Neither model is described as perfect.

Jev leaves useful content unestablished in the short NVIDIA annual and NVIDIA news cases. Microsoft leaves the CrowdStrike FalconPy integration document unestablished. The supplied target excerpts contain relevant contributions, although the inspected passage context is partial. Jev recognizes usefulness in the longer NVIDIA annual variant, showing that the result depends on supplied context. This does not establish downstream recovery in the real workflow.

GLM preserves the substantive documents, but matches fewer comparison dispositions and is slower in this configured condition. Microsoft is the cheapest observed candidate, with one substantive-document miss and six control-disposition disagreements. These are trade-offs, not automatic model-disqualification rules. Both native decision candidates remain viable for closed-choice work; this batch does not establish their ability to replace open-ended grouped qualification.

## Cost interpretation

The recorded cumulative cost is **USD 0.101061466052**, below the USD 1.25 authorization and the USD 1.24575903772 conservative reservation. USD 0.079566916052 is provider-reported; USD 0.02149455 for Jev is calculated from returned usage at the verified frozen tariff. There are no unknown-charge reservations. These records are not an independently reconciled provider invoice.

Observed totals include cache discounts. The two DeepSeek routes have identical input/output tariffs, and their 32 document cases cost almost exactly the same: USD 0.01167189 and USD 0.01167389. Base Flash received 45,824 cached input tokens across the batch versus 27,904 for 1017. The full-batch price difference therefore does not demonstrate an intrinsic model price advantage. GLM's 32 document cases cost USD 0.011000528892, but its comparison and sensitivity calls cost more in the observed run. A single per-token headline price does not determine the full task bill.

The candidate routes and reasoning settings are preserved: both DeepSeek versions through Relace with reasoning disabled and a 1,024-token completion cap, GLM through OpenInference FP4 with mandatory reasoning requested at low effort and an 8,192-token total completion cap, Jev through TypeSafe, and Microsoft through OpenRouter native decisions. This is a comparison of these configured conditions, not identical reasoning or provider conditions.

## Separate diagnostics

All 320 calls returned usable responses. There were no automatic retries or provider fallbacks. All four long-input variants remained useful under every candidate.

Base Flash preserves all answers in all eight numeric sensitivity variants. The 1017 condition preserves all eight dispositions and seven complete answer sets. Jev and Microsoft preserve all eight dispositions and six complete answer sets. GLM preserves six of eight dispositions; its NVIDIA numeric repeat and reordered variants move from unsupported agreement to inconclusive. These repeated cases are not additional independent quality examples.

Historical ServiceNow regression judgments match the frozen reference in 12/12 cases for base Flash and GLM and 11/12 for the other three conditions. These diagnostics do not replace the new-company results.

Exact document-purpose matches are 26/32 for each DeepSeek condition, 29/32 for Jev, 24/32 for Microsoft and 23/32 for GLM. These remain strict machine diagnostics. Product versus integration documentation and index versus substantive-page classification require contextual review before being treated as operational failures.

## Review limitations

The reference is investigator-authored, not independently human-adjudicated. All 32 document company labels are `subject`, and the set has only one unambiguous usefulness-negative document. It cannot establish general company discrimination or selection precision. Investigator-selected excerpts and primary passages do not measure live discovery or full-document retrieval recall.

Focused review covers all 160 document-usefulness answers and all 80 control dispositions, using supplied target excerpts and frozen passage-backed rationales. Initial pattern inspection omitted model labels, although ordering and prior behavior could still reveal identities. Six allowed unestablished index answers were documented in an addendum after model identities were inspected. Full citation, purpose, nature and period adjudication was not performed. Known Snowflake applicability ambiguity remains excluded from ranking. The frozen reference was not edited. Auxiliary reference disagreements are not converted automatically into model-rejection decisions.

The batch does not measure analyst correction time, approved-corpus quality, later extraction, actual source-recommendation recall or operational error prevalence. Both DeepSeek conditions are reasonable candidates for a separately authorized grouped-task comparison. No second batch has been sent.

## Runner repair and validation

The existing planner gives ordinary common cases a 24 KiB limit and long cases a 128 KiB limit. Model selection incorrectly reapplied the ordinary limit to every generative case. The repair uses the existing long-case limit in both planning and selected-model validation, with one shared constant. It preserves source bytes, questions, expected answers, ordinary limits and model settings.

Only these existing task files were changed:

- `scripts/evaluations/source-selection/source-quality-study.ts`
- `scripts/evaluations/source-selection/study-cli.ts`
- `src/__tests__/benchmarks/source-quality-study.test.ts`

The regression test first failed with `Selected model input exceeds the frozen common-input cap`. After repair, all 25 focused benchmark tests passed. Scoped Biome checks on all three changed files and `scripts/check-imports.ts` passed. Client and Convex TypeScript checks passed through `pnpm check`.

The global check remains blocked by the existing unrelated `lint/suspicious/noArrayIndexKey` error at `src/components/workbench-shell/analyzed-company-list.tsx:114`. Consequently the global format check, complete test suite and build were not reached. No browser gate was run because no application surface changed.

Verification commands used the installed pnpm 10.20.0 through the existing local shim, without dependency installation:

```sh
PATH="/tmp/source-quality-comparison-20261020/bin:$PATH" pnpm test src/__tests__/benchmarks/source-quality-study.test.ts -t "preserves long-case context"
PATH="/tmp/source-quality-comparison-20261020/bin:$PATH" pnpm test src/__tests__/benchmarks/source-quality-study.test.ts
PATH="/tmp/source-quality-comparison-20261020/bin:$PATH" pnpm exec biome check scripts/evaluations/source-selection/source-quality-study.ts scripts/evaluations/source-selection/study-cli.ts src/__tests__/benchmarks/source-quality-study.test.ts
node --experimental-strip-types scripts/check-imports.ts
PATH="/tmp/source-quality-comparison-20261020/bin:$PATH" pnpm check
```

The first live command was rejected before process creation because automatic approval questioned payload privacy and destination scope. A local provenance check then verified the 320 exact request bodies, public-source provenance, existing two destination hosts and absence of configured credential values in request bodies. The same command subsequently ran after the user continued the session. The rejected attempt created no provider call or journal entry. No credential values were logged.

## Reproducible evidence

All paths below are relative to `scripts/evaluations/source-selection/fixtures/cross-company-20261020/`:

- `evidence/batch1-20261020/catalog.json` and adjacent official metadata snapshots record fresh route/tariff verification.
- `evidence/batch1-20261020/cases.json` selects the 64 frozen common cases.
- `runs/batch1-common-20261020/manifest.json` binds the 320 requests, inputs, code and cost reservation.
- `runs/batch1-common-20261020/authorization.json` limits this exact manifest to 320 attempts and USD 1.25. Its attempt allowance is exhausted.
- `runs/batch1-common-20261020/payload-provenance.json` records destinations, public-source URLs, hashes and the credential-body check.
- `runs/batch1-common-20261020/investigator-review-plan.json` and `reference-scope-note.json` record criteria and reference limitations before semantic answer inspection.
- `runs/batch1-common-20261020/calls.jsonl` contains all starts, responses and terminal results.
- `runs/batch1-common-20261020/final-results.json`, its blind review and review key preserve unadjusted machine results.
- `runs/batch1-common-20261020/investigator-review.json` and its addendum document focused review and its limits.
- `runs/batch1-common-20261020/reviewed-summary.json` and `final-proof.json` record the final comparison and integrity checks.

The manifest SHA-256 is `b9abe4dc7f708a539e81bf951535f286b9487de52236bb61272e39e4fb95e46b`. The final journal SHA-256 is `4842ed9f3b71d3a93290a84a620761065a070e608686dfe47ba4c02366f8ebea`. Offline verification confirms 320 unique starts, 320 responses, 320 terminal results, no unresolved calls, unchanged code fingerprints, unchanged reference/protocol and zero application writes.
