# Provider configuration observations

The first five-call probe is preserved under `runs/2026-10-20/`. Jev 1.13, Jev 1.14, Microsoft Decision 1 and DeepSeek returned valid choices. GLM returned HTTP 400 stating that reasoning was mandatory and could not be disabled. This is an observed configuration failure, not a wrong classification.

The main run, `2026-10-20-supported-config`, changes only GLM's inference configuration to `reasoning: { effort: "low", exclude: true }`. The 1,024-token output cap, dataset, questions and reference judgments remain unchanged. DeepSeek still uses reasoning disabled. The comparison therefore evaluates these usable configurations, not equal reasoning modes. Internal reasoning text is excluded from GLM responses.

The original runner bytes are archived as `runs/2026-10-20/runner.ts.snapshot` solely to substantiate the old manifest's hash. This is historical evidence, not a second maintained implementation. New runs use `compare.ts`.

The five-call probe's conservative cost reservation is carried into the main run with `--prior-run 2026-10-20`, along with its five attempts. The four successful smoke calls are intentionally repeated in the complete run so that the complete dataset has one consistent runner and manifest. This consumes five extra attempts in total, within the 220-attempt ceiling. The original failed response is retained and reported separately.

```sh
node --experimental-strip-types scripts/evaluations/source-selection/compare.ts --live --run 2026-10-20-supported-config --prior-run 2026-10-20
node --experimental-strip-types scripts/evaluations/source-selection/compare.ts --summarize --run 2026-10-20-supported-config
```

The OpenRouter model catalog lists supported parameter names, but that alone did not establish that every model accepts reasoning disabled. The recorded refusal is the decision-critical evidence for this adjustment.

After the main run completed, the offline scoring command was strengthened to reject a changed reference or dataset. A temporary manifest with an incorrect reference hash succeeded before that correction and failed afterward. The real reference was never changed. The main run's original runner bytes were also archived as `runner.ts.snapshot`; future live evaluations use the current runner and a new run name. Formatting-only changes to saved summaries do not alter recorded responses or input hashes.
