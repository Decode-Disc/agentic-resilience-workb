# Phase 5 Evidence Matrix and Provenance — Verification and Coordination Closure

> **Dated evidence.** Preserve the observations and limitations below. Its status, requirements and permissions describe that checkpoint, not current authority. Use the [current document owners](../../AGENTS.md#document-authority-and-required-reading) and [delivery roadmap](../ROADMAP.md); no historical budget or execution permission is renewed.

Date: 2026-08-22

Status: **Deterministic/local Phase 5 closure PASSED. External live SEC/Exa provider certification DEFERRED pending explicit authorization.** Real source URL response, latency, byte counts, attempt counts, locator reproduction, and provider cost for live SEC/Exa were not observed in this run and are not claimed here.

This report covers the complete Phase 5 evidence slice — Tasks 1 through 10 of `git show c4f0d24:docs/superpowers/plans/2026-08-15-phase-5-evidence-matrix-provenance.md` — from the transactionally frozen effective accepted-source heads through immutable reproducible passages, hash-gated atomic claims, evidence relations, versioned policy evaluation, the `evidence_ready + idle` strong handoff, and the honest `claim_generation_unavailable` pause for arbitrary live inputs. Real Unstructured page-aware PDF normalization and real model-provider claim extraction remain Phase 8 and are out of scope for this closure.

## Confirmed (deterministic and local)

Confirmed evidence below is reproducible against the local backend. It does not depend on any live external provider.

- Full final Vitest: **114 files / 763 tests passed in 147.22 s**. Three `Window.scrollTo` jsdom notices remained but were non-failing. Three earlier `start-route` timeouts did not recur; no timeout or assertion was weakened to obtain green.
- Focused Task 10 security/fixture Vitest: **4 files / 24 tests passed**. Backend fixture/replay focused gate: **4 files / 39 tests passed**.
- Default mode new live-contract tests: **2 files / 2 tests passed with `RUN_LIVE_PROVIDER_TESTS` unset**; the gate returns before credential read, client construction, or network I/O. A default-mode run of the complete live test directory passed 7/7, and the related adapter suites passed 40/40. None of these is a live provider run.
- Full Playwright: **10/10 passed in 3.4 minutes** against the local Convex deployment `local:local-aboul_panga-dd_proto`, comprising evidence matrix (7) and source review (3). No SEC or Exa call was made.
- Browser states covered: showcase `evidence_ready + idle`; exact claims, quotes, and locators; classification filters and counter-evidence; the unavailable `extracting_evidence + paused + claim_generation_unavailable` state; `providerCallCount` 0; cleared active `workflowId`; desktop, tablet, and mobile layouts; mobile Drawer focus and Escape restoration; reduced motion; logout, private-route denial, rebinding with the same code, and dossier recovery; reactively updated Source Review.
- Artifact audit after the final Playwright run: 10 manual trace ZIPs; 0 automatic PNG/WEBM media captures; 0 exact analyst access-code matches; 0 credential-key matches. Manual traces start only after admitted seeded/recovered dossier navigation and stop before OTP re-entry.
- Typecheck passed. Lint and import checks passed. `git diff --check` passed before these documentation edits. Final scoped LSP checked 25 Task 10 and closure files with zero diagnostics.
- `pnpm convex:check` passed and functions were ready in 6.12 s. Non-blocking warnings: Convex 1.42.1 → 1.45.0 available and Convex AI files out of date. No cloud deployment was performed.
- Production build passed: client 8562 modules and client build 3.98 s; SSR 231 modules.

### Implemented contracts (from the acceptance evidence)

- Effective accepted source authority is frozen from the exact `sourceReviewItems.latestDecisionId` matched against the append-only `sourceDecisions` row (`decision === "accepted"`, correct run/corpus/source identity), revalidated immediately before any I/O and again before persistence. Superseded, pending, rejected, historical, foreign, cancelled, and stale inputs produce zero unauthorized side effects.
- SEC HTML and Exa Contents retrieval adapters enforce application-owned authorization gates, URL/redirect/DNS pinning, size/page ceilings, bounded timeouts and retries, telemetry, cancellation, and typed partial/failed outcomes; the direct public PDF path uses deterministic fixture normalization only and returns `normalizer_unavailable` for anything non-fixture.
- Source versions and passages are immutable and reproducible; every quotation replays from its immutable source version via a deterministic byte hash, locator version, and exact offset/slice check.
- Claims are atomic, carry explicit `ClaimEvidence` relations (`supporting`/`counter`/`context`), link to separately decided dimensions, and are produced through a hash-gated deterministic showcase adapter that never creates a fake `ProviderCall`. `Unknown` claims reference a stable question and at least one context passage; coverage is derived, never stored.
- Structural validation is non-overridable and policy evaluation is versioned and application-owned; typed semantic verification is triggered only when a deterministic rule requires it. Weak evidence may result in `Hypothesis`, `Unknown`, `needs_review`, or `blocked`; no aggregate confidence or assessment is invented.
- Successful Phase 5 ends at the transactional strong `evidence_ready + idle` handoff with the evidence Execution-slot released. Arbitrary live-like non-manifest input pauses honestly at `claim_generation_unavailable` with source coverage preserved, no fabricated claims, no Phase 6 unlock, and no provider calls.

## Deferred (explicitly not certified here)

- Real live SEC and Exa provider retrieval is **DEFERRED pending explicit authorization**. This closure must not be read as proof that a live SEC filing body or live Exa Contents response, latency, byte count, attempt count, locator reproduction, or provider cost was observed. `SEC_USER_AGENT` and `EXA_API_KEY` are never read by the default tests, and the opt-in live contracts are gate-first.
- Real Unstructured page-aware PDF normalization and real model-provider claim extraction/semantic verification remain **Phase 8** under ADR-004, ADR-009, and ADR-010.

## Residual debt (non-green final command, pre-existing and unchanged)

`pnpm format:check` remains nonzero on exactly 17 files, all unchanged since HEAD and outside Phase 5. This is the only non-green final command and is pre-existing untouched debt; the Phase 5 files themselves were formatted and pass. If needed, the exact list can be reproduced from the current `pnpm format:check` output.

## Reviews

- Backend review: `/home/abdwhb/.pi/agent/sessions/--home-abdwhb-projects-decoding-discontinuity-application-proto--/subagent-artifacts/165fb0fe-c5db-4f18-bb7f-0a1d9aba92b6_code-reviewer_0_output.md` → **SPEC PASS, QUALITY APPROVE, PLAYWRIGHT SAFE**.
- Playwright/security review: `/home/abdwhb/.pi/agent/sessions/--home-abdwhb-projects-decoding-discontinuity-application-proto--/subagent-artifacts/2cc653fc-4978-4e66-bc1c-9c9611a50b25_code-reviewer_0_output.md` → **zero Critical/High issues, SPEC PASS, QUALITY APPROVE, LIVE-CONTRACT SAFE**.
- Live contract review (this run): **8 files reviewed, 0 Critical/High issues, SPEC PASS, QUALITY APPROVE**. Guards return before credential access or client construction; missing credentials throw before I/O; production adapters and normalizers are used; bounds (SEC retries/size/locator, Exa retries/text size/locator) and production timeouts/retries were verified; diagnostics were checked across 7 source/test files with zero LSP findings; logs contain bounded metadata/error codes only. The reviewer concluded closure is safe only because live SEC/Exa evidence remains explicitly marked DEFERRED.
- Final closure re-review: the initial HIGH was withdrawn after the reviewer inspected the complete admission drawer close path and reconciled it with the fresh 10/10 Playwright execution. Final verdict: **SPEC PASS, QUALITY APPROVE, PHASE 5 CLOSURE SAFE**. The reviewer recorded one LOW, out-of-scope follow-up: successful admission currently also triggers the cancellation callback and overrides the intended dossier destination; this existing behavior does not invalidate Phase 5 evidence.

## Deployment and cost implications

No commit, stage, push, cloud deploy, dependency change, paid provider call, or `.pi/settings.json` change was made. The worktree remains uncommitted and unstaged. Deployment is local-only (`localhost`/`127.0.0.1` against `local:local-aboul_panga-dd_proto`); no cloud deployment was performed and no provider cost was incurred in this closure.

## Remaining gaps

- Real live SEC/Exa provider certification is pending explicit authorization and can only then confirm external drift behavior, latency, byte counts, attempts, and reported cost.
- Real Unstructured page-aware PDF normalization and real model-provider claim generation, semantic verification, routing, retries, and fallback remain Phase 8.
- Claim and dimension-link analyst decisions, append-only overrides, and the Phase 6 review UI remain Phase 6.
- Dimension assessment, map, brief, export, and production deployment remain later phases.

## Next smallest coherent slice

With Phase 5 deterministically/local certified and documented, the next coherent slice is the separately authorized live SEC and Exa provider certification using the opt-in gate-first live contracts (`RUN_LIVE_PROVIDER_TESTS=1`), recording exact identities, attempts, latency, byte/passage counts, locator reproduction, and provider-reported cost without printing credentials or full bodies. After that, Phase 6 review surfaces become the smallest next product slice.