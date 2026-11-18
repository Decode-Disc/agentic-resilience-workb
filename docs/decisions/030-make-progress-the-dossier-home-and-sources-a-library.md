# ADR-030: Make Progress the Dossier Home and Sources a Library

## Status

Accepted on 2026-11-18. [PRODUCT](../../PRODUCT.md#operating-context) owns the analyst-facing behavior, [DESIGN](../../DESIGN.md) owns the composition and [the roadmap](../ROADMAP.md#phase-6--framing-and-controlled-transition) records delivery. The working sequence is in [the implementation plan](../../.implementation-plans/2026-11-18-dossier-progress-home-and-sources-library.md).

The same day the home was renamed Overview, because the view holds the conversation and every stage rather than progress alone; the URL key is `overview` and `section=progress` links open it. Below, Progress names that view as first decided.

## Context

A framed dossier had two names for one place. The dock called it Research, the URL called it `section=progress`, and a View progress action inside it opened a second Progress page that repeated the stage overview and added the run timeline. Sources then opened on a preparation screen, with the source matrix and the reader as further views, so the analyst met three Sources destinations before reaching a document. The coverage result answered "what did Sources hand to Investigation", a question about the dossier stage, but it lived in the document section.

## Decision and rationale

- **Progress is the dossier home.** The conversation stays the main surface. Its stage panel states the research question, a stepper of the four dossier stages and the current stage's work. One name, one URL and one place remove the Research and progress-page ambiguity.
- **History replaces the progress page.** Recorded steps open in a collapsed disclosure inside the stage panel and load only when opened. The former `detail=timeline` link stays valid and opens History, so existing links keep working.
- **The coverage result moves to the stage panel after handoff.** Needs against questions explain the stage outcome. They replace the document lanes once Sources hands off, and Open sources leads to the documents.
- **Sources is the document library.** It opens on the source matrix, and the reader's trail returns to Documents. The preparation screen is removed.

## Rejected alternatives

- **Progress as a drawer over the conversation.** This kept the conversation full width, but it hid the stage outcome behind an action and recreated the extra destination this change removes.
- **Sources with two lenses: coverage and documents.** This kept the original design closest, but the analyst still had to choose a view before seeing a document, and the stage outcome stayed away from the stage.
- **Dropping the coverage grid.** This simplified Sources, but it lost the only view that shows unprepared needs per question. The analyst needs that view to judge whether Investigation can proceed.

## Settled implementation choices

- D1, stepper: keep the Framing, Sources, Investigation and Synthesis stepper under the question. It comes from the original design and orients the stage panel; unavailable stages stay visible and inert, as in the dock.
- D2, reader: keep the existing full reader and give it a single Documents return. A side-panel reader over the matrix is a separate, later change.
- D3, coverage navigation: a document in the Progress coverage result opens the reader in Sources through the existing `need` deep link, and the reader returns to Documents.

## Consequences

The retrieval-failure alert that the former progress page showed is not yet carried into the stage panel; this is a known gap. Browser qualification of the new composition runs in CI and is pending. Historical plans that describe View progress or the preparation screen carry supersession notes.
