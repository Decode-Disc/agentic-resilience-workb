# Source-quality evaluation tools

This README documents the evaluation runners and their files. Product outcomes belong in [PRODUCT.md](../../../PRODUCT.md#evaluation-and-demonstration); the project skill [$workbench-evaluation](../../../.agents/skills/workbench-evaluation/SKILL.md) guides protocol design, interpretation and evidence preservation. Results and historical settings belong in the reports linked below. These tools do not select an application model or approve sources.

Run commands from the repository root using its installed Node, pnpm and dependencies. Examples use placeholder paths that must be replaced with existing study inputs.

## Inputs and model selection

A study identifies captured documents, tasks and references. Its catalog owns candidate identifiers, provider routes, tariff snapshots and supported reasoning/output settings. Select candidates through `--models ID_A,ID_B` or `--models all`; do not edit TypeScript for each subset. Unknown, empty and duplicate identifiers are rejected. Historical protocol files and runs remain unchanged when a catalog is revised.

```sh
quality_runner=scripts/evaluations/source-selection/compare.ts
quality_study=path/to/study.json
quality_catalog=path/to/catalog.json
quality_cases=path/to/cases.json

# List catalog candidates without loading a study or calling a provider.
node --experimental-strip-types "$quality_runner" --catalog "$quality_catalog" --list-models

# Freeze a common-case comparison without sending inference.
node --experimental-strip-types "$quality_runner" --study "$quality_study" --catalog "$quality_catalog" --cases "$quality_cases" --models all --prepare --run common-example
```

Common comparisons require explicit `--cases`. Each selected subset produces an exact manifest, request hashes, attempt ceiling and cost envelope. The configured output cap applies to both the request and its reservation, including reasoning tokens. Model identifiers and tariff snapshots are experiment inputs, not application routing defaults or current market quotations.

## Grouped production tasks

`qualify.ts` and `check-source-comparison.ts` exercise the real qualification/comparison preparation and adapters. Select `--tasks qualification`, `--tasks comparison` or `--tasks qualification,comparison` with `--models`. Do not combine grouped selection with `--cases` or historical `--replacements`; native decision models are unsupported for grouped extraction.

```sh
quality_generative_models=ID_A,ID_B
node --experimental-strip-types scripts/evaluations/source-selection/qualify.ts --study "$quality_study" --catalog "$quality_catalog" --models "$quality_generative_models" --tasks qualification,comparison --prepare --run grouped-example
```

For grouped tasks, select only supported generative candidates from the catalog. Both entrypoints prepare the same manifest for the same selection; each live invocation dispatches only its own task and phase. Prepared request hashes bind the captured SDK body and configured transport/output settings. Changed code or inputs cannot silently resume a historical run.

## Execution and saved results

Live dispatch requires the prepared manifest, `--live --authorization PATH`, a fresh `--preflight-catalog PATH`, and an explicit `--phase development`, `holdout` or `regression`. The runner verifies the exact manifest grant, selected attempts and budget before dispatch. Complete development across all selected entrypoints before holdout. Credentials use existing secure configuration channels, never command arguments or reports. Unknown external outcomes block blind repetition; a historical authorization cannot be reused for changed code, inputs or routes.

Use `--summarize --report NEW_NAME.json` with the same study/catalog/selection arguments to score saved responses without provider calls. Reports are append-only. A run's `manifest.json` binds inputs and requests; `calls.jsonl` records actual starts and terminal responses/errors, latency and available cost; reports retain unavailable and invalid observations. Existing legacy default commands and their historical limits are preserved in [the original experiment report](REPORT.md#historical-runner-usage-preserved-on-2026-10-22) and [grouped qualification record](QUALIFICATION-EVALUATION.md).

The catalog collection utility makes public metadata GETs only: `node --experimental-strip-types scripts/evaluations/source-selection/catalog.ts OUTPUT.json`. The model catalog includes a separate native-decisions query; its frozen output is not authorization for inference.

## Native preparation concurrency study

`preparation-study.ts` runs the production durable Workflow on local, owned evaluation dossiers. Prepare from the retained 24-source checkpoint with `--prepare --snapshot /path/to/after.json --captures /path/to/captures --out /path/to/new-study`. Preparation freezes captures, qualification results, application code, configured routes and a fresh official provider catalog; it performs no inference.

Run `--offline --out /path/to/new-study --slot ADMITTED_SLOT` to compare queued controls at two with inline controls at two and four on the same 23 cached whole-document qualifications. The retrieved-selection capture remains in the paid corpus; the offline runner did not reproduce its native retrieval-aware request hash. The subsequent live lot matched all 24 primary qualification input hashes across cloned dossiers. Add `--stress` for a 60-source replay. Replays import explicitly precomputed qualifications with zero model allowance: cache misses remain blocked and never authorize inference. Local timings measure coordination and cached reading, not live model latency.

The paid lot is two 24-source qualifications plus two comparisons using the same frozen qualifications, with at most 128 dispatched attempts in total. `--live --out /path/to/new-study --slot ADMITTED_SLOT --authorization /path/to/grant.json` validates the exact manifest grant through the existing study approval gate and refreshes official routes/prices before loading the local administrator credential. The grant template requires an explicit approval timestamp; it is not authorization. Each native dossier retains production reservations, cancellation/generation fences, bounded fallback and the fifteen-minute window. A started paid lot cannot be rerun automatically. No new discovery or acquisition is measured, and two conditions do not establish general robustness.

Both execution modes require the identified running loopback backend and `E2E_FIXTURES_ENABLED=true`; remove the flag after execution and verify removal. The admitted visitor's production analysis quota is not restored or consumed by these explicitly labelled evaluation reservations. The runner polls bounded preparation status and saves the full native journal, normalized task outputs and provider-attempt telemetry once per completed condition. Archive the complete study directory with `evaluation:archive`; archived authorizations cannot authorize another lot.

## Saved retrieval replay

`check-source-comparison.ts --retrieval-phase replay` reads saved native rankings and captures through the current production preparer. It makes no new ranking, search, embedding or model request and writes a new report. Other retrieval phases may access or mutate the local backend.

```sh
node --experimental-strip-types scripts/evaluations/source-selection/check-source-comparison.ts \
  --study "$quality_study" --retrieval-phase replay \
  --run-dir /path/to/retained-retrieval-inputs \
  --ranked-rows /path/to/ranked-rows.json \
  --reference-review /path/to/reviewed-reference.json \
  --retrieval-mode both --report-file /path/to/new-replay-report.json
```

The retained run directory must contain matching `freeze.json`, `native-state.json` and `native-results.jsonl`; summaries cannot replace them. Options include `--retrieval-mode lexical|hybrid|both`, `--company` matching a study company and `--context-bytes`. Existing output files are refused. A replay records the current preparer's hash and is a new measurement when code changes. The [retrieval report](../../../docs/verification/2026-10-21-evidence-retrieval.md) records the original input locations and their limitations.

## Local artifacts and restoration

Git ignores directories named `runs/` and `captures/` anywhere under `scripts/evaluations/`. Keep code, deterministic test fixtures, protocols, catalogs, references and compact reports outside those reserved directories. An explicit output path elsewhere is not covered automatically. Ignored local files remain available to the runners, but a fresh clone needs the retained inputs restored before historical checks.

The [retained snapshot record](fixtures/cross-company-20261020/README.md#retained-artifact-snapshot-2026-10-22) documents the existing manual archive, its checksum inventory and restoration. It does not include every external replay input. Missing evidence must not be silently regenerated with live calls under an old authorization.

## Archive a retained experiment

Use `pnpm evaluation:archive --help` for options, an example, storage paths and checksum/recovery instructions. The command creates a new verified snapshot of explicitly selected files without removing originals. The skill guides which evidence to retain; byte copying, hashing and restoration verification belong to the command.

## Cross-company model selection

The [frozen cross-company fixture](fixtures/cross-company-20261020/README.md) records its corpus, references and catalog provenance. Use the generic selection commands above with those inputs. Recorded provider/model profiles and reasoning differences belong in the [screening report](../../../docs/verification/2026-10-20-glm53-source-quality-screen.md#catalog-configuration-recorded-on-2026-10-22).

## Recorded evaluation state, 2026-10-22

These are dated observations, not current execution grants or application activation:

- [Original ServiceNow comparison](REPORT.md) and [grouped qualification](QUALIFICATION-EVALUATION.md).
- [Cross-company preparation](../../../docs/verification/2026-10-20-cross-company-source-quality-preparation.md), [common-case batch](../../../docs/verification/2026-10-21-source-quality-first-batch.md) and [grouped batch](../../../docs/verification/2026-10-21-source-quality-second-batch.md).
- [Retrieval interpretation correction](../../../docs/verification/2026-10-21-evidence-retrieval-repair.md#interpretation-correction-2026-10-22) and [source utility](../../../docs/verification/2026-10-21-source-utility.md).

The [roadmap](../../../docs/ROADMAP.md) owns delivery state and remaining acceptance work.
