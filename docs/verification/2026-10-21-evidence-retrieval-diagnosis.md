# Evidence retrieval diagnosis after implementation

> **Dated evidence.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

Date: 2026-10-21

**Interpretation correction, 2026-10-22:** the stage counts below track the frozen reference spans. An equivalent Snowflake quarterly revenue table was present in the original hybrid final inputs and is present in both modes after the retention repair. See the [capture offsets, hash and interpretation limits](2026-10-21-evidence-retrieval-repair.md#interpretation-correction-2026-10-22). The absence of the chosen reference does not establish loss of the useful evidence or a query defect. Runtime observations below describe the dated diagnostic, not a fresh activation check.

## Verified current state

The existing local backend on port 3210 and frontend on port 3000 are listening. The deployment environment names contain neither SOURCE_QUALIFICATION_ENABLED nor SOURCE_RETRIEVAL_MODE. The retrieval change remains inactive for ordinary preparations. This inspection does not establish an end-to-end live workflow regression or prove that the active user journey works. No provider call, deployment, production code edit or environment mutation was made for this diagnosis.

## Where the measured evidence is lost

The diagnostic joined the 64 saved ranking results to 1,142 actual persisted sourceSearchPassages rows through read-only Convex queries. Exact UTF-16 capture offsets were compared with the same frozen references and source text. Complete coverage permits whitespace gaps, matching the original final-selection scoring rule. No synthetic ranker replaced native results.

| Retrieval mode | Complete references among returned candidates | Complete references in final input | Lost during final preparation |
| --- | ---: | ---: | ---: |
| Lexical | 27 / 32 | 17 / 32 | 10 |
| Hybrid | 25 / 32 | 12 / 32 | 13 |

The production preparer selects six primary passages per finding and up to two preceding context passages for the first structured anchor, within a shared 64-passage and 128-KiB envelope. For example, the Nvidia forecast reference is ninth in lexical candidates, the CrowdStrike unresolved reference is seventh, and Adobe numeric references are tenth and eleventh in hybrid candidates. These references are retrieved and then omitted from the final input. Some selected structured units also overlap or are fully contained within another selected unit, consuming a scarce slot without adding evidence.

The two Snowflake controls called numeric and forecast lack their complete expected reference spans within either returned candidate set. Retaining more final passages cannot recover those particular spans, but the numeric case has equivalent evidence elsewhere in the supplied content, as the subsequent correction establishes. The numeric query is only “revenue billion”, without a reporting period. The forecast query is a truncated narrative prefix. These observations identify investigation targets, not proof of a query defect or an adjudication that the expected reference is the uniquely correct answer.

## Evaluation validity

The historical Nvidia numeric query asks about survey respondents and the importance of networks, while its required passage describes the accelerated-computing platform. That pairing is not a sound unreviewed positive retrieval target. Other contextual or unresolved controls may require explicit no-comparable-evidence treatment rather than mandatory retrieval of a loosely related passage. An analyst-authored independent reference adjudication has not been completed.

Four of the five net final-score points separating the methods occur on Adobe, which was used for development. On the other three companies the scores are 11/24 lexical and 10/24 hybrid. These historical results support neither general lexical superiority nor rejection of embeddings.

## Repair direction and boundaries

First adjudicate the 16 underlying query/reference pairs, including expected absence of comparable evidence, and retain this historical dataset unchanged. Then measure candidate availability separately from final-context retention. Correct redundant slot use and evaluate a less destructive selection policy under an explicit serialized-input budget, using the existing native rankings and captures. A larger context can increase later generative input cost even if no embedding call is added, so measure bytes and retained evidence together before activation. Queries that omit available metric or period information require a separate verified repair.

A changed selection policy must be exercised through the real production preparer, with focused regression tests, and then through the protected preparation/approval path. Passing unit tests and a production build alone do not establish useful live retrieval. Unrelated existing formatting errors are not a demonstrated cause of the recall losses described here. Current activation restrictions remain governed by ADR-025 until deliberately revised.

Raw read-only row projections and condition-level stage results are preserved in /tmp/evidence-retrieval-repair-20261021/ranked-rows.json and stage-audit.json. This diagnosis withdraws the definitive interpretation of the prior technology winner while preserving its raw measurements.
