# Administration Redesign

**Status: implemented 2026-11-16, uncommitted; restructured the same day after review.** The section compositions were chosen from rendered comps (`.impeccable/mocks/decision/`): Overview as an attention list beside a status column, Dossiers as a list beside its detail, Models & agents with a view rail and one-row catalogue entries, Activity & spend as one table under spend figures; sections use `DirectionAwareTabs`, every list scrolls within its own area and actions carry icons. Deviations from the tasks below: restoring quota stays in the Reservations view because its query owns eligibility; failed dossiers use the recent-page default; the activity table has no dossier column (attempt projections carry no company name) and no saved views beyond the existing filters.

## Outcome

Opening Administration tells the single administrator within seconds whether anything blocks analysts and gives the one action that resolves it. Dossier inspection, model configuration and provider activity live in three task-named sections built from the shared primitives the analyst side already uses. Every audited action keeps its server contract, its reason requirement and its confirmation.

**Exit criteria**

1. `/workspace/admin` opens on an Overview whose "Needs attention" list shows exactly the four accepted conditions (below), each with its direct action, and a calm empty state when none applies.
2. Sections `overview`, `dossiers`, `models`, `activity` and an open dossier detail are addressable by URL and survive reload.
3. Dossier detail opens in a `Sheet` with a readable status first; restore quota and withdraw are confirmed in `Dialog`s that require a reason, with unchanged server calls.
4. Each model is a `Card` with one status badge and one primary action for its state, including `Refresh input profiles`; add/edit happens in a `Dialog`.
5. No raw workflow or provider codes as primary text; codes remain secondary detail.
6. Focused component tests, existing admin tests and the admin browser gate at 1440 px and 390 px pass with keyboard, reduced motion and a clean console.

**Accepted decisions (brief)**

- Mode is Operate; reuse the existing Workbench theme and primitives (`Card`, `Badge`, `Dialog`, `Sheet`, `Item`, `Empty`, `Skeleton`, `LoadErrorAlert`, `Pagination`). No new visual world and no change to shared primitives for admin's sake.
- Structure: Overview (default) → Dossiers (dossiers, reservations, review decisions) → Models & agents (models, agent models) → Activity & spend (provider activity and billing).
- "Needs attention" conditions, and only these: paid work stopped; a model assigned to an agent that is not prepared or unavailable; failed research dossiers; restorable reservations.
- Paid work moves from the page header into an Overview status card; changing it keeps the reason dialog.

**Exclusions**: new admin capabilities, backend policy changes, schema changes, charts, analyst-side changes, redesign of shared primitives, invocation-journal internals beyond re-housing them.

## Current behavior (evidence)

- Route: `src/routes/workspace/_protected/admin.tsx` exports only `Route` with `component: AdminPage`; no search params.
- `src/components/admin/admin-page.tsx` (377 lines): role gate via `api.visitors.current`; `api.adminOperations.get` (paid work, recent checkpoints, last `ADMIN_RECENT_EVENT_LIMIT` = 50 provider calls with billing, reservations) loaded through `AdminQueryBridge`; header with the Paid work `Switch`; vertical `Tabs` with six local-state sections defaulting to `dossiers`; three `Dialog`s (paid-work reason, read-only dossier inspection, provider attempt).
- Sections: `AdminModels` and `AdminAgentModels` (`admin-model-configuration.tsx`, 761 lines, inline add/edit form at the top, model rows as bordered `section`s, `Refresh input profiles` since `141b98d`); `AdminDossierBrowser` (filters, paginated `listRunsPage` by purpose, withdraw `Dialog`); `AdminReservations` (restore `Dialog`, `listRestorableRunsPage`); `AdminProviderActivity` + `AdminProviderBilling` + `AdminProviderCallInspection`; `AdminReviewDecisions`; `AdminRunInspection` + `AdminExecutionJournal`; helpers `admin-list`, `admin-pager`, `admin-filters`, `admin-status-badge`, `admin-detail-disclosure`.
- No `Card` is used in admin; `Dialog` only in page, dossier browser and reservations.
- Backend facts available without changes: `adminOperations.get`, `listRunsPage({purpose})` (ordered by `updatedAt`, no status filter), `listRestorableRunsPage`, `inspectRun`, `listRunProviderCallsPage`, journal queries, `modelConfiguration.list` (`models[].status/compatible/enabled`, `assignments`, `agents`), `admin.restoreQuota`, `admin.withdrawDossier`, `adminOperations.setPaidWorkEnabled`, `modelConfigurationActions.prepare/initialize/refreshProfiles`.
- Tests: `src/__tests__/routes/admin-page.test.tsx`, `src/__tests__/components/admin/{model-configuration,execution-journal,provider-billing}.test.tsx`; browser: `src/__tests__/e2e/model-administration.spec.ts` (real local administrator admission, 1440/390 screenshots), `src/__tests__/e2e/native-journal.spec.ts`, `e2e/invocation-journal.spec.ts`, `e2e/run-workspace-separation.spec.ts`.

## Open decision (does not block Tasks 1–4)

- **Failed dossiers beyond the most recent page.** No query filters runs by execution status, and adding one needs an index (schema change). Plan default: the Overview reads the first page of `listRunsPage({purpose: "research"})` and labels the result "among recently updated dossiers". If the user wants a complete count, add an indexed read in a separate approved change before Task 2 ships. "Stuck" dossiers are not a condition until a rule for them is decided.

## Tasks

### 1. URL-addressable sections and the page frame

- Route file adds `validateSearch` for `{ section?: "overview" | "dossiers" | "models" | "activity"; dossier?: Id<"researchRuns"> }` (default `overview`); it still exports only `Route`.
- `AdminPage` keeps the role gate, skeleton and `AdminQueryBridge`; replaces the six-tab local state with section navigation bound to the search (`Tabs` horizontal on desktop, full-width scrollable on mobile, via typed `useNavigate`).
- Header slims to title and one-line purpose; the Paid work switch leaves the header (re-homed in Task 3).
- The reason dialogs (paid work, restore, withdraw) currently hard-code `12` in their gating and helper text; as each is moved (Tasks 3 and 5) it reads `MIN_AUDIT_REASON_CHARS` / `MAX_AUDIT_REASON_CHARS` from `@convex/resourcePolicy`, the server's owner.
- Tests (RED first, `admin-page.test.tsx`): unknown section falls back to Overview; selecting a section updates the URL; non-admin still sees the access-required state.

### 2. Attention model (presentation owner)

- New `src/lib/presentation/admin.ts` exporting `adminAttention(facts): AdminAttentionItem[]` where `facts = { paidWorkEnabled, models, assignments, agents, restorableCount, recentFailedRuns }` and each item is `{ kind: "paid_work" | "model" | "dossiers" | "reservations"; title; detail; action: { label; target } }`. Ordering: paid work, models, dossiers, reservations.
- Also exports `adminModelStatus(entry)` → `{ label: "Prepared" | "Needs refresh" | "Preparing" | "Preparation failed" | "Unavailable"; tone }`, the single owner reused by Overview and the model cards.
- Copy names agents through `agentName` and never shows codes.
- Unit tests in `src/__tests__/lib/presentation/admin.test.ts`: each condition alone, none (empty), an unassigned stale model produces no item, a disabled assigned model produces one.

### 3. Overview section

- `src/components/admin/admin-overview.tsx`: "Needs attention" `Card` list from `adminAttention`, each with its action (open the paid-work dialog, run `Refresh input profiles` in place, open Dossiers filtered/focused, open Dossiers' reservations). Empty: `Empty` "Nothing needs attention".
- Status cards: Paid work (state + switch → existing reason `Dialog`, moved from `AdminPage` into its own component), Models per agent (agent → model + status badge), Recent spend (from the 50 recent attempts already in `adminOperations.get`: confirmed cost total, unconfirmed count, failed attempts; labelled as recent).
- Refresh-in-place reuses the page loop now in `AdminModels`; extract it to a hook `useRefreshModelProfiles()` in `src/lib/workspace/` (single owner for Overview and model cards) without changing its behavior.
- Tests: rendered workflow through the shared harness: stale assigned model shows the item and refreshing calls `refreshProfiles` through all pages; paid-work stopped item opens the reason dialog; empty state.

### 4. Models & agents section

- Mechanical move first: split `admin-model-configuration.tsx` into `admin-models.tsx` (catalogue), `admin-agent-models.tsx` (assignments), `admin-response-control.tsx` (response-control settings), keeping tests green before any visual change.
- Then: each model a `Card` (label, model id, routing, `adminModelStatus` badge, one primary action by state: Refresh input profiles / Retry preparation / none), reasoning select and availability switches in the card body, `Edit configuration` and `Add a model` in a `Dialog` reusing the existing prepare flow and idempotency key handling. Agent assignments as `Item` rows inside one `Card`.
- Preserve: optimistic-free saves with `expectedRevision`, error copy, initialize empty state.
- Tests: update `model-configuration.test.tsx` selectors where structure changed; add: add/edit dialog submits the same `prepare` arguments; status badge per state.

### 5. Dossiers section with detail Sheet

- Merge `AdminDossierBrowser`, `AdminReservations` (restorable list) and `AdminReviewDecisions` under one section: dossier list (`Item` rows with company, owner purpose, readable status via `admin-status-badge`), filter bar kept, reservations and review decisions as secondary `Card`s.
- Dossier detail: `Sheet` driven by the `dossier` search param, replacing the inspection `Dialog`; content order: readable status and next action, then `AdminRunInspection`, provider calls, `AdminExecutionJournal` as disclosures. Footer actions Restore quota / Withdraw, each in its existing reason `Dialog` (moved, not rewritten), enabled from `canWithdraw` / restorable state.
- Provider attempt detail stays a `Dialog` above the Sheet (stacking via `ui-layers.ts`).
- Tests: opening a dossier sets the URL and renders the Sheet; withdraw and restore call the same mutations with the trimmed reason and stay disabled below `MIN_AUDIT_REASON_CHARS`; reload with `dossier` reopens the Sheet. Update `execution-journal.test.tsx` only if its host changes.

### 6. Activity & spend section

- `AdminProviderActivity` rendered as a `Card` with the spend summary (same helper as Overview) and the attempt list as `Item` rows (service, status badge, cost line from `AdminProviderBilling`, time); attempt detail `Dialog` unchanged.
- Tests: `provider-billing.test.tsx` unchanged; add one rendering test that failed and unconfirmed attempts are counted in the summary.

### 7. Cleanup and references

- Delete the now-unused tab code and any helper left without callers (`admin-list`/`admin-pager` only if unused).
- Update `src/components/README.md` admin entries.
- DESIGN.md: one short "Administration" paragraph under Components recording the Overview + sections composition and that admin reuses the shared primitives (approved by the accepted brief). Run `pnpm docs:check` and `pnpm design:check`.

## Verification

- Per task: the focused Vitest files named above, RED observed before GREEN for Tasks 1–5 functional changes.
- After Task 7: `pnpm exec tsc --noEmit -p .`, `pnpm lint`, Vitest over `src/__tests__/components src/__tests__/routes src/__tests__/lib`.
- Browser gate (before Task 1 for the baseline, after Task 7 for the result): extend `src/__tests__/e2e/model-administration.spec.ts` or add `src/__tests__/e2e/admin-overview.spec.ts` with real local administrator admission at 1440 px and 390 px: Overview empty and with a stale model (internal fixture behind `E2E_FIXTURES_ENABLED`, removed at teardown), section navigation by keyboard and URL reload, dossier Sheet open/close with focus return, withdraw dialog reason gating (cancel, no submit), reduced motion, no console errors and no raw codes. Run `native-journal` and `invocation-journal` specs since the journal host moves.
- No backend change, so no watcher push is required unless the open decision adds a query.

## Sequence

1 → 2 → 3, then 4, 5 and 6 independently (each lands with its tests), then 7 and the final browser gate. Ship order for the user: Overview + Models first (Tasks 1–4), then Dossiers and Activity.

## Follow-up decisions (2026-11-16, implemented the same day; browser specs updated but not rerun)

- **Dossier detail:** provider receipts and the execution journal become two tabs inside the opened dossier.
- **Models & agents saving:** every change goes through a form with one Save and one Cancel; nothing applies before Save. Catalogue rows become a read-only summary (name, state, analyst availability, Edit). A model's settings (OpenRouter ID fixed after creation, display name, default reasoning, available to analysts, offered in the composer) are edited in one dialog; Save runs the OpenRouter check when the model is new or its identity changed, replacing the visible "Prepare model" step. States read Ready, Needs update, Checking and Check failed; the profile refresh becomes an Update action shown only on Needs update. Agent assignments and the reply check each become one form with Save and Cancel ("Load current settings" is removed). Revision conflicts show one reload message. The audited paid-work switch keeps its reason dialog.

- **Implemented variant:** at the user's request the catalogue keeps its inline row fields; row edits are staged and apply only on Save changes (Cancel discards). The model dialog edits the display name and saves through the OpenRouter check. Provider attempt details open in a side panel. Column headings and model states carry contextual explanations, and the profile refresh action reads "Update model".
