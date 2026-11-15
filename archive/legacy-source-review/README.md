# Legacy source review (retired)

Retired on 2026-11-15 at the user's request. These files are kept verbatim for reference; they are not built, linted, typechecked or tested, and nothing in the application imports them.

## What was retired

The corpus-approval source review used by dossiers prepared without the Sources mission: the overview with coverage rail and proposal carousel, the adjustment board, candidate inspection with master list, source details and preview, targeted coverage searches, preparation status and recovery, approved-revision banner and the evidence-sufficiency checkpoint. The `/prototype/source-review` page and the component, hook, route and browser tests that exercised these owners are retired with them.

Paths under this folder mirror their original location in the repository. The files are identical to commit `6c6d1d1` (`git show 6c6d1d1:<original-path>`), except `src/__tests__/routes/run-workspace.test.tsx`, `src/__tests__/routes/run-route-component.test.tsx`, `src/__tests__/routes/source-review-search.test.ts` and `src/__tests__/components/workspace/analyst-copy-safety.test.tsx`, which are copies of the full files whose legacy cases were removed or rewritten in the live suite.

## Why

New research starts run only through the Sources mission, so the corpus-approval path has no new dossiers and its interface is no longer maintained. The current Sources section is `src/components/workspace/sources/connected-sources.tsx`; product and technical contracts are in `PRODUCT.md` and `context/TECH.md`.

## What remains in the application

The Convex corpus-review backend (corpus revisions, proposals, decisions, approval, legacy preparation and evidence sufficiency) is not part of this archive. Historical test and evaluation dossiers and the evidence-matrix showcase still use it; its removal is a separate cleanup.
