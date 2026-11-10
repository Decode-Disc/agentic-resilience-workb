# Pi Codex authentication smoke — 2026-11-09

Status update, 2026-11-10: the user subsequently approved explicit native subscription accounting for new campaigns and resuming the same local backend for deterministic verification. That accounting and command integration now pass offline coverage and a [running-backend no-provider campaign](2026-11-10-pi-subscription-campaign-backend.md). The original smoke observations and archive below are unchanged; they do not qualify the later candidate. A subsequently approved [real Codex campaign review](2026-11-10-pi-subscription-live-review.md) passed on the framing fixture; it is separate evidence, not a reinterpretation of this earlier smoke. The [technical contract](../../context/TECH.md#access-resources-and-security) owns the current policy.

## Decision and boundary

Native Pi authentication and one evidence-bound Codex completion passed. This qualifies the selected login and transport for this request, not live campaign execution, the Pi agent loop, automated assessment or general review quality. The campaign's production live transport remains blocked. OpenAI API-key support remains available through Pi's normal authentication; that path was tested with mocked HTTP, not a live API-key request.

The operator approved exactly one `openai-codex/gpt-6.1-sol` request against the frozen CCC diagnostic lot, using existing account limits, a 60-second deadline and no API-key route or OpenCode Go fallback. That authorization is consumed. No official assessment, historical mandate or original lot artifact was changed.

## Observation and interpretation

At `2026-11-09T22:39:44.102Z`, the installed Pi coding-agent 1.5.0 `ModelRuntime` dispatched one native Codex SSE request using the existing OAuth login. Retries were disabled. The response stopped normally and reported 396 input tokens and 348 output tokens. These are subscription usage observations, not an independently verified dollar charge or settlement.

The actual prompt contained the review template and only the hash-verified `campaign-result.json` from evidence revision `6ade29acdd076c7774f13614f489f5cecdb130e7e3a80c4a21a7e3ca835821e0`. The production reader and review validator accepted the input provenance and returned references. The response correctly distinguished the reported incomplete execution and completed cleanup from the unknown failure cause. All seven semantic checks remained inconclusive because no scenario-level evidence was supplied. This supports restrained interpretation on this exposed development example, not diagnostic completeness or model reliability.

The probe called native `ModelRuntime.completeSimple`, not the campaign command or its agent session. It retained intent before dispatch and the observation before validation, refused another model request, and retained an exclusive marker preventing rerun. No credential files or headers were copied into the evidence.

## Preserved evidence

The [verified archive record](../../scripts/evaluations/archives/20261110T000052183Z-pi-codex-native-auth/record.json) identifies 26 files, 987184 bytes: the probe, exact input, intent, dispatch marker, observation, validated review, result, selected frozen JSON inputs, current relevant source/test snapshots, manifest and lockfile. The record was created on 2026-11-10 and includes the uncommitted source bytes; Git HEAD alone does not identify this candidate.

The archive owner verified separate extraction and every retained file hash. Storage is local-only under `.pi/evaluation-storage`, explicitly selected to avoid an execution-context-private home. Original artifacts remain intact. The initial preview could not resolve the historical evidence directory from its shell context. Native file access preserved the selected JSON inputs instead, and the real hash-bound reader verified the copied mechanical result against both its frozen index and the exact prompt. The full historical scenario corpus is not duplicated in this supplementary archive.

## Remaining gates

Focused implementation checks passed before archival: 77 Node campaign/relay/journal tests, 16 Convex tests, frontend/tooling and backend TypeScript checks, scoped Biome and `git diff --check`. They remain distinct from this live smoke. Active LSP coverage was partly inconclusive.

The local runtime status reported all configured ports free, so the latest backend changes have no verified watcher push or running-backend exercise. Full live campaign review, live API-key billing bounds, trusted dollar receipts, Codex campaign accounting and an enforceable arbitrary Codex output-token ceiling remain unqualified. Go still lacks the required pre-dispatch subscription-only guarantee. No further provider request or commit is authorized by this report. The next useful gate is the existing campaign command against the intended local backend under a separately approved bounded live mandate, not another standalone authentication probe.
