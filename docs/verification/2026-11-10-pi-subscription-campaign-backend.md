# Pi subscription campaign backend verification — 2026-11-10

Subsequent qualification, 2026-11-10: a separately approved [real Codex reviewer campaign](2026-11-10-pi-subscription-live-review.md) passed on the same framing fixture. The no-provider observations and archives below remain unchanged and must not be pooled with that live result.

## Result and boundary

The existing campaign command completed native subscription accounting and reconciliation-gated assessment against the running local backend. Anonymous authentication and public access-code admission were real. Reviewer HTTP and its usage were synthetic; no external inference, discovery or acquisition request was made. The official analytical verdict was deliberately `inconclusive`, not a model-quality pass.

The verified candidate is `90c2eed1f465588f25365c887412fa45e4b52b3d35ff7ef05155803922deb6d8`. One explicitly labelled deterministic framing scenario exercised the existing fixture owners, public framing operation, Pi session, journal, request reservation, subscription-usage settlement, evidence validation, assessment and cleanup. One mocked reviewer request consumed its one-request allocation. The lot finished and the campaign closed. No historical mandate or evidence was rewritten.

`E2E_FIXTURES_ENABLED` and `WORKBENCH_AGENT_ENABLED` were restored and disabled; the fixture flag was absent after teardown. Cleanup reported no diagnostics. The same worktree watcher remains running on the verified `anonymous:anonymous-agent` deployment, ports `3216/3217`, with backend version `precompiled-2026-10-22-1447815` unchanged.

## Confirmed blockers and corrections

The initial host publication failed because the inherited PATH selected Node 26 for the backend's Node-action runtime. `/usr/bin/node` was already Node 24. The watcher retained the project's Node 26 executable while exposing that installed compatible runtime on its child PATH; publication then succeeded. No package, global PATH or deployment configuration was changed.

Fresh campaign preflight then reproduced a lock conflict before authorization: the runner held the real qualification lock while its protocol tests attempted that same lock for mocked deployments. A focused RED test demonstrated missing exclusion on the injected deployment's lock. The existing external-boundary interface now permits those tests to use separate real OS locks, including an assertion that query/assessment effects remain protected. The CLI still uses its original worktree-wide lock. The failed preflight obtained no campaign authority and remains preserved separately.

## Validation and evidence

The runner's mandatory source-bound preflight passed `types`, `protocol-tests` (127 passed, no skips), `domain-tests` (184 passed), `lint`, `imports` and `ownership`. The affected real-Convex reviewer integration file was also rerun after lock isolation: both API and subscription variants passed. Earlier focused subscription RED/GREEN checks covered usage without dollar settlement, request exhaustion, unknown dispatch, conflicting replay and journal recovery. The record does not imply full application build, browser rendering or general model reliability. Active LSP checks covered five production files and retained Zod deprecation hints and auxiliary style warnings; this is not an all-diagnostics-clean claim. Compiler and required lint checks passed without suppressing those advisories.

The [native assessment archive](../../scripts/evaluations/archives/20261110T014525792Z-campaign-pi-subscription-unpaid-lockfix-20261110-lot-1-assessmen/record.json) preserves the candidate, checks, captures, frozen evidence, reviewer request/response and accounting before assessment adoption. The [verified supplement](../../scripts/evaluations/archives/20261110T081638147Z-pi-subscription-backend-supplement/record.json) adds the driver, explicit mock boundary, final assessment/adoption, campaign state, cleanup, flag verification and failed preflight. Both were restored and hash-verified by the existing archive owner. Storage is local-only; originals remain intact. A rejected supplementary selection overlapped archive-record storage and published no archive; the corrected selection retains only missing inputs rather than re-archiving the existing record.

## Next qualification

The separate [native OAuth smoke](2026-11-09-pi-codex-authentication-smoke.md) used one actual Codex request on an earlier candidate. It is not a live campaign result. The next gate is a separately authorized bounded campaign using the real Codex reviewer through Pi, with explicit request/time limits and no fallback. API-key authentication remains supported, but live API-paid transport still requires verified metering. OpenCode Go remains blocked by its subscription-only prerequisite. No further provider call or commit follows from this report.
