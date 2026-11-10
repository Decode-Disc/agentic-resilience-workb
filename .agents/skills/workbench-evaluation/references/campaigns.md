# Qualification Campaign Commands and Manifests

Use this reference when preparing a campaign, selecting a configuration or recovering an interrupted lot. The [evaluation workflow](../SKILL.md#prepare-and-execute) owns the procedure and judgment; the [technical qualification contract](../../../../context/TECH.md#access-resources-and-security) owns campaign enforcement. These commands operate on the same absolute evidence directory outside the checkout.

## Commands

Run `pnpm workbench:qualify --help` to inspect current options. Preparation retains a reviewable mandate; authorization records the user's explicit approval of that mandate.

```sh
pnpm workbench:qualify --campaign prepare --manifest /absolute/mandate.json --output /absolute/evidence-directory
pnpm workbench:qualify --campaign authorize --output /absolute/evidence-directory
pnpm workbench:qualify --campaign run --output /absolute/evidence-directory
pnpm workbench:qualify --campaign status --output /absolute/evidence-directory
pnpm workbench:qualify --campaign assess --output /absolute/evidence-directory --review /absolute/review.json
pnpm workbench:qualify --campaign close --output /absolute/evidence-directory
```

`run --configuration ID` selects a declared profile; omission selects the next unqualified profile on the current candidate. `run --correction "description of the authorized correction"` identifies a correction within the mandate. One lot runs one configuration across the declared scenarios. Version 3 then invokes its authorized automated reviewer and submits the validated assessment after reconciliation; version-1/2 lots await manual assessment. All required profiles must pass on the same candidate; a correction resets coverage without replacing historical results.

After interruption, inspect `status`, retained review artifacts and analysis attempts before choosing a continuation. Recovery cleans up and reconciles the existing lot without replaying uncertain scenario effects or opening a replacement lot. It can still dispatch authorized reviewer requests when no completed result exists. Preserve rejected evidence and inspect diagnostics if assessment or cleanup fails; do not regenerate an evidence index manually to make assessment pass. See [Recovery and Closure](#recovery-and-closure) before invoking `run` or `close` again.

## Execution Surface

For a targeted correction loop, prepare a version-2 or version-3 manifest with explicit `scenarios`; omitted `executionSurface` is resolved and retained as `"backend"`. Keep `mode: "live"` for real workflow providers or `"deterministic"` for deterministic workflow mechanics; execution surface and workflow provider mode are independent. Version-3 reviewer inference is separately authorized: a real reviewer can examine deterministic workflow evidence, so deterministic workflow mode does not mean the entire campaign makes zero provider calls. The backend surface requires only the verified local backend and uses real anonymous authentication and public access-code admission. It retains the production operations, agents, budgets, evidence and native cleanup, and stops at the first failed scenario. Browser-only steps (`navigate`, `reload`, `viewport`) are rejected at preparation. Use a browser campaign on the stabilized candidate when the decision requires UI or subscription evidence. Set `executionSurface: "browser"` explicitly for a new browser campaign. Historical already prepared or authorized manifests without the field retain their original browser path; they are not reinterpreted. The chosen surface is part of the immutable mandate; changing it requires a separately authorized campaign.

## Manifest Selection

Use version 3 for new campaigns requiring automated evidence review, or version 2 for configurable campaigns with manual assessment. The exported `campaignManifestSchema` and `analysisMandateSchema` in [qualificationCampaignPolicy.ts](../../../../convex/qualificationCampaignPolicy.ts) own the input contract; consult them for required fields and supported combinations rather than maintaining a parallel schema here.

- Declare `scenarios` with free identifiers, stable CIK identities, current company metadata, framing and ordered `steps`. Only explicit browser campaigns may omit scenarios to select the existing default battery, whose resolved content preparation freezes.
- Declare `configurations` with explicit `quality` or `harness_stress` purpose and per-role model/reasoning choices. Live models must already be prepared and available in the catalogue. Quality qualification uses the configuration owner's recommended reasoning; do not invent levels the model does not advertise.
- Declare mandatory expectations, correction paths, expiration, maximum lots, repetition allowance and per-lot/cumulative budgets. Per-lot limits are shared across scenarios; optional scenario caps can reduce them.

Version 1 remains readable with its historical limits. Versions 2 and 3 use declared workflow budgets within the technical engine constraints; version 3 adds independent analysis authority. Do not upgrade an existing mandate to add review permission. Deterministic Workbench or Sources results do not establish live workflow model quality, even when a real reviewer assesses them.

## Automated Reviewer Setup

The reviewer is a separate workload, not another workflow agent. Declare `analysis.scope: "evidence_review"`, the exact provider/model route, per-lot and total request allowances, input bounds and timeout in the new mandate. Choose these bounds for the agreed evidence and decision; a previous campaign's model, request count or timeout is not a default. Resolve workflow models through the application catalogue and reviewer models through Pi's native runtime rather than copying catalogue settings into reviewer configuration.

Set reviewer effort once, for example `WORKBENCH_REVIEW_REASONING=high` in the main worktree's `.env.local`, or supply it in the command environment for a new review. The [technical contract](../../../../context/TECH.md#qualification-campaigns) defines precedence, the default, supported-level checks and historical recovery. Do not reuse `PI_REASONING_LEVEL`: Pi injects it as parent-session metadata, not reviewer configuration. This setting does not select workflow-agent reasoning or change inference authority.

Reuse Pi's native authentication and normal agent-directory discovery, including `PI_CODING_AGENT_DIR` when configured. If authentication is missing, follow the runner's Pi `/login` guidance for the selected provider; do not create reviewer-specific credential files or ask for secrets in chat. `openai` API authentication and `openai-codex` subscription OAuth are distinct routes, not interchangeable credentials.

For Codex subscription review, select `analysis.accounting: "native_subscription"` with one `openai-codex` route and existing native OAuth. Authorize request/quota consumption separately from workflow spending. This path records token usage without dollar settlement or an arbitrary output-token ceiling. For API accounting, consult the schema's explicit cost and output-ceiling requirements and refresh official pricing before proposing paid work. Live API-paid reviewer transport remains blocked pending qualified billing controls; successful authentication does not enable it. OpenCode Go fallback remains blocked until a pre-dispatch subscription-only guarantee is established.

## Assessment Artifacts

Start with the developer handoff exposed by the command's `diagnostic_available` output or `--campaign status` under `diagnosticReports`. Its path, summary and pending/assessed state are separate from the official verdict. Use its decisive citations and source boundary to select a targeted verification rather than rebuilding the whole investigation. Intermediate console output is not a terminal verdict, and a valid citation or schema is not proof of semantic correctness.

New reviews use the shared [investigator mission](reviewer-mission.md), compact captured context and read-only `ls`, `read` and literal `grep` over the frozen index, including archived source under `code/`. Reads and search verify complete file hashes before returning bytes. Search can be case-insensitive, but does not support regex or globs; follow `nextCursor` until null before claiming whole-corpus absence. The reviewer has no shell, write, edit, live-service or credential tool.

- `automated-review-report.md` is the readable developer handoff, retained before assessment parsing. `automated-review-report.json` binds its hash and identities and records assessment state; `complete: false` identifies useful truncated output that remains pending. Numbered report files preserve original responses and format corrections; a report can remain useful but unaccepted.
- `automated-review-mission.json` pins the trusted mission, its hash and captured context for recovery. New pins include `reasoning.requested` and `reasoning.effective` SDK levels; inspect actual request captures for provider effort. Instructions found inside evidence are not loaded as authority.
- `automated-review-result.json` retains the validated review and its original evidence revision. A completed review may still await reconciliation or assessment handoff.
- `automated-review-assessment.json` retains the assessment hash and verdict after handoff. Confirm the corresponding backend lot assessment before declaring completion.
- `automated-review-status.json` records pending conditions and need not exist on success. Its absence is not a failed review, and an older pending status does not override a completed result and confirmed assessment.

For manual version-1/2 assessment, or an explicitly chosen manual review of a pending lot, use `review-template.json` and `--campaign assess`. Preserve the independent mechanical result and original automated artifacts; do not overwrite an assessment to hide a disagreement.

## Recovery and Closure

A retained completed review can be adopted after reconciliation without another model request. New responses need a developer handoff followed by the fenced assessment appendix; missing envelopes, invalid JSON, missing checks or noncanonical verdicts receive format feedback in the same Pi session, within the original request envelope and absolute deadline. The runner never translates invalid verdicts into acceptance. Reservation or input-bound refusal leaves a typed pending result and the existing diagnostic report. Integrity and filesystem failures remain separate from format errors. Diagnostic archives retain missing reviewer/finalization inputs independently of official assessment and reuse unchanged archive receipts.

Older accepted JSON results remain adoptable with their original assessment hashes. A started investigator keeps its pinned original evidence revision even when cleanup records a newer one. Matching acknowledged artifacts repair a stale pending report projection during status/run/close without inference. Interrupted analysis observations without a pinned investigator protocol remain pending as `legacy_review_protocol_unavailable`; do not reinterpret their requests under the new mission or reset their authority. Inspect the retained result, assessment receipt, backend state and journal first, including a possible lost assessment acknowledgement. Unknown dispatch outcomes retain their reservations and block blind replay; do not remove intent records or enlarge a mandate to clear them.

Both `--campaign run` and `--campaign close` can enter version-3 review continuation. Use them only when any further reviewer calls remain within the approved scope and allowance. Reaching the agreed stopping point is not permission to spend unused quota merely to finish an assessment.

When no further reviewer calls are permitted, do not use `close` as a guaranteed no-inference command. The existing internal `qualificationCampaigns.close` mutation revokes campaign authority without invoking Pi; use it only through the authorized local backend operator path, then inspect closure and remaining cleanup separately. It does not itself reconcile a lot, restore temporary configuration or complete assessment. If that operator path is unavailable, report closure as blocked rather than inventing a bypass or dispatching another review.
