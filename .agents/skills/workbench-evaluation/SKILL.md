---
name: workbench-evaluation
description: Evaluate models, evidence retrieval and source preparation in the Agentic Resilience Workbench to inform decisions about usefulness, cost and limitations. Use to interpret recorded results, diagnose lost evidence, or prepare and run bounded comparisons; preserve retained experimental evidence.
---

# Workbench Evaluation

Help decide which approach prepares sufficiently useful evidence at an acceptable cost. Keep the analyst's actual task, retained evidence and ability to continue the workflow ahead of benchmark scores. Use the existing evaluation runners and the archive command rather than building another evaluation framework.

## When to Use

Use when comparing model candidates, retrieval methods, source-selection policies or the production preparation pipeline, interpreting their recorded results, or diagnosing where useful evidence was lost. The skill can be selected automatically for those tasks or invoked as `$workbench-evaluation`.

## When Not to Use

Ordinary unit tests, UI checks, security audits and performance investigations use their dedicated workflows. This skill does not authorize changing application routing, implementing a proposed correction, deploying, deleting evidence, publishing results or spending money.

Respect the requested mode. Inspection and planning remain read-only: propose the selection or use the archive preview instead of writing a snapshot. An authorized evaluation can retain its results within its agreed scope.

## Choose the Required Investigation

An unclear result does not always require another experiment. Select the smallest investigation that can answer the user's question so existing evidence is used before new measurements consume time or money. Identify the requested outcome, inspect the relevant implementation and saved artifacts, then choose the appropriate path:

| Request | Procedure and stopping point |
| --- | --- |
| Interpret recorded results | Reconstruct the conditions and explain what the saved observations establish. Stop with a supported interpretation and visible unknowns; do not launch a new comparison merely because the record is incomplete. |
| Diagnose lost evidence | Follow the affected source or passage through the saved capture, selection, prepared input and accessible downstream material. Locate the first demonstrated loss, or identify the missing observation that prevents localization. Keep the diagnosis narrow unless evidence justifies expanding it. |
| Compare approaches | Define the decision and common conditions, then prepare the smallest informative comparison. Execute only within its authorization and stop at the agreed decision or evidence boundary. |

If the goal is ambiguous, inspect the product context and existing results first, then ask one focused question about the unresolved decision. Do not turn a request for better analyst results into a model benchmark by default. Interpretations and diagnoses use the relevant framing and interpretation steps below; preparation and execution apply only when a new measurement is needed and authorized.

## Frame the Decision

A comparison is useful only if it answers the project's actual question. Read the [product evaluation contract](../../../PRODUCT.md#evaluation-and-demonstration), then consult the relevant [technical contracts](../../../context/TECH.md) and [runner instructions](../../../scripts/evaluations/source-selection/README.md). Product requirements remain in the product contract; this skill owns the evaluation procedure. Inspect the current implementation and available evidence before proposing a new study.

State the question or decision, evidence boundary and success criteria before inspecting new outputs; identify alternatives when a comparison is needed. Reuse an existing protocol when it fits. Do not invent an acceptance threshold or treat a historical target, model, tariff or budget as permanent authority. Resolve material trade-offs with the user.

For a robustness claim, include different companies, source families and dossier needs, including supplied references, targeted questions, uncertain arguments and counter-evidence. A narrow diagnosis may remain narrow if its conclusions say so. Keep development cases distinct from held-out checks and report prior exposure. Prefer useful imperfect sources with visible restrictions to unjustified exclusion.

Use small deterministic fixtures to isolate policy rules. For analytical regression, define expected claims, contradictions and unresolved questions after manual corpus approval, reusing the approved showcase rather than creating a competing golden dossier. Preparation comparisons do not require several completed showcase dossiers.

## Define When to Stop

More measurements are useful only when they can change the decision. Before preparing a new batch, identify the observation that would justify choosing an approach, retaining the current one, or concluding that the available evidence is insufficient. This keeps the study tied to analyst usefulness rather than continued score improvement.

Use the existing success criteria and resource limits to define a bounded batch and its stopping condition. If no criterion is established, propose a concrete decision condition for the user's agreement rather than inventing a numerical target. A narrow diagnosis can stop at a demonstrated cause; it does not need a general winner.

Stop when the agreed question is answered, the authorized limit is reached, or another measurement cannot resolve the remaining uncertainty. If results are inconclusive, say so. Propose an additional batch only with the specific uncertainty it would resolve and the decision that could change. A small score difference alone does not justify expanding the study or replacing an adequate lower-cost approach.

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

Use `pnpm evaluation:archive --help` for the command's options, storage layout and recovery instructions. Preview the explicit selection with `--dry-run`, then run the same selection without that flag. Keep secrets and runtime configuration out. The command owns copying, hashing, packing, restoration verification and creation of the verified archive record; do not recreate those operations in the skill.

Link the report to the returned archive record. Report its verified status, included scope, missing inputs and local-only storage limitation. If an input is missing or verification fails, keep that failure visible and do not describe the experiment as fully archived or reproducible. Archiving proves byte preservation, not semantic correctness. Never remove originals as part of this workflow.

## Conclude with a Usable Decision

Scores and preserved files are inputs to a decision, not the final outcome. Give the user a conclusion they can act on so the investigation reduces uncertainty rather than merely adding measurements. For each investigation, cover the following points in proportion to its scope:

- What the evidence establishes and what it does not, with the relevant saved results or observed boundaries.
- What this means for the analyst's task: useful material retained or lost, work still required, and the meaningful quality, cost and latency trade-offs.
- What can be chosen now, or why no choice is supported. Label the recommendation separately from any decision already accepted by the user; retaining the current approach or leaving the question open are valid outcomes.
- What remains uncertain and the smallest next check, only if it could change the decision. Otherwise state that no further comparison is needed for the present question.
- For retained experiments, where the evidence is preserved and any missing inputs or verification limits.

Use plain language before technical scores and identifiers. A user asking which approach is useful should not need to reconstruct that answer from a benchmark table. Keep recommendations distinct from authorization to implement, change routing, deploy or spend.

## Maintain the Procedure

Evaluation guidance can preserve every artifact while still driving unnecessary experiments. Use the [read-only scenarios](evals/evals.json) to examine investigation selection, stopping conditions, decision clarity and scope boundaries after a substantive revision. Validate skill structure, local links and scenario fields mechanically; those checks do not demonstrate improved behavior. Run comparative evaluations only when requested and authorized, with an appropriate executor and equivalent configurations, and keep their outputs outside the application tree.
