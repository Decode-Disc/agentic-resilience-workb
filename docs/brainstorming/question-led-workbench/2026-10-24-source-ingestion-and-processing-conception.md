# Source Ingestion and Processing: Retained Conception

## Status

Recorded on 2026-10-24. This document describes how Sources prepares documentary material. The [global conception](2026-10-23-question-led-workbench-conception.md#cooperation-and-documentary-complement) defines when this work is requested and how it cooperates with Investigation.

## Purpose and Simple Workflow

Turn dispersed sources into structured, inspectable, reusable documentary material suited to the requested research needs.

```text
COLLECT SOURCES
      |
      v
READ AND CHECK THEIR CONTRIBUTION
      |
      v
ORGANIZE USABLE MATERIAL
```

Acquisition, normalization, qualification, comparison, selection, and recovery are internal work within these three principal stages.

## Interface and Place in the System

The caller requests prepared material and receives its outcome without coordinating discovery, capture, retries, qualification, or selection. The source matrix is the detailed inspection view. The exact interface and result schema remain to be designed.

| Direction | Information crossing the interface |
| --- | --- |
| Input | Company identity, research needs and question context, applicable source-selection rules and resource allowances, supplied public references, and existing material eligible for reuse. The request may concern initial preparation or a targeted complement. |
| Output | Prepared documentary material with exact provenance, available passages, qualified contributions, permitted uses, limitations, remaining gaps, and an explicit preparation outcome. |
| Progress and inspection | Actual advancement, inspectable source details and control results, and any exception that cannot be handled within the request. |

Sources returns documentary material and its usage conditions. [Investigation](2026-10-24-investigation-conception.md) handles its analytical use. A request covering several questions reuses the same source identities and captures rather than creating a separate collection for each question.

## Internal Work by Principal Stage

### Collect Sources

Sources translates the requested needs into a discovery plan within the supplied allowances. Initial preparation combines a shared documentary foundation with searches targeted at the framed questions. A complement request focuses discovery on the supplied needs and existing material. Company context remains useful even when a contribution does not answer a particular question. The exact foundation, query templates, and ranking criteria remain to be specified.

- Integrate the initial availability check into the planned discovery. Absence of an initial filing, investor-relations address, or analyst reference does not itself trigger a justification request before those searches occur.
- Consider supplied public references and eligible existing material alongside newly found candidates. Reuse matching material rather than repeat completed work without reason.
- Preserve candidate identity, discovery context, publisher or company linkage, and relevant metadata. Detect straightforward duplicates without claiming that different URLs establish independence.
- Keep discovery outcomes distinct: a completed search with no result differs from an unavailable search. A candidate is not evidence of successful reading, useful content, or factual support.

New and supplied references pass through the same preparation controls.

### Read and Check Their Contribution

The system acquires and prepares bounded content, preserving the representation actually consulted, its provenance, and reproducible passage references. It qualifies what that material contributes and the limits of using it. Source text is untrusted material, not an instruction channel for execution.

- Preserve source and content identity, retrieval information, exact passages, and appropriate locators. Missing or corrupt retained content cannot be silently replaced by another version.
- Identify the company's relationship to the document, its purpose, relevant periods, positive documentary contributions, and restrictions. A partial reading cannot establish absence from the whole document.
- Distinguish source statements, attributed arguments, projections, uncertain material, and contextual content. Document kind, publisher confidence, and an exact quotation do not certify truth.
- Compare relevant contributions with other captured material where the comparison is meaningful. Preserve differences in period, scope, definitions, units, assumptions, possible conflicts, and inconclusive outcomes; restrictions on one contribution need not erase other useful contributions.
- Report what the examined material covers, what remains undocumented, and whether the limitation comes from missing content, partial reading, or failed preparation. A requested complement passes through the same acquisition, qualification, and comparison work.

Documentary comparison checks the relationship between captured contributions, such as whether an attributed argument's premises match the available primary passages. Its conclusions concern the material actually examined; it does not decide the economic interpretation of a research question. Reporting a documentary gap does not itself schedule further research.

Reading, qualification, and comparison advance autonomously. Their detailed results remain inspectable; a routine limitation is not automatically a request for analyst intervention.

### Organize Usable Material

Sources consolidates the prepared material and selects sources under the supplied rules. Selection must be explainable and preserve the differences between inclusion, reading availability, documentary contribution, and permitted analytical use.

- Make source identity, prepared content, useful passages, contributions, selection reasons, comparison results, and limitations available together.
- Preserve relevant opposing material and remaining gaps rather than filling a source-count target or making the collection appear complete.
- Keep an unavailable reading or qualification visible. It does not prove irrelevance and cannot supply factual support merely because its source is included.
- Supply the exact prepared material to downstream work with the restrictions attached to its contributions.
- Expose a meaningful preparation outcome, including partial or operationally blocked work. Completed work, unfinished work, and justified lack of documentary material remain distinct.

The module can finish a preparation request with disclosed documentary gaps. Its outcome describes the requested documentary work; dossier completion is defined in the [global conception](2026-10-23-question-led-workbench-conception.md#appraisal-grouped-review-and-completion).

## Autonomy, Inspection, and Intervention

All three principal stages advance autonomously within the request. The analyst can inspect sources, passages, contributions, restrictions, selection reasons, and actual progress without opening each detail page before work advances.

Routine recovery preserves completed readings and cumulative allowances. An unavailable source can lead to an eligible alternative within the request or an explicit limitation. An integrity failure blocks the affected documentary use. Independent source preparation can continue where it does not depend on the unresolved issue.

When the request cannot be fulfilled within its rules or allowances, Sources exposes the affected work and consequence to the surrounding workflow. The [global intervention policy](2026-10-23-question-led-workbench-conception.md#launch-mandate-and-contextual-intervention) determines which exceptions need a human decision. Source inspection must make it possible to challenge a selection or identify a reading problem without requiring the analyst to manage execution.

## Design and Verification Direction

Sources hides discovery, capture, normalization, qualification, comparison, selection, and recovery behind a request for prepared material. These operations belong together because a consumer needs a coherent result with its provenance and restrictions, rather than a sequence of internal calls to orchestrate. The three explanatory stages do not require three technical wrappers.

Proposed verification: exercise the preparation interface with a useful source, a partial reading, opposing material, and a failed acquisition. Verify reproducible passages, explicit limitations, eligibility for the requested use, reuse of completed work, and continuation of independent work. Submit a targeted request against existing material and verify that its outcome preserves the same documentary controls and cumulative allowances. These checks remain to be designed and run; source counts and schema validity alone do not establish useful preparation.

## Open Decisions

- Define the documentary foundation, query planning and selection criteria, and how a preparation request expresses its needs and allowances.
- Specify source-module outcomes and executable completion checks, especially interrupted reading, partial availability, exhausted allowances, and missing technical capability.
- Specify the prepared-material result, including contribution identity, source and capture versions, reproducible locators, restrictions, and gaps.
- Define the criteria for meaningful documentary comparisons and the handling of conflicting or inconclusive material.
- Decide the source-matrix composition, including how source details, reading availability, contributions, restrictions, and preparation outcomes are inspected together.
