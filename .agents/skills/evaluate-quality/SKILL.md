---
name: evaluate-quality
description: Prepare, run and interpret quality comparisons of models, evidence retrieval and source selection in this workbench, then archive retained experimental evidence. Use for comparative studies or investigation of recorded quality results.
---

# Evaluate Quality

Help decide which approach prepares sufficiently useful evidence at an acceptable cost. Keep the analyst's actual task, retained evidence and ability to continue the workflow ahead of benchmark scores. Use the existing evaluation runners and the archive command rather than building another evaluation framework.

## When to Use

Use when comparing model candidates, retrieval methods, source-selection policies or the production preparation pipeline, or when interpreting their recorded results. The skill can be selected automatically for those tasks or invoked as `$evaluate-quality`.

## When Not to Use

Ordinary unit tests, UI checks, security audits and performance investigations use their dedicated workflows. This skill does not authorize changing application routing, implementing a proposed correction, deploying, deleting evidence, publishing results or spending money.

Respect the requested mode. Inspection and planning remain read-only: propose the selection or use the archive preview instead of writing a snapshot. An authorized evaluation can retain its results within its agreed scope.

## Frame the Decision

A comparison is useful only if it answers the project's actual question. Read the [product evaluation contract](../../../PRODUCT.md#evaluation-and-demonstration), then consult the relevant [technical contracts](../../../context/TECH.md) and [runner instructions](../../../scripts/evaluations/source-selection/README.md). Product requirements remain in the product contract; this skill owns the evaluation procedure. Inspect the current implementation and available evidence before proposing a new study.

State the decision being informed, alternatives, evidence boundary and success criteria before inspecting new outputs. Reuse an existing protocol when it fits. Do not invent an acceptance threshold or treat a historical target, model, tariff or budget as permanent authority. Resolve material trade-offs with the user.

For a robustness claim, include different companies, source families and dossier needs, including supplied references, targeted questions, uncertain arguments and counter-evidence. A narrow diagnosis may remain narrow if its conclusions say so. Keep development cases distinct from held-out checks and report prior exposure. Prefer useful imperfect sources with visible restrictions to unjustified exclusion.

Use small deterministic fixtures to isolate policy rules. For analytical regression, define expected claims, contradictions and unresolved questions after manual corpus approval, reusing the approved showcase rather than creating a competing golden dossier. Preparation comparisons do not require several completed showcase dossiers.

## Prepare and Execute

Comparable conditions make differences interpretable. Freeze captures, input preparation, reference judgments, code identities, model routes and parameters before dispatch. Record who authored the references and any unresolved judgments. Use equivalent inputs for common comparisons; evaluate real production preparation separately and do not pool different conditions into one ranking.

Start with offline preparation, replay or scoring through the existing runners. Select candidates and tasks through their flags or catalogs, without editing scripts for each lot. Inspect the resulting manifest and cost envelope. Refresh official route availability and pricing before proposing live work. Reference labels and answer keys must not leak into provider inputs.

Before any paid inference or retrieval, require explicit authorization covering the exact lot, routes, maximum attempts and cost ceiling. Invocation of this skill does not supply that authorization. Respect existing runner gates; archived authorizations are historical records. Unknown external outcomes must not trigger blind retries. Do not alter provider configuration or run a live command merely to replace missing evidence.

## Interpret the Results

Separate source inclusion, exact-span retention, equivalent useful evidence, quotation validity, factual support and downstream analytical correctness. A JSON-valid response is not necessarily correct. A missing expected span does not prove useful evidence is absent, and a favorable match count does not establish workflow completion.

For each apparent miss, inspect equivalent evidence and whether later processing can actually reach it. Record source inclusion, displayed qualification and downstream correctness separately. Observed captures and investigator-reviewed replays do not establish fresh-discovery or unfamiliar-company robustness; design a separate check before making those claims.

Report unavailable, not-run, invalid, wrong and inconclusive results separately. Show meaningful errors and investigator disagreements alongside successful cases. Keep estimates, provider-reported charges and unknown-charge reservations distinct. Compare useful quality, latency and available cost without assuming a winner. Preserve failed attempts and original scores; corrected references or changed inputs create a separate version rather than rewriting history.

## Archive Retained Evidence

Results used in a conclusion need recoverable inputs. Before closing an experiment whose results are retained, identify its captures, protocols, references, catalogs, exact request manifests, response/error and cost journals, and actual relevant code snapshots. Include the report when present. Git HEAD alone does not identify uncommitted code, and current code cannot replace missing historical bytes. Resolve external replay inputs explicitly, including files under `/tmp`; a saved summary cannot replace them.

Use `pnpm evaluation:archive --help` for the command's options, storage layout and recovery instructions. Preview the explicit selection with `--dry-run`, then run the same selection without that flag. Keep secrets and runtime configuration out. The command owns copying, hashing, packing, restoration verification and publication; do not recreate those operations in the skill.

Link the report to the returned archive record. Report its verified status, included scope, missing inputs and local-only storage limitation. If an input is missing or verification fails, keep that failure visible and do not describe the experiment as fully archived or reproducible. Archiving proves byte preservation, not semantic correctness. Never remove originals as part of this workflow.
