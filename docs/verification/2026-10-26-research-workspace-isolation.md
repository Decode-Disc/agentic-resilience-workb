# Research workspace isolation — local verification

Date: 2026-10-26. Target: the existing `local-aboul_panga-dd_proto` backend at `http://127.0.0.1:3210`, with the application on port 3000. This report establishes local isolation and migration evidence; it does not certify cloud deployment or general live research quality.

## Preserved historical data

The read-only preview classified all 407 existing dossiers without ambiguity: seven research dossiers, 68 evaluations and 332 browser fixtures. The private migration applied batches of at most 50 and appended system audit events. An exact comparison of each original dossier before and after migration found no differences after excluding the newly assigned `purpose` field. No dossier, original owner, reservation counter, business timestamp, capture, decision or raw evaluation archive was deleted or transferred.

| Account | Original research dossiers | Original evaluations | Original browser fixtures | Reserved analyses |
| --- | ---: | ---: | ---: | ---: |
| Administrator | 0 | 0 | 0 | 0 |
| Analyst 1 | 3 | 3 | 332 | 3 |
| Analyst 2 | 3 | 44 | 0 | 3 |
| Analyst 3 | 1 | 0 | 0 | 1 |
| Analyst 4 | 0 | 21 | 0 | 0 |

The original analyst-2 list therefore contains three research dossiers rather than 47 mixed entries, while all 44 evaluations remain available in protected administration. Its three consumed reservations were preserved. Browser verification subsequently added nine isolated fixtures to the reserved analyst-4 account; their provider-call receipt count is zero. Final preservation inspection counted 416 dossiers: all 407 originals and the nine new fixtures, with zero deletions or additional differences in the original dossiers. Final inspection found zero active browser contexts and confirmed that `E2E_FIXTURES_ENABLED` had been removed.

## Verified boundaries

Public-boundary tests exercise purpose isolation, direct source reads and decisions, caller-controlled reservation keys, context rebinding and closure, research-only quota restoration, provider reservation denial, stale pagination scope keys, administrator-only inspection and idempotent migration. Legacy migration fixtures disable schema validation only inside their isolated test database to represent the old optional field; ordinary tests use the required production schema.

The implementation uses the existing authorization and cancellation owners. Namespace checks protect source and evidence operations, while private evaluation execution keeps its existing authority. Native pagination scopes ordinary lists by the server-owned workspace and separates administrator categories, restoration candidates and provider receipts. Browser fixtures require real admission followed by a private context binding, use context-scoped fixture identities and receive bounded expiry and teardown. A new admission cannot implicitly inherit a previous context.

The preview authorization regression was reproduced through the real public action: revocation raised an exception instead of returning its established unavailable result. Authorization now lives in the shared preview read boundary, covering cache reads, render eligibility and cache persistence. The preview, corpus-revision and administration compatibility run passed 26 tests. A separate fresh run passed both the administrator isolation and unauthenticated preparation-denial checks.

## Protected browser evidence

The stabilized workspace run passed three scenarios: desktop isolation, mobile isolation and administrator category pagination with read-only inspection. A subsequent focused run passed real logout/readmission with explicit context rebinding and the mobile reload/navigation/closure scenario. These journeys use real anonymous authentication and the reusable local admission drawer, without fabricated browser identities or public fixture endpoints.

Administration was exercised at desktop and 390-pixel widths, including category changes, loading 20 then 40 benchmark dossiers, read-only provider inspection, Escape closure and the reserved-account label. Dossier navigation used keyboard focus and Enter, reload retained the current fixture, and closing its context denied access. Reduced motion was enabled. The shared image fixture records exact fulfilled Request objects; the evidence gate exempts only those mocked requests and keeps rejecting unrelated network failures or external traffic.

Sanitized screenshots were inspected for desktop/mobile administration and desktop dossiers; the final mobile scenario also captured the dossier surface. The pre-change protected administration baseline is available locally. A pre-change Dossiers screenshot was not obtained before its backend API changed, so no complete visual before/after claim is made for that page. Existing card composition was preserved in source. These fixture checks do not establish analyst visual acceptance.

## Verification record and limits

- Final `pnpm typecheck` passed for the application and backend after compatibility consolidation. The subsequent local publication also passed its installed TypeScript check.
- `pnpm build` completed both client and server compilation without warnings.
- Task-scoped Biome checks passed. Global `pnpm lint` reported six parent-import violations in unchanged benchmark tests; the same imports were verified in `HEAD`.
- `pnpm docs:check` passed with zero link/structure errors. The existing technical-reference word-limit warning is advisory. `pnpm design:check` passed.
- The first global test runs exposed authorization/error-contract regressions and timing failures. They were interrupted after necessary corrections invalidated their code snapshot. Their output is not a global green result. The final scoped run passed 224 of 225 tests across 24 files; its sole failure was a five-second timeout in the sixty-source fixture case during overlapping validation. With other test processes stopped, that unchanged case passed independently in 3.48 seconds. The final `pnpm test --maxWorkers=2` run on the frozen code snapshot passed all 1,568 tests across 174 files in 637.49 seconds, with no failures.

No paid provider call, cloud deployment, commit or push was performed. The existing development backend was preserved; synchronization used `pnpm convex:sync --url http://127.0.0.1:3210`. Schema publication first widened the field, then followed the audited backfill with the required field. One publication attempt rejected names longer than Convex's 64-character index-name limit; the names were corrected and the subsequent publication succeeded without restarting the backend.

## Review corrections and fixture replay

Recorded source-utility scenarios now prepare fresh dossiers through the existing guarded producer after anonymous admission in the current analyst-4 context. `UTILITY_SEEDED_FILE` selects scenario definitions only; archived dossier IDs and snapshots are never reused. Each approved-state test prepares and approves its own dossier through the interface. The producer pins the archived qualification protocol, checks the original input hashes and uses an isolated Vite configuration without the application plugins or dependency optimizer. Hashes of the historical selector, recorded manifest and responses remained unchanged.

The private pagination fixture derives its owner from the admitted reserved account and creates exactly 40 evaluation dossiers and 20 browser dossiers, idempotently within its active context. A Convex test starts without either technical population and verifies the actual administrator pagers, unchanged reservations, zero provider calls and rejection after context closure. The browser test verifies membership of these newly seeded IDs. The earlier pagination result above depended on developer history; the new empty-database evidence is from `convex-test`, not a reset of the shared local backend.

The header disclosure now shares the existing dossier-navigation cell. Both viewport checks first reproduced a 50-pixel vertical displacement between Home and Account; both pass after the correction with a maximum permitted displacement of two pixels. Before/after desktop captures and the final mobile capture were inspected. Browser replay also corrected stale test controls: current approval copy, explicit inclusion/removal, the mobile detail dialog, initially open passages, the expandable coverage panel and selectors scoped away from outgoing transition content. No application source-review behavior was changed for these test repairs.

Validation for this follow-up:

- `pnpm test src/__tests__/e2e/source-utility-preparation.test.ts src/__tests__/convex/research-runs/run-workspace-separation.test.ts src/__tests__/components/workbench-shell/workbench-shell.test.tsx --maxWorkers=1` passed 22 tests in three files. RED checks reproduced the missing population fixture, unsupported viewport option, inaccessible archived dossier and header displacement before their corrections.
- `pnpm typecheck`, the subsequent local synchronization and scoped Biome checks passed. A supplemental `tsc --noEmit` configuration covering the changed E2E files and their imports passed; its temporary configuration was removed. The 1,568-test aggregate above predates this follow-up and was not repeated.
- The local Playwright runner used the existing services, one worker, no automatic retries, a 90-second test budget and 15-second assertions. Header desktop/mobile and seeded administration passed. The canonical utility run passed nine of 14 scenarios; focused corrections and subsequent runs completed the other five. All 17 distinct affected scenarios therefore have successful execution evidence across separate runs, not an uninterrupted green suite. Default repository E2E deadlines were not certified by this runner.
- Initial failures remain in `/tmp/workbench-review-browser-all-utility.log`; focused results are in `/tmp/workbench-review-browser-five.log`, `/tmp/workbench-review-reload-diagnostic.log` and `/tmp/workbench-review-browser-mobile-final.log`. The last mobile run passed both scenarios. Temporary diagnostic source was removed. Browser warnings concerned the runner's conflicting `NO_COLOR` and `FORCE_COLOR` settings.

CrowdStrike exceeded reload assertions before later passing with their deadlines unchanged. A separate diagnostic measured 10.78 seconds from reload to approved content: the first subscription was sent at 7.75 seconds, and the source summary and adjustment responses arrived between 9.0 and 9.5 seconds. This points to development-page initialization latency in that diagnostic; it does not establish the exact cause of every earlier timeout or certify timing reliability. One NVIDIA post-approval CLI inspection also failed; both unchanged inspection queries subsequently succeeded against that dossier, and the final complete mobile journey passed. These earlier failures are not suppressed or treated as evidence of lost approval.

Final bounded inspection covered all 47 browser contexts and all 105 context-scoped technical dossiers belonging to the reserved account: zero active contexts and zero dossiers with provider receipts. `E2E_FIXTURES_ENABLED` was absent. Reserved analyses remained administrator 0, analyst-1 3, analyst-2 3, analyst-3 1 and analyst-4 0. No paid calls, cloud publication, commit or push occurred during this follow-up. The reference contracts remain unchanged; this section corrects the verification evidence and its limits.
