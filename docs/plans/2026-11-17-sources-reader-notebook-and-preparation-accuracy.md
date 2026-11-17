# Sources Reader Notebook and Preparation Accuracy Plan

**Goal:** Make the live Sources screens truthful and navigable: correct the figures in "How preparation ran", make documentary needs readable and lead directly to their documents, order the source matrix by contribution, and replace the three-pane reader with a viewport-bounded notebook reader whose numbered citations, notes and stepper let the analyst move between passages and what they establish.

**Scope:** Presentation of the Sources-protocol path (`sourcesProtocol: "sources_mission_v1"`) and its gallery fixtures. Two read-only additions to `convex/sourcesWorkspace.ts` queries. Excluded: schema changes, mission behavior, the corpus-approval fallback path, Investigation, the inventory sheet.

**Accepted decisions (2026-11-17 conversation):** reader model "margin notes" with numbered markers; on narrow screens notes open on demand (option 2); one control shows or hides all notes; needs clamp to two lines and expand in place; expanding a need lists its documents and each opens the reader; the source matrix sorts by contributions.

## Implementation status

Implemented on 2026-11-17 with the four proposed defaults (capture labels renamed; actions in a document footer and observed links collapsed after the last passage; one continuous document replacing the excerpt pager; notes visibility kept for the session). Deterministic tests pass; the rewritten gallery browser specs are pending the GitHub Quality workflow. The backend query change was pushed to the running local deployment with `pnpm convex:sync`. The live dossier was not inspected in a signed-in browser by the agent.

Follow-up refinement, 2026-11-17: the reader opens on its first citation with uncited paragraph runs folded (Full text restores them); notes keep one position per width; question chips jump to their first citation; follow-ups moved to a header Follow up menu and the footer was removed; the needs map caps the need column and its mark tips no longer repeat the need; the matrix tints its Reading and Contribution columns; the inventory moved from a floating dock to the workspace section bar (PRODUCT.md and DESIGN.md updated). No backend change.

Second refinement, 2026-11-17: needs show an explicit Show full need control and list their documents in the Outcome column; the matrix weights Reading and Contribution differently with a dashed rule; unfolded uncited runs fold again; below 1280 px an explicit note line opens notes and scrolls to them; the original opens from an external-link icon on the title line; a Conflicts filter, a source list Go to conflict link and `focus=conflict` reach conflicts directly; a shared QuestionTag and an active-question line show full question text; note text wraps long strings. No backend change.

## Current behavior and evidence

- **Live consumer:** `src/components/workspace/sources/connected-sources.tsx` reads `api.sourcesWorkspace.overview`, `listSources` and `getSource`, and maps them through `src/lib/presentation/sources.tsx` (`sourcesPreparationView`, `sourcesMatrixRow`, `filterSourcesRows`, `sourcesReaderGroups`, `sourcesReaderDocument`) into `src/components/workspace/sources/sources-screens.tsx`.
- **Preparation figures** are computed from real rows in `convex/sourcesWorkspace.ts` (`overview`, lines ~403–515). Verified against dossier `k97ffmp1123pwtp8r4npe32d3x8j9r92` (9 sources: 5 SEC, 4 web; run `sources_prepared`):
  - The reading bar counts `full`, `partial` and `unavailable` only; 4 `not_captured` candidates disappear between "9 collected" and "5 read".
  - `full` means a complete capture (`readingCompleteness`/`representationCompleteness`), not complete agent reading (TECH: "a complete capture is not proof of complete agent reading"); the label "Full reading" overstates it, and the reader repeats it as "full reading · cited excerpts".
  - "Documentary controls" tally contributions of every controlled qualification, including documents not retained, next to document counts without a unit.
  - `organize.uses` labels a documentary conflict as role "Opposing" and labels "not retained" with the "Excluded" badge (reserved for the analyst's exclusion); not retained mixes unread leads with read documents that contributed nothing usable.
  - Stage 1 shows the fixed subtitle "Planned discovery within the allowance"; a family is "found" whenever a row exists, and searched-without-result families never appear.
- **Needs:** `overview.needs[]` carries `information` (often a paragraph), `questionIds`, outcome, counts and `unfinished` reasons, but no document identities. `DocumentaryNeeds` (`src/components/workbench-ui/documentary-needs.tsx`) renders the full text and repeats an identical unfinished reason on every row.
- **Matrix:** `filterSourcesRows` keeps backend order; `SourceMatrix` has no sort.
- **Reader:** `SourcesReaderScreen` renders `SourceReader` in three columns at ≥1280 px, two panes with tabs at 768–1279 px and a drawer below. Columns grow with the document (the page reaches several screen heights). One excerpt (`ReaderPage`) shows at a time behind a pager; contributions live in a separate right pane; the header packs title, pager and Original into one row. `SourceReaderList` has static groups and no filter.
- **Concurrent work:** the working tree holds another session's uncommitted changes in `connected-sources.tsx`, `src/__tests__/components/workspace/connected-sources.test.tsx`, `convex/sourcesMission.ts`, `convex/domain/sources.ts` and related files. Tasks touching them start only after that work is committed, or edit on top of it without reverting anything.

## Decisions still open (defaults proposed)

1. **Reading label copy:** rename "Full reading" → "Complete capture" and "Partial" → "Partial capture" in `readingLabels` (matrix, filter options, reader list, reader meta, preparation). Default: rename.
2. **Home for reader actions and observed links once the right pane goes:** default — Request a targeted check and Challenge this selection in a footer bar of the document pane; "Links seen in this document" as a collapsible section after the last passage.
3. **Excerpt pager:** default — render all excerpts in one continuous document with section headings; the citation stepper replaces the excerpt pager.
4. **Notes visibility memory:** default — kept while the analyst changes source within the session (screen state), not persisted to storage.

## Tasks

### 1. Matrix ordered by contribution

- **Files:** `src/lib/presentation/sources.tsx` (new `sortSourcesRows`), `connected-sources.tsx` (apply before `filterSourcesRows`), gallery `sources-fixture-data.tsx` order.
- **Rule:** contribution total descending, then retained before pending, not retained and excluded, then title. Rows without contributions keep that membership order at the end.
- **Check:** RED/GREEN unit test in `src/__tests__/lib/presentation/sources.test.ts`.

### 2. Accurate "How preparation ran"

- **Query (`overview`):** add `reading.notCaptured`, and split `organize` into `notRetainedRead` and `notRetainedUnread`; scope `contributions` badges to retained documents or expose both tallies (`contributions` all, `retainedContributions`). Convex test in `src/__tests__/convex/sources/` asserting the 9-source shape (5 captured, 4 not captured, 4 retained).
- **Presentation:** reading bar and legend include "not captured"; counts carry units ("36 contributions supported"); conflict row uses its own role "Documentary conflict"; not retained shows "N read, nothing usable" and "N leads not read" with neutral badges, "Excluded by you" only for analyst exclusions; stage 1 subtitle derives from searches and acquisitions instead of fixed text.
- **Component:** `SourcesPreparationView` gains `collect.description`, the `conflict` and `lead` roles, and the `notCaptured` reading count; `ReadingBar` (`glyphs.tsx`) gains a "not captured" segment owned by `readingColors`.
- **Check:** presentation unit tests for each label; copy contains no raw enum values.

### 3. Readable needs that lead to their documents

- **Query:** `overview.needs[].sourceIds` from the handed-off outcome (falling back to served contributions before handoff). Convex test.
- **`DocumentaryNeeds`:** label clamped to two lines; a disclosure button in the row header (`aria-expanded`) shows the full text and the need's documents (title, contribution count, reading glyph). Each document calls `onOpenSource(sourceId, needId)`. A `notice` prop shows a reason shared by several needs once above the table; rows keep only their own distinct reason.
- **Navigation:** `WorkspaceSearch` gains optional `need`; the reader opens on the first passage cited for that need (`initialNeedId` → first matching contribution target). Unknown `need` values are ignored.
- **Check:** component interaction test (expand, keyboard, open source callback) and gallery spec update.

### 4. Viewport-bounded reader shell

- **`SourcesReaderScreen`:** ≥768 px the workspace height is `100dvh` minus the frame header and dock reserve; list and document panes scroll independently (`ScrollArea`), the page itself no longer grows with the document.
- **`SourceReaderList`:** filter field (title and host, case-insensitive) above groups rendered with `Collapsible`: Retained open by default, other groups closed unless they contain the selected source; group counts stay visible when folded; empty filter result uses `Empty`.
- **Header:** two rows — full-width title; then capture meta, citation stepper, Notes control, question chips and Original.
- **Check:** browser inspection at 1440, 1280, 1024 and 390 px in both themes; filter and group behaviour in a component test.

### 5. Notebook reader with numbered citations

- **Model (`SourceReader`):** citations are cited passages numbered in document order across all excerpts; a passage cited by several contributions has one marker and one note listing them; contributions without a resolvable passage form an "Unplaced notes" block before the text. Retire the `tabs` layout and the separate contributions pane.
- **≥1280 px:** notes sit in a margin column beside their passages, shown by default; hiding them leaves markers only and widens the text.
- **<1280 px (and the drawer):** notes open inline under their passage, hidden by default; a marker or cited passage toggles its note; "Show all notes" expands every note.
- **Stepper:** "‹ Citation n of N ›" scrolls to the passage, opens its note even when notes are hidden, and moves focus to the marker; j/k and ↑/↓ work while focus is inside the document and not in a text field; the current number follows the passage in view (IntersectionObserver).
- **Question chips:** narrow notes and the stepper to citations serving that question; other markers recede.
- **Motion:** note open/close uses the shared disclosure motion; the existing passage-arrive outline marks the focused passage; reduced motion removes movement and keeps state changes.
- **Preserved:** observed links, Request a targeted check, Challenge this selection, Open original, conflict and forecast highlights, quiet uncited passages, drawer focus return.
- **Check:** RED first with a component interaction test (stepper order, open-on-step while hidden, toggle all, keyboard j/k ignored in inputs, question narrowing). Gallery Playwright spec rewritten for the notebook at desktop and 390 px with touch.

### 6. References and cleanup

- Update `DESIGN.md` (Sources reader and preparation passages, motion) and `src/components/README.md`; remove the retired `tabs` layout code and its styles; delete tests that asserted the removed right pane.
- **Check:** `pnpm docs:check`, `pnpm design:check`.

## Sequence

1 → 2 → 3 (independent of the reader, can ship first) → 4 → 5 → 6. Tasks 2 and 3 edit `convex/sourcesWorkspace.ts` and `connected-sources.tsx`; schedule them after the concurrent session's changes land.

## Verification

- **Local, deterministic:** Vitest for presentation helpers, Convex tests for the query additions, component interaction tests for `DocumentaryNeeds`, `SourceReaderList` and the notebook reader; `tsc --noEmit` and Biome on touched files. After backend edits, confirm a successful watcher push before exercising behaviour.
- **Browser:** gallery Playwright specs run in the GitHub Quality workflow and stay pending until that run succeeds. Local browser runs only for a focused reproduction, stated beforehand.
- **Visual:** desktop and 390 px inspection of the live dossier `k97ffmp1123pwtp8r4npe32d3x8j9r92` and the gallery, both themes, reduced motion, keyboard path and console errors.
- **Not claimed:** documentary quality of the live preparation; the fixes change how figures are labelled, not what Sources produced.
