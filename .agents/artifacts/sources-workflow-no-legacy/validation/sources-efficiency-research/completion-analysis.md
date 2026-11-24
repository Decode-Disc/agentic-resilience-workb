## Analysis: native operations and final completion across the execution contract (HEAD `6043a64a`)

Scope is Q4, plus the completion-related parts of Q1 and Q6. I made no edits and no paid calls. Git status was clean after the test runs.

### 1. Overview

Every mission is generated through one shared path. `runPiMission` runs a Pi (`pi-durable`) session. Each Pi model request goes through `request()` (`piMission.ts:541`), which calls `invokeControlledGeneration` with an injected native backend (`invokeAgentModel.ts:99`). Operations reach the model as Pi tool declarations. There is no completion tool.

Completion is the final `stop` assistant message, and it takes one of two forms:
- **Free text** wrapped by a definition adapter. Only Workbench has one (`textCompletion`).
- **JSON** parsed from the whole assistant text. Every other definition works this way, including Sources v4/v5/v6/v7.

The shared decoder is `decodeReceivedReply` (`invokeAgentModel.ts:38-97`). The shared adopter is `invocations.finish` (`invocationLifecycle.ts:1086-1498`). Both are bound to the mission's pinned `definitionId` and `definitionVersion`.

### 2. Registered bindings

`agentCatalog.ts:38-46` lists the current bindings: `sources_v1@7`, `workbench_v1@12`, `conversation_validation_v1@2`, `execution_validation_v1@2`, `saved_material_inspection_v1@3`.

`agentCatalog.ts:142-158` adds the pinned historical ones:
- Workbench v4, v5 (`directedWorkbenchDefinition`), v6, v7, v9, v10, v11, and v8 (`workbenchMethodControlDefinition`).
- Sources v4, v5, and v6 (`sourcesMethodControlDefinition`).
- `saved_material_inspection_v1@2`.

Any other version throws `definition_version_conflict` (`agentCatalog.ts:204`). Version constants are in `savedMaterialOperations.ts:15-18`, `framingContracts.ts:154-155` and `qualificationAgentMethods.ts:11-15`.

`bindAgentDefinition` (`agentCatalog.ts:102-140`) merges the common operations `consult_conversation`, `consult_mission_state` and `consult_run_state` into every binding, and composes the instructions. It also rejects any definition that overrides a common operation.

### 3. Text adapter versus assistant JSON

| Definitions | Completion form | Evidence |
|---|---|---|
| Workbench v4–v12 (v5+ are spreads of v4) | Text adapter: `textCompletion: (text) => ({kind:"complete", text})` | `workbenchAgent.ts:428`, inherited via `...workbenchDefinition` at `:854` and the later spreads |
| Sources v4, v5, v6, v7 | JSON text parsed from the whole assistant output | No `textCompletion` (`sourcesAgent.ts:193-672`); `completionValidator = sourcesCompletionProposalValidator` (`:207`) |
| `saved_material_inspection` v2/v3, `execution_validation` v2, `conversation_validation` v2 | JSON | `savedMaterialInspection.ts:55`, `executionValidationAgent.ts:34`, `conversationValidation.ts:28` |

`conversation_validation_v1` completes with a `{kind:"complete", text}` object but has no adapter. It is a fixture-only definition.

`context.ts:314-327` renders `constraints.completion` into the required-state JSON, which is the mission prompt. It is `{format:"text"}` when `textCompletion` exists. Otherwise it is `{format:"json", schema: operationResultSchema(operationResultValidator(definition.completionValidator))}`, with `convexValidator` stripped.

For Sources v5 the schema contains `readRequestIds` and `unfinished`, and omits `workRequestIds` and `needsRevision`. `shared-context-projection.test.ts:191-204` asserts this.

`PI_MISSION_INPUT` (`modelInput.ts:18-19`) is the only user message for non-native-conversation missions: "…Return its domain completion JSON when its work is complete." It is submitted at `piMission.ts:1498-1507`.

The Sources instructions say to "return JSON conforming to constraints.completion.schema" (`sourcesAgent.ts:143`). Workbench instructions say "Finish with your natural-language response in Markdown. The application constructs the completion envelope. Text accompanying tool calls is not a completed response." (`workbenchAgent.ts:299`).

### 4. Operation schemas as exposed to Pi

**Tool declarations**
- `buildTools` (`piMission.ts:310-385`) creates a Pi `defineTool` for every key of `definition.operations`, including common and system-only operations.
- Metadata comes from `piToolMetadata` (`modelInput.ts:22-35`): name, description, `replay:"safe"`, `executionMode:"sequential"`, and `parameters: Type.Unsafe(JSON Schema)`.
- The schema comes from `agentOperationInputSchema` (`modelInput.ts:245-346`): the convex validator converted to a strict zod object (`.strict()`), then `z.toJSONSchema` (draft-7). Convex ID fields become `type:"string"` with an "Id<table>: copy an observed identifier" description.

**What the model is offered**
- `refreshTools` (`piMission.ts:473-489`) rebuilds tools from the current snapshot and calls `root.configure({modelTools})`, filtered to `Object.keys(agentToolSchemas(definition, snapshot))`.
- `agentToolSchemas` (`agentDefinition.ts:156-189`) drops `systemOnly` operations and applies `definition.modelOperation(name, op, snapshot)`.
- Workbench's `modelOperation` (`workbenchAgent.ts:674-724`) projects tool availability from the snapshot and wire variants (`nativeWorkbenchOperation`, `:161-234`). It returns `null` for `control_research` and for everything when `responseControl.reminder` is set.
- Sources' `modelOperation` (`sourcesAgent.ts:240-253`) swaps in `savedMaterialWireContract` for the saved-material operations. It also uses `qualificationModelInput` for `submit_documentary_qualification`, which omits `expectedTaskId` and `expectedVersion` (`:159-191`).
- `normalizeOperationInput` (`sourcesAgent.ts:254-286`, `workbenchAgent.ts:725-774`) binds the omitted fields server-side, in `finish`.

**What is not used**

grep over `convex/` finds no use of `constrainedSampling`, `structuredOutput`/`structuredOutputSchema`, `control.terminate`, `response_format` or `responseFormat` in the native path. The only hit for `responseFormat` is `modelTransport.ts:518`, which is the one-shot AI-SDK transport.
- `modelConfiguration.ts:71-79` requires `descriptor.structuredOutputs` for any agent except `workbench`.
- `toolChoice` is accepted only as `auto` or `none` (`piMission.ts:1361-1379`).
- Pi settings are `toolExecution:"sequential"`, `retry.enabled:false`, compaction enabled (`:1385-1397`).

### 5. Decoding and correction feedback

**Decode** (`invokeAgentModel.ts:72-95`)

The order is:
1. Compaction (`auxiliary`) decodes to an empty `operations` reply.
2. If any tool call was returned, the reply is `operations` and the assistant text is ignored (`:75-76`).
3. Otherwise `textCompletion(text)` is used when the definition has one (`:77-78`).
4. Otherwise `JSON.parse(assistantOutput)`; a parse failure returns `invalid("invalid_output")` (`:80-84`).
5. The result must satisfy `invocationResponseValidator` (`executionProtocol.ts:277-291`), a union of `operations`, **all registered** `agentCompletionValidator` branches, and `blocked`. Otherwise `invalid("invalid_output")` (`:86-87`).
6. A byte-capacity check (`response_capacity`) and `invocationStructureError` follow (`:88-95`).

`invalid()` produces `{kind:"blocked", code}` plus `rejectedOutputDiagnostic(code, text)` (`modelTransport.ts:93-111`: truncated output, `originalBytes`, `truncated`). `recordObservation` (`invokeAgentModel.ts:340-416`) writes the receipt as `failed` / `invalid_output` / `response_received` with that diagnostic.

**Receipt-level `invalid_output` sources**

`generationObservation` (`modelTransport.ts:114-153`) produces `invalid_output` receipts in two further cases:
- `finish_reason_invalid`: any finish reason other than `stop` or `tool-calls`, such as `length` or `content_filter`.
- `tool_arguments_invalid`: only when original tool arguments are unavailable (`piMission.ts:1166-1175`).

**Adoption branching in `finish`** (`invocationLifecycle.ts:1272-1292`)

For a `blocked` response:
- It becomes a non-terminal `correctCompletion` with code `invalid_output` only if the receipt is `failed` / `response_received` / `invalid_output` **and** `diagnostic.reason === "invalid_output"`. That means the parse or union failure from `decodeReceivedReply`. The fixed feedback text is "A single JSON completion object matching the declared schema, without surrounding prose or Markdown fences." (`:1281-1290`).
- Every other blocked response, including `finish_reason_invalid` and `tool_arguments_invalid`, takes `block(code, true)`, which sets the mission to `blocked` (`:1154-1193`, `:1291`).
- Simulation invocations have no receipt, so they also fall to the terminal block.

**Definition-level completion correction** (`invocationLifecycle.ts:1315-1353`)

For a `complete` response that decoded:
1. Validate against `definition.completionValidator` with `throw:true`. A `ValidationError` becomes `correctCompletion({code:"invalid_completion", issues:[operationInputFeedback(...)]})` (`:1320-1338`).
2. Call `definition.complete(ctx, mission, response, admittedSnapshot, invocation)`. Its results are handled as follows (`:1339-1347`):
   - `correct` becomes `correctCompletion`.
   - `continue` becomes `block("mission_context_changed")`.
   - `blocked` becomes `block(code)`.
3. The result is validated against `resultValidator`. If the mission has a conversation turn, `publishTurn` runs with `conversationReply`. The mission is then marked `completed` (`:1348-1380`).

`correctCompletion` (`:1194-1228`):
- It rejects feedback over `MAX_OPERATION_RESULT_BYTES` (terminal `operation_result_capacity`) and feedback that fails `completionFeedbackValidator` (terminal `operation_contract_invalid`).
- Otherwise it stores `invocation.correction` and sets the mission back to `ready`.
- It increments `noProgressTurns` via `invocationProgressSettlement(..., rejectedCompletion=true)` (`:1501-1562`).
- It blocks the invocation with `completion_correction_required` (non-terminal) and returns the feedback.

**Delivery to the model in the Pi loop** (`piMission.ts:1286-1322`)
- On `completion_correction_required` with a correction, `request()` increments `preparationChanges` and returns the original assistant message with an extra `fauxText("The preceding completion was refused. Correct the proposal using current required state: <correction JSON>")` appended to its content (`:1289-1304`).
- Pi's `answer()` then runs the app's `onYield` hook (`:446-466`). Because `preparationChanges > 0` it returns `{continue: "Required mission context changed. Continue with the current state and active instructions before completing."}`, which starts another generation.
- The correction also appears in the next required state as `lastObservableInvocation.correction` (`context.ts:349-373`).
- `mission_context_changed` returns a faux "not adopted because required mission context changed" message and increments `preparationChanges` (`:1305-1312`). The `onYield` hook then continues the same way.
- `stale_instructions` returns a faux message without incrementing (`:1313-1318`).
- `pending_operations` throws `pi_slice_complete`, a planned yield and wake (`:1287-1288`). `finish` blocks completion with `pending_operations` before the domain `complete` whenever `hasOutstandingOperations` is true (`invocationLifecycle.ts:1301-1311`).
- Any other blocked code throws `executionError(code)`, which stops the worker with that mission block code (`piMission.ts:1319-1321`).

**Correction limit**
- No counter bounds corrections. `preparationChanges` is reset to 0 after each ready `begin` (`piMission.ts:668`). It trips `native_preparation_stalled` only on consecutive preparation changes (`:226-234`).
- `context/TECH.md:86` says "validation failures trigger one bounded continuation correction". `TECH.md:210` says rejected completions do not stop automatically after three invocations.
- Tests show correction continuing for 5 consecutive refused replies and 6 provider calls (`pi-native-transport.test.ts:257-339`), and for more than 3 `framing_program_required` corrections (`workbench-framing-completion.test.ts:160`).

### 6. Sources completion contract (current v5/v7)

`sourcesAgent.ts:469-619`:
1. The `needs` of the proposal are validated.
2. If `readEngagedSourcesWork` finds engaged work, or `processWorkbenchInstructions` plus `hasWaitingWorkbenchInstructions` finds waiting instructions, it returns blocked `pending_operations`.
3. The admitted snapshot must carry `activeWork.preparationId`, `needsRevision` and `work`. An invalid snapshot throws `sources_context_invalid`.
4. If the admitted `needsRevision` is older than the current one, it returns `continue`. If it is not equal, it throws `sources_context_invalid`.
5. The harness builds a full completion: `needsRevision` from the admitted input, and `workRequestIds` as all admitted work for the need plus the model's `readRequestIds`.
6. `sourcesCompletionAccounting` (`sources.ts:1299-1378`) validates needs, revision, duplicates and omitted known work. If it finds no issues but omitted work not in the admitted snapshot, it returns `stale` and `complete()` returns `continue`.
7. `completeSources` (`sources.ts:1381-1715`) re-checks authority, budget, deadline, and each need's work, gap and unfinished state:
   - `sources_work_unfinished`, `sources_need_unresolved`, `documentary_gap_not_examined`, `sources_work_invalid`.
   - It throws a `ConvexError` with `issues`.
   - The catch block (`sourcesAgent.ts:582-618`) converts issue-bearing errors into `correct` feedback, rewriting `workRequestIds` to `readRequestIds`.
   - Errors without issues become `blocked` with the code.

The `result.outcome` is `complete`, `partial` or `blocked` depending on whether any need has `unfinished` explanations and whether any controlled documents exist (`sources.ts:1665-1675`).

Workbench `complete` (`workbenchAgent.ts:522-673`) rejects blank text as `blocked invalid_completion` (non-terminal block, then thrown by Pi). It adds a `framing_program_required` correction for an initial delivery without a saved program (`:540-578`). It also composes confirmations (`researchControlConfirmation`, `framingTurnReceipt`, instruction outcomes) and runs `completeResponseControl`, which can return other `correct` or `blocked` results.

### 7. Operation adoption, replay, cancellation

**Operations**
- `finish`'s operations branch (`invocationLifecycle.ts:1382-1496`) rejects an empty offered set, normalizes native history input, runs the definition's `normalizeOperationInput`, and validates against the offered schema (`operationInputFeedback` for field feedback).
- It then persists each request via `persistOperationRequest` (`operations.ts:413-606`). A request that fails admission becomes `kind:"invalid"` with a `refused` or `unavailable` outcome.
- Persistence assigns a pin through `operation.pin`, a `logicalKey` from `operation.identity`, and reuse of an existing request with that key. It stores `expectedGeneration` and `deadlineAt`.
- This happens inside `request()`, before Pi starts its tool round.

**Pi tool execution**
- The tool's `execute` (`piMission.ts:321-381`) finds the request by `callId` through `piControl.operation` (`piControl.ts:500-535`). It dispatches via `operations.dispatch`, which runs `claim`, then `execute`, then `recordResult` (`operations.ts:687-1331`).
- Any dispatch failure calls `stop(error)` and rethrows.
- `afterTools` runs `settleRetainedOperations` (drains requests in status order observed → waiting → running → pending → unknown), `syncInputs` and `refreshTools`.
- Pi itself also validates and coerces arguments before `execute` (`pi-durable` `tool.js:60-89`, `validateToolArguments`). A Pi-side rejection yields a Pi `invalid_arguments` result without calling `execute`.

**Adoption and freshness** (`operations.ts:929-1260`)
- `recordResult` validates the value against `resultValidator` and `validateOutcome`, enforces the history-read receipt, applies progress accounting (`adoptProgress`, `definition.progress`), and checks authority again.
- A late result under changed authority is stored but marked `adoptionRefusalCode`, and the model sees an `operation_adoption_failed` diagnostic (`agentDefinition.ts:205-208`).
- `claim` (`operations.ts:711-731`) refuses a stale generation or a mission whose generation differs. Effect pins are rechecked at `:360-368` (`version_conflict`).

**Replay**
- If the invocation already has `receivedOutputJson`, `request()` reuses the retained Pi message from `rawOutputJson.backendOutputJson` without a provider call (`piMission.ts:725-745`).
- A started provider attempt with no received output throws `attempt_outcome_unknown` (`:747-748`).
- `finish` is idempotent: for an already-returned invocation it returns the stored outcome, including the correction, unless the mission is `pi-durable` and the block was `pending_operations` (`invocationLifecycle.ts:1111-1142`).
- Adoption of a retained response across a generation change requires `canAdoptRetainedResponse`, which checks `receivedWhileAuthorized` and matching mission, run, definition version and scope key (`authority.ts:42-57`). Otherwise it blocks with `retained_response_not_reusable` (`invocationLifecycle.ts:1267-1271`).
- Retained replies are not re-decoded. The stored decoded response (`outputJson` / `receivedOutputJson`) is adopted, and its validation re-runs against the pinned definition.
- A mission with a refused generation and a later resume reaches a faux continuation message (`piMission.ts:708-724`).
- `invalid_output` and `repetition_stop` are recoverable interruptions only for conversation scope or framed research with research control (`missionData.ts:28-50`).

**Cancellation and authority**
- `requireMissionAuthority` (`authority.ts:137-204`) fails for a stale generation, a cancelled, blocked or completed mission, an expired deadline, or a revoked visitor.
- `finish` catches that failure and calls `block(code)`. It retains the observation without adoption (`invocationLifecycle.ts:1229-1254`).
- `runPiMission` aborts the root when `mission.status === "cancelled"` (`piMission.ts:1491-1495`).
- A terminal mission can replay its retained original message (`:574-583`) but cannot dispatch (`:584-585`).
- Provider-receipt gates apply to live provenance: `finish` blocks with `provider_receipt_required` unless the receipt is `succeeded` / `response_received` (`invocationLifecycle.ts:1293-1300`).

### 8. Installed packages

From `package.json:64-67`, all under `node_modules/@earendil-works/` (pnpm store paths under `node_modules/.pnpm/…`):

| Package | Version |
|---|---|
| `chord` | 1.4.0 |
| `pi-ai` | 1.4.0 |
| `pi-durable` | 1.4.0 |
| `pi-coding-agent` | 1.5.0 |

`ai` is 7.0.138 and `zod` 4.4.3.

Relevant capabilities in the installed packages:
- **Tool terminate:** a tool result may carry `control.terminate`. The run ends only when every result in the round sets it (`pi-durable` `harness/types.d.ts:92-96`, `generation.js:528-560`, README line 277).
- **Structured tool output:** `structuredOutputSchema` and `structuredOutput` exist for programmatic callers, not as model completion.
- **Hooks:** `GenerationHooks` are `beforeRequest`, `afterResponse`, `onYield` (a final answer may append a user message and continue) and `afterTools` (`harness/types.d.ts:781-798`, `generation.js:454-475`).
- **Constrained sampling:** `pi-ai` offers per-tool `constrainedSampling` (`types.d.ts:532`). The OpenAI-completions adapter emits `strict` only when a tool opts in (`openai-completions.js:1158-1166`, `constrained-sampling.js:174-195`).
- **`toolChoice`:** `"auto" | "none"` only (`types.d.ts:28`, `:235`).
- **No completion options:** I found no response-format or JSON-schema output option in `pi-ai` types. The only `response_format` hit is `mistral-conversations.js`.

### 9. Tests

**Run (three vitest invocations, all green, no network)**
- 7 files / 64 tests: `sources-completion-correction`, `sources-completion-freshness`, `sources-completion`, `pi-mission`, `operation-conformance`, `shared-recovery`, `agent-extension`.
- 6 files / 90 tests: `pi-native-transport`, `model-action`, `workbench-framing-completion`, `pi-tool-arguments`, `pi-correlation`, `bounded-refusal-recovery`.
- 4 files / 87 tests: `sources-generation-recovery`, `sources-interruption-policy`, `workbench-native-interface`, `shared-context-projection`.

**Read**
- Fully: `sources-completion-correction`, `sources-completion-freshness`, `operation-conformance`, `pi-mission`.
- Partially: `shared-recovery:190-425`, `pi-native-transport:1-135, 255-495, 885-1113, 1870-2013`, `shared-context-projection:150-224`, and `sources-generation-recovery:1-60`.
- Test names or greps only: the remaining files listed above.
- Not read at all: `sources-frozen-replay`, `native-state-observations`, `response-control`.

**What the read suites cover**
- Fenced prose-plus-JSON completion is refused as `invalid_output` and corrected, with repeated refusals up to five (`pi-native-transport.test.ts:257-339`).
- Wrong-definition schema yields an `invalid_completion` correction with field paths (`sources-completion-correction.test.ts:16-88`).
- Needs-array bounds and Pi preservation across 1 and 4 refusals (`sources-completion-correction.test.ts:90-283`).
- A late reservation refreshes a retained completion via `mission_context_changed` (`sources-completion-freshness.test.ts:51-193`).
- Omitted or duplicated known work is rejected as `sources_work_unaccounted` (`sources-completion-freshness.test.ts:195-264`).
- `length` and `content_filter` finish reasons settle a terminal `invalid_output` block (`pi-native-transport.test.ts:927-953`).
- A late reply after cancel or revoke is retained without adoption (`pi-native-transport.test.ts:1056-1113`).
- `pending_operations` completion is adopted after the work settles (`pi-mission.test.ts:212-264`).
- Original-argument JSON refusal does not execute repaired arguments (`pi-native-transport.test.ts:432-487`).
- `operation-conformance.test.ts` runs for every registered binding but exercises only common operations (`consult_run_state`, `consult_mission_state`), invalid-operation refusal, history receipts and authority. It does not submit a completion.

### 10. Boundaries and unknowns

- **Eight prior `invalid_output` cases:** the mechanism cited in the retained diagnosis (`invokeAgentModel.ts:80`) is still the shared decode (`:80-84` at HEAD) for every definition without `textCompletion`. I did not re-measure the original cases or run any live or recorded comparison, so I do not state whether they would recur on current bindings.
- **Corrections:** Sources `invalid_output` corrections can repeat without a counter bound. The code and `TECH.md:86` (one bounded correction) are not in step. I have not checked the ROADMAP statement on completion correction beyond `ROADMAP.md:71`.
- **Pi/app argument validation:** the interaction between Pi's `validateToolArguments` coercion and the app's already-persisted request, when only Pi's check rejects, was read from code but not isolated in a test I ran.
- **Provider routes:** whether OpenRouter honours `strict` or any structured-output hint for these routes was not probed; it is provider-live behavior.
- **Not traced:** documentary-control one-shot transports, `piNativeInput` delivery, `piStorage`, `history.ts` and `missionHistory.ts` (Q3/Q5 owners), and the Workbench `responseControl` adoption internals beyond their call from `complete`.
- **Pinned conversations:** I did not enumerate the exact per-version tool sets (v4 vs v5 vs v10+) or run frozen replay for every pinned version.
