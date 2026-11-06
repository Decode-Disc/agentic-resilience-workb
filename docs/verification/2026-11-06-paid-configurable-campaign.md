# Paid configurable campaign — 2026-11-06

The user requested a paid evaluation. One version-2 live lot was authorized for CCC and Adobe, using the already enabled GLM-5.3-Flash catalogue model for both Workbench and Sources with recommended reasoning (`high`). Live OpenRouter endpoint metadata was refreshed before execution. The mandate capped the lot at 48 model attempts, six searches, twelve acquisitions and USD2, with no automatic new lot. No production source code was changed.

## Decision

The lot failed end-to-end qualification. CCC produced useful intermediate documentary records, but no completed Sources handoff or conversational follow-up was delivered before the local runtime became unreachable. Adobe was seeded but never executed. This does not qualify model usefulness across the two cases or production activation.

The restored backend records contain two committed CCC captures (a Form 10-K and product help documentation), three contextual reads and four documentary-qualification operations, with eight retained qualification/control task results. One attributed contribution describes the documented insurer/repairer workflow roles; it is useful preparation, not proof of economic dependency. Control findings are not treated as independent answer keys. The initial Workbench framing was persisted and explicitly labelled tentative research rather than established company facts.

## Failure attribution

The decisive interruption is `lots/lot-1/ccc/failure.json`: the runner lost the local backend connection while waiting for the documentary handoff. Both local listeners disappeared. The existing launcher log ended with HTTP522 from Convex's local-deployment activity endpoint. This establishes a local runtime interruption; the exact cause of process termination is unresolved, and the 522 is not asserted to have caused it. There is no evidence that the model caused the service exit.

A separate continuity inefficiency is demonstrated by the retained provider requests. All inspected native requests used `z-ai/glm-5.3-flash` and reasoning `high`. The three contextual-read operation IDs appeared in model inputs before compaction, but none appeared in the inputs or outputs of the three subsequent compactions. Read tool-result bodies contain passage/capture data without their operation-request IDs. The model then repeatedly paged mission history to recover reading references: 22 `consult_mission_state` operations were recorded. Four local `context_capacity` refusals occurred before provider dispatch, and four compactions ran. Compaction did permit subsequent calls; this was not a permanent loss of persisted readings. The observation supports a costly interaction between transient reference presentation, compaction and model recovery strategy, not a general claim about model intelligence. The history reader pins its frontier; a self-growing history loop was not established.

Before another paid lot, isolate the local service exit using the launcher/CLI child exit status and system diagnostics, including a zero-provider reproduction of activity-reporting failure. For the continuity issue, compare returning operation IDs in durable tool results with exposing admitted reading references in the existing code-owned Sources projection. Prefer the existing projection so references remain directly available after compaction; no new agent or evaluation framework is required. The discriminating regression is read → forced compaction → qualification with the original reading IDs, without history paging solely to recover those IDs. These are recommendations; no corrective implementation or further paid batch was performed.

## Calls and cost

| Measure | Observed |
| --- | ---: |
| Model attempts reserved | 46 |
| Real model dispatches | 42 |
| Pre-dispatch capacity refusals | 4 |
| Reasoning / compaction / documentary-control dispatches | 33 / 4 / 5 |
| Discovery searches / Contents / SEC filing / SEC company revalidation | 2 / 1 / 1 / 1 |
| Model cost recorded | USD0.0909279009 |
| Retrieval cost recorded | USD0.015 |
| Total recorded cost | USD0.1059279009 |
| Conservative reconciled allocation | USD1.1172336 |
| Authorized ceiling | USD2 |
| Pending receipts / unknown dispatch outcomes | 0 / 0 |

Recorded costs are receipt telemetry, not an independent provider invoice audit. The conservative allocation retains reservations and is not the amount asserted to have been billed. No remaining budget was used to launch another lot.

## Recovery and verification

The native local launcher was restarted only after inspection confirmed the old backend and web processes and listeners were absent. The campaign was revoked as soon as the local backend returned; a resumed worker was refused with `execution_interrupted`. The native close/recovery path restored the catalogue's original reasoning preference, closed the test context and reconciled the lot. The development-agent assessment is `failed`, the campaign is closed and no active lot remains. Final inspection confirms fixture/Workbench/Sources flags off, publication released and no active worker. Local services are running again on their original ports; their processes were replaced during recovery.

The frozen candidate is `90126a99f0c555e3946c5817d53e11d074dc8d3a1edb54e59bb3054ed272b357`. Native preflight passed types, 51 Node tests, 92 Convex tests, scoped lint, imports and execution-ownership checks. Expected reduced-motion warnings were informational. This report is checked with `pnpm docs:check`.

After anonymous re-admission during recovery, active-context-only fixture inspection could not export the closed run. Read-only `convex data --deployment local --limit 500 --format json` reads recovered the relevant rows, filtered in memory to the two evaluation run IDs before writing. No identity was fabricated and no fixture context was reactivated. This is an evaluation-tooling observation gap: historical evidence inspection should remain possible without renewing execution authority.

## Evidence and archival boundary

The immutable mandate, code snapshots, original browser failure, cleanup/assessment, live endpoint metadata and recovered run-specific records are under `/home/abdwhb/.local/share/agentic-resilience-workbench/paid-campaign-20261106`. `causal-audit.json` records route/effort and compaction-reference checks. The original run and recovery diagnostics are retained separately.

Full normalized capture bodies were not exported: the active-context inspection failed during interruption/recovery, and a direct storage-ID URL did not resolve. Capture hashes/storage references and the exact retained reading/qualification excerpts are preserved, but this is not a fully self-contained source replay. The backend still retains the captures. Archival verification covers only the explicitly selected records; missing capture bodies remain an explicit limitation.

The [retained-record archive](../../scripts/evaluations/archives/20261106T063409265Z-paid-configurable-campaign-20261106/record.json) is verified (1922 files). It includes this report before this archive-metadata append, run-specific recovered records, provider payloads, code snapshots and diagnostics. The missing full capture bodies described above remain outside this verified scope. Storage is local-only.

## Follow-up runtime diagnosis — 2026-11-06

The installed Convex CLI 1.47.0 provides a reproducible explanation for the observed activity-reporting shutdown. Its local deployment pings the cloud activity endpoint every 60 seconds inside a best-effort catch. However, bigBrainRecordActivity uses bigBrainAPI, which handles HTTP errors through ctx.crash. The dev command supplies OneoffContextImpl: crash runs registered cleanup and exits the process. That exit cannot be recovered by the outer catch. The registered local-backend cleanup terminates the backend; the project launcher also tears down the services belonging to the exited invocation.

An isolated copy of the actual installed CLI bundle reproduced the path with a mocked HTTP522 transport and the real OneoffContextImpl. It recorded mock-fetch-522 then cleanup-before-exit and exited with code 1; neither the outer catch nor the process-survived marker was reached. No running service or installed dependency was modified. Probe artifacts and bundle fingerprint are retained under .local-runtime/runtime-diagnosis-20261106. Earlier failed probe setup attempts are separate and are not the reproduction evidence.

This establishes a fatal error-handling defect matching the last launcher's 522 log and simultaneous disappearance of local services. It does not establish how often this caused earlier interruptions; no complete exit-status history was retained. Kernel journal inspection found no OOM-kill or segfault record for the incident window. Earlier launcher logs also show Node-runtime incompatibility preventing Node-action publication, a separate startup/publication problem. The next bounded correction is to make activity reporting actually non-fatal and protect it with a subprocess HTTP522 regression, preserving fatal handling for authoritative operations. This supersedes the earlier unresolved SDK shutdown mechanism; the origin of the transient cloud/network failure itself remains unknown.

## CLI activity-reporting correction — 2026-11-06

The user authorized reporting the defect and then applying a version-scoped dependency patch. [Convex issue 635](https://github.com/convex/convex-backend/issues/635) includes a standalone reproduction against published CLI bundles 1.47.0 and 1.49.0. The project retains version 1.47.0. Its pnpm patch uses the existing throwing request helper only for activity reporting, allowing the existing scheduler to catch failures. Failures produce a warning with the HTTP status when available; cleanup suppresses late warnings and prevents further pings. Required startup requests retain fatal error handling. This implements the bounded CLI correction proposed above; the Sources reference-continuity recommendation remains separate.

The patch is registered in pnpm-workspace.yaml and pinned by the lockfile. Canonical CLI source changes and their two bundled functions are included; those functions were regenerated from the source using the already installed esbuild 0.27.0. No package version, resolution or integrity hash changed. pnpm initially normalized unrelated AJV dependency records; those task-introduced changes were reverted before successful frozen-lockfile validation. The published upstream source map was not rebuilt. The [technical contract's local-development section](../../context/TECH.md#local-development) owns the temporary patch and its removal condition; no product behavior or roadmap claim changed.

The RED command was `pnpm exec vitest run src/__tests__/config/convex-activity-ping.test.ts`. Before patching, HTTP522, exhausted network retries and an in-flight ping rejected after cleanup each exited with status 1 instead of surviving. Required startup failure already passed. After patching, all four cases passed against the actual installed CLI bundle and OneoffContextImpl. The tests execute the real activity scheduler, accelerate only its timer, verify the next scheduled notification, and assert cleanup blocks a stale timer and an in-flight reschedule. Filesystem/binary setup, backend process startup and remote responses are controlled boundaries; these deterministic tests do not claim a real backend.

A separate local probe started the cached native backend binary in an isolated temporary directory on distinct ephemeral ports, with telemetry disabled and control-plane traffic redirected to loopback. Remote metadata responses were simulated, while backend startup, readiness HTTP, the activity scheduler's natural 60-second timer and shutdown were real. The first activity request received HTTP522 at 1793949222845; the backend answered its identity check afterward. The next request succeeded at 1793949283491, 60.646 seconds later, and backend identity still matched. Native CLI cleanup stopped the backend and removed the fixture. No running project data, cloud deployment or paid provider was used by this probe.

Validation commands and results:

- `sfw pnpm patch convex@1.47.0 --edit-dir .local-runtime/convex-activity-patch` and `sfw pnpm patch-commit .local-runtime/convex-activity-patch`: succeeded with the existing release-age, trust and build controls; 988 locked entries passed policy checks. Existing deprecated lucia/node-domexception notices and the pending @tanstack/react-start agent-skill approval were reported; no skills were approved.
- `sfw pnpm install --offline --frozen-lockfile --ignore-scripts`: passed, including policy validation; package versions and the prior dependency graph were preserved.
- `pnpm exec vitest run src/__tests__/config/convex-activity-ping.test.ts src/__tests__/config/local-convex-sync.test.ts src/__tests__/config/convex-publication.test.ts src/__tests__/config/local-runtime.test.ts`: 84 passed.
- `pnpm exec biome check src/__tests__/config/convex-activity-ping.test.ts`: passed after formatting the new test once.
- `pnpm exec tsc --noEmit --ignoreConfig --target es2022 --module esnext --moduleResolution bundler --skipLibCheck --strict --types node src/__tests__/config/convex-activity-ping.test.ts`: passed.
- `/usr/bin/node .local-runtime/runtime-diagnosis-20261106/qualify-live-backend.cjs`: passed with a real backend and natural timer as described above.

Probe scripts and RED/GREEN, frozen-install, focused-regression and live-backend logs are retained under .local-runtime/runtime-diagnosis-20261106. No new paid campaign was run, and the original campaign remains failed. These checks establish local CLI recovery from notification failure, not upstream availability or model quality. The historical paid-evaluation archive remains immutable and predates this follow-up.

The local project runtime was restarted through its native launcher using `/usr/bin/node` 24.18.0 and the existing backend version precompiled-2026-10-22-1447815, after confirming no active workers and no publication hold. Startup against the existing 2.3GB database was slow but completed. The watcher reported `Convex functions ready` at 08:19:56 local time; Vite returned on its original port. At 07:21:18 UTC, the verified watcher/frontend invocation was ad8c1752-698a-43ac-b728-df6ada865f1e, with CLI PID637938 and frontend PID646839. Ports 3210/3211/5173 were present, backend identity matched local-aboul_panga-dd_proto, the frontend root returned HTTP200, and publication status remained unheld with no active workers. This HTTP check establishes runtime availability, not the protected analyst journey. The installed patched CLI bundle SHA-256 is 6fafd8d16f5b00b7404031ee2cbe9dd3d6cf7c2bab6c7dc100374e6a045bdc2d.

`pnpm docs:check` passed with zero link/structure errors and the existing advisory technical-contract word warning. The watcher separately completed its backend typecheck and push. No project-wide application suite or application build was run for this development-CLI patch; validation covers the installed CLI, neighboring runtime/publication tests, the isolated real backend and local runtime availability. The documentation review kept the temporary mechanism in its existing technical owner and dated evidence in this report, preserving the historical archive and the original failed-campaign decision. The CLI's existing update and AI-file freshness notices were retained; no CLI upgrade or AI-file regeneration was performed.

## Historical capture recovery follow-up — 2026-11-06

The later [qualification reliability correction](2026-11-06-qualification-reliability.md) recovered both committed capture bodies through a read-only audit after campaign/context closure, verified their historical hashes and retained the supplement separately. The original interrupted lot remains failed and its original archive remains immutable; the supplement does not turn that run into a successful qualification. Current duration, historical inspection and reading-reference obligations remain in the [technical contract](../../context/TECH.md#access-resources-and-security).
