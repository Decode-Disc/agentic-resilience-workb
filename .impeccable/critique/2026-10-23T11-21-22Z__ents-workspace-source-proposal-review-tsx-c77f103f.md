---
target: Source preparation and source review UI improvements
total_score: 28
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 3
target_identity: "file:/home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/src/components/workspace/source-proposal-review.tsx"
target_fingerprint: "sha256:b8c313a6fca3431c14576f082989770bcf4eb4f1ba62720f5528a92bf2624659"
target_path: /home/abdwhb/projects/decoding-discontinuity/agentic-resilience-workbench-proto/src/components/workspace/source-proposal-review.tsx
timestamp: 2026-10-23T11-21-22Z
slug: ents-workspace-source-proposal-review-tsx-c77f103f
---
Method: dual-agent (A: /root/critique_source_design · B: /root/critique_source_browser)

# Source review critique, 2026-10-23

## Assessment and scope

The current coverage rail, source carousel and default source-details reader form a coherent analyst workspace. Preserve that composition. The remaining high-value refinements concern decision visibility and document identity. This is an Operate surface. It should make inclusion, source reading and documentary coverage understandable without treating imperfect preparation as failure.

Current public illustrative renders were inspected at 1440×1000, 1280×720 and 390×844. Recent protected fixture screenshots under /tmp/source-review-ui-fix-nb4g111n/final-browser were reviewed as historical local evidence. They postdate the target component's last modification at inspection. Neither assessment opened or mutated a protected live dossier. The prototype has empty coverage requirements and unprepared source readings. Prepared quotations, comparison notes and a limitation-heavy reader therefore remain unverified visually in this run. The roadmap's latest recorded ServiceNow observation remains 48 sources with no associated preparation or captures; this critique does not refresh that runtime observation.

## Design specificity and strengths

The interface fits evidence preparation rather than a generic dashboard. Coverage, corpus membership and one selected reader are distinct regions. Violet selection and teal inclusion have distinct meanings. The previous preview-first empty state has been replaced by source details as the default.

- Decisions are beside the selected source, with the original document accessible.
- Coverage distinguishes included sources from potential matches and retains contextual recovery actions.
- Unprepared readings and illustrative data are disclosed. Mobile secondary actions use a compact popover while approval remains accessible.

## Priority issues

1. P1: Closed mobile Coverage exposes no summary of limited or unestablished requirements, while approval remains prominent. Preserve the accordion and add a concise status summary derived from the existing coverage projection. Gaps remain non-blocking. Source: src/components/workspace/source-coverage-rail.tsx, mobile trigger around line 117. Suggested command: impeccable clarify.
2. P1: Inactive Needs attention and Alternatives groups display icons and counts without their labels. Accessible names and tooltips help keyboard users, but touch users must activate a group to learn its meaning. Expose the three names with a consumer-selectable treatment that preserves the shared tab behavior. The reader's Alternative badge also labels an excluded Needs attention source, creating a separate membership/group ambiguity. Prefer a membership label such as Not included when that is the actual concept. Sources: src/components/ui/discrete-tabs.tsx around line 302, src/components/workspace/source-proposal-review.tsx around line 918, src/components/workspace/source-context-panel.tsx inclusion badge. Suggested command: impeccable clarify.
3. P1: The reader omits publication date even when publishedAt is available. Generic annual-report titles do not establish the relevant period. Display publication date and reporting period when each is known; never infer reporting period from publication date. Unknown values must remain explicit. Source: src/components/workspace/source-context-panel.tsx around line 137. Suggested command: impeccable clarify.
4. P2: Carousel arrow hit regions measured 28×136 CSS pixels on mobile. Preserve the slim visual strips while providing wider non-overlapping touch targets approaching 44px. This is a touch-comfort recommendation, not a demonstrated WCAG failure. Source: src/components/workspace/source-proposal-carousel.tsx around lines 136 and 207. Suggested command: impeccable adapt.

## Nielsen heuristic scores

These are qualitative design judgments on the observed surface, not a preparation accuracy score or protected-workflow acceptance.

| Heuristic | Score | Evidence |
| --- | --- | --- |
| Visibility of system status | 3/4 | Inclusion and reading status are explicit; closed Coverage hides its status. |
| Match with the real world | 3/4 | Analyst terminology fits; document dates are absent. |
| User control and freedom | 3/4 | Escape returned focus and navigation works; durable decisions were not exercised. |
| Consistency and standards | 3/4 | Coherent shared regions; Alternative is ambiguous in Needs attention. |
| Error prevention | 2/4 | Corpus checkpoint exists, but gaps and document age can be overlooked. |
| Recognition rather than recall | 2/4 | Inactive group names and mobile coverage context require discovery. |
| Flexibility and efficiency | 3/4 | Carousel ArrowRight works; inspection, adjustment and search affordances remain. |
| Aesthetic and minimalist design | 3/4 | Restrained composition; long raw URLs use reading space. |
| Error recognition and recovery | 3/4 | Readable unavailable/retry copy in source and fixture evidence; recovery not exercised. |
| Help and documentation | 3/4 | Contextual explanations and recommendation disclosure remain accessible. |
| Total | 28/40 | Good foundation within the stated observational limits. |

## Cognitive load and emotional journey

The main review task is better grouped. Cognitive load remains moderate because the mobile analyst must open Coverage and remember its implications, while two group names are hidden. Approval is more visually immediate than the unresolved context informing it. The reassuring moments are persistent source identity, original-document access and the nearby inclusion action. The weak moment is encountering Included and approval alongside Reading not prepared. This accurately disclosed capability limit still prevents experiencing the intended preparation benefit.

## Personas and minor observations

An experienced analyst is slowed by missing periods when comparing similar documents. A first-time evaluator cannot confidently decode icon-only inactive groups. A mobile analyst benefits from zero page-level horizontal overflow at 390px but must reveal coverage status and use narrow navigation regions. The full raw URL repeats Open original and pushes useful reading downward; a compact provenance link with full details available would save space without concealing provenance.

## Deterministic and browser evidence

The source detector returned zero findings across six scoped components. The mobile accessibility audit reported zero violations and two incomplete checks: ARIA support on an avatar span and contrast on overlapping elements. These incomplete checks are not confirmed failures or full accessibility acceptance. No application page errors were reported. The initial keyboard sequence and carousel/popover interactions were checked, not the complete protected journey.

Current screenshots: /tmp/critique-design-desktop-full-20261023.png, /tmp/critique-design-mobile-20261023.png and /tmp/impeccable-source-browser-mobile-reader-20261023.png. Independent technical report: /tmp/impeccable-source-browser-20261023.md. Task screenshots are local temporary evidence, not durable attachments to this snapshot.

## Direction for the next discussion

Preserve the current visual direction and finish decision clarity before another layout redesign. Assess the same reader with useful prepared quotations, a limited reading and an unavailable reading across different document families before judging preparation usability. That assessment requires a separate authorized way to obtain representative data and does not authorize paid calls or runtime activation here.

Priority question: focus next on source/coverage decision clarity or mobile reading density? Scope question: retain the composition with targeted refinements, or also revisit the mobile stacking within that same design direction? This critique authorizes no implementation.
