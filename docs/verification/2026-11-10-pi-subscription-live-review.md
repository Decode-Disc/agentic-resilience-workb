# Native Codex campaign review — 2026-11-10

## Result and scope

The real Pi reviewer completed the existing campaign command against the local backend and recorded an official `passed` assessment for the declared `framing-saved` check. Candidate: `90c2eed1f465588f25365c887412fa45e4b52b3d35ff7ef05155803922deb6d8`. The framing scenario remained a labelled deterministic fixture; this establishes the live reviewer path on that fixture, not fresh company research, broad analytical quality or browser behavior.

The operator approved one campaign using `openai-codex/gpt-6.1-sol`, at most eight model requests, a 120-second review deadline and existing account quotas. No API-key/Go fallback, retries, paid Workbench/Sources research or second lot was permitted. Production Pi authentication and transport were used without injected runtime, synthetic model output or reviewer fetch override. The campaign used the same local deployment `anonymous:anonymous-agent` on ports `3216/3217`.

## Observed execution and judgment

Eight requests completed and settled within 28.807 seconds from first model reservation to final receipt. All eight retained HTTP responses were successful. Provider terminal events reported 62524 input tokens, 471 output tokens and zero cached input tokens. These are native subscription usage observations; no dollar charge or free-use claim is made. The full approved request cap was consumed, so this does not establish that broader reviews fit that allowance.

The reviewer cited `campaign-lot.json`, `framing/save-before.json`, `framing/save-after.json` and `framing/snapshot.json`. Direct inspection supports its finding: the before capture contains revision 2; the after capture contains revision 3 with the declared scope/question; both the after and final captures point `currentFramingRevisionId` to that saved revision. The inference is confined to persisted framing, not economic usefulness.

The lot finished, the campaign closed and the official assessment was persisted. Subscription receipts retain actual usage and immutable observation hashes without `costMicros`. Cleanup completed without diagnostics. `E2E_FIXTURES_ENABLED` and `WORKBENCH_AGENT_ENABLED` were restored and disabled; the fixture flag was absent afterward. The existing watcher remains running. No further model request was made during inspection or archival.

## Reporting correction

The throwaway driver reported a failure after the successful run because it attempted to read `automated-review-status.json`, which is a pending-review artifact, instead of the completed result and assessment. This was an observer error, not a failed campaign. Read-only inspection of backend state, `automated-review-result.json`, `automated-review-assessment.json`, all eight receipts and raw terminal events confirmed the success above. The original failure marker remains intact beside the corrected retained-result report; the campaign was not rerun. Direct backend revocation avoided invoking the command's review-continuation path after the run.

## Evidence and remaining limits

The [native assessment archive](../../scripts/evaluations/archives/20261110T083655038Z-campaign-pi-subscription-live-review-20261110-lot-1-assessment/record.json) preserves source-bound preflight, candidate/captures, frozen evidence, request hashes, eight wire responses, receipts and review before assessment adoption. The [verified supplement](../../scripts/evaluations/archives/20261110T084249649Z-pi-subscription-live-supplement/record.json) adds the approved driver/manifest, original reporting failure, read-only correction, semantic inspection, final assessment/adoption and cleanup. The existing archive owner restored and hash-verified both. Storage is local-only and originals remain intact.

This is a development fixture already used in deterministic verification, not a held-out benchmark. Mandatory preflight and [running-backend no-provider checks](2026-11-10-pi-subscription-campaign-backend.md) remain distinct evidence. Live API-paid metering and Go subscription-only enforcement remain gated. The approved live batch is exhausted; another provider call or commit requires user authorization.
