# Native task skills and document dates

Date: November 19, 2026. Status: accepted design; implementation and semantic improvement are not established. The user accepted on-demand native Pi skills, their integration and versioning, the date contract, the two task methods and the validation strategy. Current technical obligations belong in [TECH](../../../context/TECH.md#native-task-skills-and-dated-observations); delivery status belongs in [ROADMAP](../../ROADMAP.md#phase-6--framing-and-controlled-transition). This dated record preserves the rationale and scope of those decisions.

Implementation status, November 19, 2026: the accepted mechanisms and deterministic/local runtime checks are recorded in the [verification report](../../verification/2026-11-19-native-task-skills-and-document-dates.md). This supersedes the planning-time pending-implementation status; semantic improvement remains unqualified.

## Destination and boundaries

Enable Workbench to propose a faithful, useful research program and Sources to prepare useful documentary contributions through illustrated task methods, supplied using Pi's existing skill capabilities. Correct the demonstrated weakness in date presentation alongside the methods. Preserve the [product workflow](../../../PRODUCT.md#operating-context), explicit Start research, analyst authority, provenance controls and the existing division between documentary preparation and economic judgment.

The scope is two initial runtime skills, their native loading and reading integration, replacement of corresponding method instructions, explicit document-date presentation, and technical and semantic validation. Review transport is a separate user-owned task. This design introduces no new semantic approval controller, model-routing policy, general filesystem, skill marketplace, administrative skill editor or replacement execution engine. It authorizes neither production implementation nor a paid qualification campaign.

## Verified foundation

The [provider-input audit](../../verification/2026-11-19-framing-harness-requalification.md#follow-up-provider-input-chronology-audit) compared the five CCC Balanced OpenRouter generations in Arize with local relay captures. Message roles and contents matched. The analyst timestamp and later search dates were available before the write, and observable assistant messages correctly distinguished the dates. The false latest-found claim already appeared in the provider's `adjust_framing` arguments and survived unchanged in the stored scope. This locates the contradiction in generation without proving why the model made that choice or excluding an influence from presentation and instructions.

Both adopted CCC readings lacked structured publication and event dates despite visible datelines. The existing reader preserves candidate metadata and extracts only selected explicit date forms. One missed release uses an abbreviated month; the other uses a Business Wire dateline. The undated-support case separately adds a workflow-changing premise to an analyst-based conditional hypothesis. It remains conditional, but the analyst excerpt does not establish that premise.

Code inspected includes [Workbench's definition](../../../convex/domain/workbenchAgent.ts), [Sources' definition](../../../convex/domain/sourcesAgent.ts), [framing provenance](../../../convex/domain/framingProvenance.ts), [public-context reading](../../../convex/workbenchPublicContextActions.ts), [public-context contracts](../../../convex/domain/workbenchContracts.ts), [source metadata](../../../convex/domain/sourceRetrievalPolicy.ts), [agent definitions](../../../convex/execution/agentDefinition.ts), [native execution](../../../convex/integrations/piMission.ts), [model input](../../../convex/integrations/modelInput.ts), and the installed Pi public APIs and implementations. Workbench currently receives a phase method and a short conditional example; Sources receives procedural and contract instructions. Neither binding exposes a task-skill catalogue or resource-reading operation.

Installed runtime packages are Pi Durable/Pi AI 1.4.0; Pi Coding Agent 1.5.0 is already a development dependency for evaluation. Pi Coding Agent publicly exports `loadSkills`, `formatSkillsForPrompt` and native reading tools. Pi Durable publicly exports its native `createReadTool`. These are distinct package capabilities: using native skills does not require replacing the durable conversation runtime with a coding-agent session.

Three temporary, model-free probes exercised the actual installed APIs: native discovery and catalogue formatting with defaults disabled; native Pi Durable reading of a skill and an annex on temporary local files; and native Pi Coding Agent reading through its public custom file operations from an immutable in-memory resource map, including paged reading and refusal of an unadmitted path. All those checks passed. They do not establish complete Convex integration, deployment, restart or compaction behavior. An optional isolated bundle probe did not execute because `esbuild` was not resolvable from the attempted import locations; no dependency was installed to bypass that prerequisite. Packaging remains an implementation acceptance check. Convex's [local deployment documentation](https://docs.convex.dev/cli/local-deployments) also makes clear that local Node filesystem access is not proof of portable deployment behavior.

## Alternatives and decision

| Approach | Mechanism and structural distinction | When it is useful | Failure condition |
| --- | --- | --- | --- |
| Native on-demand consultation — accepted | Publish the mission's native skill catalogue and let the model read the applicable method and annexes during execution. Content enters context when needed. | Substantial worked examples and varying task needs without permanently loading every reference. | Repeated omission of needed skill consultation prevents useful results. |
| Initial method loaded systematically — not selected | Place the phase's method in native context before the first decision; keep annexes available through native reads. Selection moves to mission preparation. | Reliable availability of a short method matters more than initial context size. | Methods become large or numerous enough to burden every turn. |
| Entire method composed before execution — not selected | Discover and load skills with Pi during backend preparation, then embed their full method content in versioned instructions, without runtime resource consultation. | Very small, stable methods and minimal runtime integration. | Worked examples require progressive consultation or inflate permanent context. |

On-demand consultation was selected because it preserves native skill use and supports substantial examples without unconditional context growth. Systematic initial loading remains a future alternative only if observed omission justifies reopening the decision. Full precomposition does not fit the intended breadth of examples as well. No approach was represented as proof of semantic reliability.

## Integration and resource lifetime

Author runtime methods under `agent-skills/`, separate from developer-facing `.agents/skills/`. Initial skill names are `workbench-framing` and `source-preparation`. Supporting examples and genuinely shared references have one authored owner; generated resource packages are never independently edited.

Use Pi's discovery, metadata validation and catalogue rendering during backend resource preparation. Do not duplicate its frontmatter parser, catalogue format, path conventions or reading/pagination behavior. Package the admitted skill files and references for deployment. At runtime supply only the catalogue relevant to the agent's mission and serve resource content through a native Pi reader. The demonstrated custom file-operations API is an available integration seam; complete deployment binding remains to be verified through the existing execution path.

The application adaptation owns resource availability and authorization, mapping to the existing operation contract and retention of results. It must delegate skill interpretation and reading mechanics to Pi rather than create a second loader or filesystem implementation. A native reader must not be registered around admission, generation fencing, accounting or publication checks. The installed reader's capacity and continuation behavior must be reconciled with the existing operation-result contract, without silently truncating content or inventing another independent limit.

Bind an immutable resource package to the agent definition version. Resumed work must resolve the same bytes, including referenced examples, after restart or publication of a newer package. Retain packages required by supported pinned definitions; missing or mismatched resources fail explicitly rather than falling forward to the latest package. Native history and compaction remain Pi-owned, while the catalogue and pinned resources remain available for rereading. No parallel memory or transcript store is introduced.

Remove method text moved into skills from the corresponding current instructions. Keep identity, authority, evidence boundaries and tool contracts with their existing owners. Resource reading is not documentary acquisition or a qualified contribution, and never grants more tools, budget or workflow authority. Skill files are application-authored methods; retrieved public documents remain untrusted evidence. Historical definitions retain their admitted behavior until a separately supported version transition.

## Date presentation

Distinguish document publication from the event described by the document. Preserve the origin of each structured date: publication metadata, SEC field, or explicit dated label in the retained document. A date mentioned in narrative text does not automatically establish publication or event metadata. Missing evidence stays unknown; incompatible indications remain visible as a conflict rather than being silently resolved.

Correct the missed explicit CCC date forms within the existing date owner, including abbreviated months and relevant release datelines. Preserve known dates through continuation pages and associate them with the correct reading. Date extraction must not infer precision absent from the source, substitute acquisition time for publication, or derive event identity and relevance merely by sorting dates. This does not expand into an unrestricted natural-language event extractor.

The model-facing reading should make document identity, publication date and available event-date information immediately distinguishable. Sources' existing document-metadata projection must retain the same meanings; extend the owning metadata contract rather than build an independent chronology representation for each agent. Current provenance and dated-support requirements remain enforced. A skills change cannot compensate for missing or misleading authoritative observations.

## Task methods

### Workbench framing

Teach the sequence from the analyst's economic question to a useful provisional program. Preserve the requested actors and activity; compare plausible events by date, connection to the workflow and documentary support; read the material that can distinguish those interpretations; separate common research questions from event-dependent questions; and request one targeted clarification only when the unresolved distinction materially changes the program.

Worked cases show why a recent publication may describe an older event, why a relevant announcement is not automatically the analyst's intended announcement, and how a useful program can remain open. An announcement's possible economic consequence is investigated as a question rather than inserted into the analyst's premise. Cases expose the available observations, the reasons for selecting or rejecting a reading, and the resulting program. They do not prescribe company-specific answers or a fixed number of searches.

### Source preparation

Teach the sequence from an existing documentary need to a controlled useful contribution: identify the missing information, choose a document for its expected contribution, inspect the relevant capture, state what the passage supports and what it leaves unresolved, confront competing material where useful, and submit the contribution through the existing qualification controls.

Worked cases cover incomplete readings, issuer assertions, repeated press releases without independent confirmation, useful counter-evidence, and technically unfinished work. They distinguish document acquisition from a useful contribution, publication independence from domain identity, and an exhausted search from evidence of absence. Stopping or continuing is explained by remaining useful work and authorized capacity, not a source-count target. Sources prepares the evidence and limitations without deciding the economic answer.

### Shared material and examples

Keep attribution, temporal distinctions and documentary scope in a shared reference when they must evolve together. Mission-specific examples remain with their consuming skill. Examples are complete worked demonstrations with observable decision reasons, not just polished final answers or instructions to reveal private reasoning. Do not reproduce normative product, authority or execution policy inside every skill. Training examples and held-out qualification cases are separate; the historical failed cases remain regression evidence rather than becoming the only templates the model learns.

## Validation and acceptance

Technical changes require RED → GREEN → REFACTOR through the real Convex/Pi boundary, importing production collaborators and simulating only external or nondeterministic behavior. Verify mission-scoped discovery, native reading and continuation, unadmitted-path refusal, immutable package identity, missing-resource failure, restart, compaction and preserved execution controls. The reading path must not bypass registry conformance or count skill consultation as documentary coverage. Verify resource packaging through the actual backend build/publication mechanism when implementation is authorized.

Date regressions include both captured CCC releases, distinct publication/event dates, dates merely mentioned in prose, dates discovered in later pages, absent dates and conflicting evidence. Assert the structured observation and the serialized provider input, not only an intermediate helper result. Preserve original provenance and evidence controls. These tests prove faithful delivery and mechanical behavior, not better judgment.

Semantic qualification compares current methods against skill-based methods with the same corrected observations, model and capabilities. This isolates the contribution of the methods from the date correction. Preserve the historical Workbench core battery and add held-out cases explicitly in the future mandate. Sources requires its own exercised preparation cases: the previous pre-Start battery did not qualify Sources behavior. Training examples must not be reused as the only acceptance cases.

Judge Workbench by fidelity to the request, event justification, hypothesis containment and program usefulness. Judge Sources by need-specific useful contributions, attribution, limitations, confrontation and honest partial outcomes. Do not treat skill-read counts, token use or document counts as semantic success. Distinguish execution integrity, semantic task success and explicit partial containment. Material errors block acceptance of the affected capability; accurate stylistic imperfections do not trigger an open-ended tuning loop.

A later paid mandate must state its cases, resource envelope, comparison conditions and review procedure. This design authorizes no such execution. If skills do not improve the result, inspect actual loading, examples and task fit before selecting another bounded intervention; do not automatically grow the instruction list.

## Readiness and remaining verification

The native public APIs, current instruction owners and observed date weakness are verified. The alternatives and each design section were explicitly accepted. The user accepted complete Convex/Pi integration and semantic improvement as remaining verification, not as delivered facts. Dependency placement, deployment packaging and operation-envelope adaptation must be checked during implementation; unsupported integration must be reported before weakening the accepted boundaries or copying Pi internals.

No production code, dependency, runtime skill or deployment was changed during conception. Temporary local probe files were removed. TECH identifies the accepted runtime-skill owner and records the target as pending; ROADMAP keeps delivery unchecked. Register the concrete method and shared-reference files in the documentation policy when implementation creates them: the checker requires exact existing paths for normative references and rejects wildcard reference rules. This design record remains under the existing history policy. No new ADR is required.
