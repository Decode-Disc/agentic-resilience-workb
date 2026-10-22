# Cross-company source comparison: initial live screen

> **Dated evidence.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

Date: 2026-10-20. Scope: 20 authorized inference attempts, four common cases, five models. All 20 completed with schema-valid answers. No model has been accepted for production or integrated.

## Conclusion

This screen does not justify replacing the current source-selection approach with a native decision model, or accepting the current generative models as robust. Jev supplies the expected central disposition on all four selected cases, but fails to select the directly relevant Adobe and Snowflake citation and classifies the NVIDIA prospective argument as an asserted fact. DeepSeek cites the relevant supplied passages and avoids unsafe agreement here, but misses a directly supplied Adobe numerical conflict. MiMo and Microsoft agree too readily with a compound CrowdStrike statement whose complete premise is unsupported. Microsoft also misses the Adobe conflict by reporting no conflict. Luna detects the Adobe conflict but marks its period as different and omits the relevant citation.

The useful result is a set of distinct observed weaknesses, not a general model ranking. Native decision responses and valid probabilities did not guarantee reliable citations or period alignment. Generative JSON validity did not guarantee conflict detection. Jev remains an interesting candidate for bounded triage, not an approved final evidence authority. No model change should follow from these four cases alone.

## Authorization and execution

The user authorized running the discussed initial screen after its 20-call, USD 0.10 ceiling was proposed. DeepSeek V4.1 Flash 1017 was explicitly left unused. The 416-call lot remains unapproved and unexecuted. The original implementation goal remains paused. No provider route, production configuration, database, or application state was changed. No existing service was restarted, no agent was spawned, and no commit, deployment, or publication occurred.

The subset contains `control:adobe-numeric`, `control:nvidia-forecast`, `control:snowflake-capability`, and `control:crowdstrike-numeric`, each queried once on the original five models. Five development calls completed before the fifteen held-out calls. No automatic retries or fallback providers were used. Preparation compared all wire inputs against the pre-inference input contract before selecting this subset.

The exact subset manifest identifier is `0b8e5ed63eed3dd95e610158b6bb0775691db72ad7ab7e57a977622722909168`. Its independent authorization limits the run to 20 attempts and USD 0.10. Its conservative reservation was USD 0.081047872. Current public official catalog checks confirmed the selected routes and rates before dispatch. The frozen corpus, common instructions, reference judgments, and request bodies were not tuned after any of these responses.

The recorded total is **USD 0.0046848582**, approximately **0.47 US cents**. Sixteen results use provider-reported cost. Four direct Jev results use reported input-token usage multiplied by the freshly verified USD 0.042/M tariff. This is provider/usage accounting, not an independently reconciled invoice. There are 20 distinct started records, 20 terminal successful results, and zero unresolved outcomes in the journal. The run is complete. The authorization is exhausted and does not permit another 20 calls.

## Central dispositions

| Model | Adobe numerical discrepancy | NVIDIA prospective mechanism | Snowflake architecture | CrowdStrike compound claim |
| --- | --- | --- | --- | --- |
| DeepSeek V4 Flash 0731 | Inconclusive | Inconclusive | Inconclusive | Inconclusive |
| MiMo V2.6 Flash | Inconclusive | Inconclusive | No conflict observed | No conflict observed |
| Jev 1.14.0 | Possible conflict | Inconclusive | No conflict observed | Inconclusive |
| Microsoft Decision 1 | No conflict observed | Inconclusive | No conflict observed | No conflict observed |
| GPT-6 Luna Decisions | Possible conflict | Inconclusive | Inconclusive | Inconclusive |

Adobe: the captured external article states approximately USD 22.5–23 billion for realized FY2025 revenue. The supplied annual-report table gives USD 23,769 million for the same fiscal year. This warrants a possible numerical-conflict flag. It does not disprove the article's entire business thesis. DeepSeek and MiMo abstain instead. Jev detects the conflict but answers `none` for its citation. Microsoft reports no conflict and no citation. Luna detects a conflict, but selects a period mismatch despite the explicit FY2025 comparison and answers `none` for citation.

NVIDIA: the statement that an optimized system will typically reduce deployment complexity while increasing long-term switching costs is an author's prospective causal argument. The supplied product-transition and risk passages do not establish that outcome. All five central dispositions are inconclusive. Jev and Microsoft classify the statement as an asserted fact, which is a weaker separation of prospective argument from existing condition. Microsoft additionally selects an indirect passage for the citation. Because the common task's category labels are terse, nature-label differences are weaker evidence than a missed numeric conflict or unsupported agreement.

Snowflake: the product excerpt describes public-cloud compute and storage. The supplied annual report contains a directly matching storage/compute/cloud architecture. MiMo, Jev, and Microsoft report no observed conflict. DeepSeek and Luna abstain. All five say temporal applicability is not established, while the frozen reference expects aligned. The product excerpt is undated, so that frozen period expectation is too strong. It is preserved transparently and is not used to rank models. Conservative abstention here is not classified as unsafe agreement. Jev, Microsoft, and Luna do not select the matching supplied citation. A duplicate equivalent passage at `e5` was recorded as acceptable before inspecting model answers, but no model selected it.

CrowdStrike: the supplied primary table supports rounded ARR of USD 5.84 billion and 25% year-on-year growth. It does not establish acceleration for four consecutive quarters. The complete compound contribution therefore remains inconclusive. DeepSeek, Jev, and Luna maintain that uncertainty. MiMo and Microsoft report no conflict, overlooking the missing premise. All five select the relevant ARR passage. A matching number alone is insufficient to certify the whole contribution.

## Reference and review limits

The pre-inference reference was authored by the investigating assistant, not independently adjudicated by humans. Raw machine scores remain unchanged in `final-results.json`. They should not be presented as an overall accuracy ranking. In particular, all five Snowflake period disagreements expose an overstrong reference expectation. Adobe nature-label distinctions also overlap in the terse common criteria. Individual observations, including these reference weaknesses, are recorded in `investigator-review.json` rather than silently relabelling the frozen reference or requesting replacement answers.

Model identifiers were omitted for the first semantic inspection. Fixed model ordering remained predictable, so this was neither independent nor fully blinded review. No chain-of-thought or explanation was requested, and this report does not infer why a model chose an answer.

There are only four selected cases, including one development case and three held-out cases. They test different phenomena and are not a random sample of operational traffic. Common inputs include investigator-selected primary evidence. This screen does not test source discovery, retrieval recall, dynamic-source changes over time, document qualification, open-ended contribution extraction, or the grouped production pipeline. It neither establishes general robustness beyond ServiceNow nor proves a model family intrinsically better. The original robustness concern therefore remains unresolved, while concrete out-of-ServiceNow failure examples are now available.

## Cost and latency observations

| Model | Recorded USD, four requests | Median seconds, four requests |
| --- | ---: | ---: |
| DeepSeek V4 Flash 0731 | 0.0002945820 | 1.2515 |
| MiMo V2.6 Flash | 0.0015613402 | 1.2290 |
| Jev 1.14.0 | 0.0007504560 | 0.4560 |
| Microsoft Decision 1 | 0.0006001800 | 0.8855 |
| GPT-6 Luna Decisions | 0.0014783000 | 0.3260 |

These are four samples per model and do not establish throughput or a stable latency ranking. Keep cost, availability, citation behavior, and central semantic errors separate.

## Artifacts and verification

The run artifacts are under `scripts/evaluations/source-selection/fixtures/cross-company-20261020/runs/screen-20261020/`: `manifest.json`, `authorization.json`, `calls.jsonl`, `final-results.json`, its separate review files, `investigator-review-plan.json`, `investigator-review.json`, and `reviewed-summary.json`. The official tariff/route snapshots are in the fixture's `evidence/screen-20261020-preflight/`. An earlier `results.json` summary may reflect the intermediate run and is superseded for interpretation by the completed `final-results.json`; no historical evidence was deleted.

A minimal `--cases` option was added to the existing study CLI, rather than creating another inference runner. The new regression test failed on the previously rejected option, then passed with the subset manifest and an exact 20-attempt approval ceiling. A grant for 416 attempts is rejected for this selected 20-call manifest. Nineteen study tests pass, as does the client/scripts TypeScript check. The two changed files were formatted and checked with Biome. Production transports and request bodies were not changed. Existing full-project lint failure and earlier validation limits remain as documented in the offline-preparation report. No additional full build or browser gate was run for this evaluation-only extension.

The dispatch console's `actualAttempts` field reflects its pre-dispatch snapshot. Completed attempt totals in this report are taken from the durable journal and final offline report. This telemetry limitation does not alter the fixed queue, authorization ceiling, or pre-I/O reservation checks, but those dispatch console counters should not be read as final totals.

No further paid inference is authorized by this report. A later comparison can investigate the observed weaknesses, but needs a separately bounded scope and spending authorization. No integration decision has been made.
