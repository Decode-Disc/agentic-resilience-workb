import type { Doc, Id } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import { supportsResearchControl } from "@convex/domain/transitions";
import { retainedReplyKey } from "@convex/execution/conversationBodies";
import { RETAINED_TEXT_INLINE_BYTES } from "@convex/resourcePolicy";
import type {
    AgentProgressMission,
    AgentResult,
    AgentScope,
    AgentState,
    OperationOutcome,
    OperationPin,
} from "./agentDefinition";
import { executionError } from "./errors";
import { adoptRetainedTextKey, completeRetainedText } from "./retainedText";

/** Stable persisted identity for a mission's objective across attempts and definition versions. */
export function missionObjectiveKey(
    scope: AgentScope,
    conversationTurnId?: Id<"agentConversationTurns">,
): string {
    const suffix = conversationTurnId ? `:${conversationTurnId}` : "";
    switch (scope.kind) {
        case "workbench_v1":
            return `workbench${suffix}`;
        case "conversation_validation_v1":
            return `conversation${suffix}`;
        case "sources_v1":
            return `sources:${scope.preparationId}${suffix}`;
        case "saved_material_inspection_v1":
            return `saved-material:${scope.corpusRevisionId}${suffix}`;
        case "execution_validation_v1":
            return `validation:${JSON.stringify(scope.values)}${suffix}`;
    }
}

/** Both retained success formats contribute to the same mission progress. */
export function operationProgressKeys(outcome: OperationOutcome): string[] {
    return outcome.kind === "success"
        ? [
              ...("progressKeys" in outcome
                  ? (outcome.progressKeys ?? [])
                  : []),
              ...("progressKey" in outcome && outcome.progressKey
                  ? [outcome.progressKey]
                  : []),
          ]
        : [];
}

/** Classifies generation failures without treating a transport uncertainty as safe to replay. */
export function generationInterruption(code: string | undefined) {
    return code === "invalid_output"
        ? ("invalid_response" as const)
        : code === "repetition_stop"
          ? ("repeated_failure" as const)
          : undefined;
}

/** Execution and generation interruptions retain their mission; a blocked executor is not a terminal business result. Resume still enforces receipt, authority and capacity checks. */
export function isRecoverableInterruption(
    mission: Doc<"agentMissions">,
    run: Doc<"researchRuns">,
) {
    return (
        mission.status === "blocked" &&
        (mission.blockCode === "execution_interrupted" ||
            mission.blockCode === "execution_time_limit" ||
            (generationInterruption(mission.blockCode) !== undefined &&
                (mission.executionScope === "conversation" ||
                    (run.startMode === "framed" &&
                        supportsResearchControl(run)))))
    );
}

/** Normalizes persisted v1 inspection fields without rewriting historical records. */
export function missionScope(mission: AgentProgressMission): AgentScope {
    return "protocolVersion" in mission
        ? mission.scope
        : {
              kind: "saved_material_inspection_v1",
              corpusRevisionId: mission.corpusRevisionId,
          };
}

export function missionState(mission: AgentProgressMission): AgentState {
    return "protocolVersion" in mission
        ? mission.state
        : {
              kind: "saved_material_inspection_v1",
              inspectedCaptureIds: mission.inspectedCaptureIds,
          };
}

/** Old missions keep their original representation; each value has one persisted owner. */
export function domainDataPatch(
    mission: Doc<"agentMissions">,
    update: { state?: AgentState; result?: AgentResult },
) {
    if ("protocolVersion" in mission) return update;
    if (
        (update.state &&
            update.state.kind !== "saved_material_inspection_v1") ||
        (update.result && update.result.kind !== "saved_material_inspection_v1")
    )
        throw executionError("definition_version_conflict");
    return {
        ...(update.state?.kind === "saved_material_inspection_v1"
            ? { inspectedCaptureIds: update.state.inspectedCaptureIds }
            : {}),
        ...(update.result?.kind === "saved_material_inspection_v1"
            ? { completionRefs: update.result.captureIds }
            : {}),
    };
}

/** Provider receipts keep their historical corpus correlation when that scope exists. */
export function invocationScopeFields(mission: Doc<"agentMissions">) {
    const scope = missionScope(mission);
    return "corpusRevisionId" in scope
        ? { corpusRevisionId: scope.corpusRevisionId }
        : {};
}

export function retainedOperationPin(
    request: Doc<"agentOperationRequests">,
): OperationPin {
    if (request.pin) return request.pin;
    return request.input.kind === "consult_mission_state"
        ? { kind: "mission_history" }
        : {
              kind: "saved_material_inspection_v1",
              ...(request.expectedCaptureId
                  ? { expectedCaptureId: request.expectedCaptureId }
                  : {}),
              ...(request.expectedContentHash
                  ? { expectedContentHash: request.expectedContentHash }
                  : {}),
          };
}

/** Preserve v1 hash inputs so pending work and confirmed results remain reusable. */
export function operationIdentityScope(
    mission: Doc<"agentMissions">,
    pin: OperationPin | undefined,
) {
    if ("protocolVersion" in mission)
        return { scope: mission.scope, pin: pin ?? {} };
    return {
        corpusRevisionId: mission.corpusRevisionId,
        pin:
            pin?.kind === "saved_material_inspection_v1"
                ? {
                      ...(pin.expectedCaptureId
                          ? { expectedCaptureId: pin.expectedCaptureId }
                          : {}),
                      ...(pin.expectedContentHash
                          ? { expectedContentHash: pin.expectedContentHash }
                          : {}),
                  }
                : {},
    };
}

/** Preserves historical operation identity; each operation selects its reuse dependencies. */
export function operationReuseIdentity(
    context: Parameters<
        import("./executionProtocol").AgentOperationDefinition["identity"]
    >[0],
) {
    const { mission, runId, version, input, pin } = context;
    return mission
        ? {
              objective: mission.objectiveKey,
              version,
              ...operationIdentityScope(mission, pin),
              input,
          }
        : { runId, version, pin, input };
}

export function textualMissionOutcomePatch(
    kind: "workbench_v1" | "conversation_validation_v1",
    textId: Id<"retainedTexts">,
    contentHash: string,
) {
    return {
        result: undefined,
        resultTextId: undefined,
        textualOutcome: { version: 1 as const, kind, textId, contentHash },
    };
}

/** Returns a validated completion identity for bounded inspection and replay. */
export async function retainedTextualOutcome(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
) {
    if (!("protocolVersion" in mission) || !mission.textualOutcome)
        return undefined;
    const outcome = mission.textualOutcome;
    const text = await completeRetainedText(ctx, outcome.textId);
    if (
        text.key !== textualOutcomeKey(mission) ||
        text.contentHash !== outcome.contentHash ||
        outcome.kind !== mission.definitionId
    )
        throw executionError("invocation_result_invalid");
    return text;
}

export async function missionResultPatch(
    ctx: MutationCtx,
    mission: Doc<"agentMissions">,
    result: AgentResult,
    publication?: Pick<
        Doc<"agentMessageDeliveries">,
        "bodyTextId" | "contentHash"
    >,
    preparedResult?: Doc<"retainedTexts">,
) {
    if (
        "protocolVersion" in mission &&
        publication?.bodyTextId &&
        (result.kind === "workbench_v1" ||
            result.kind === "conversation_validation_v1")
    )
        return textualMissionOutcomePatch(
            result.kind,
            publication.bodyTextId,
            publication.contentHash,
        );
    if (preparedResult) {
        if (preparedResult.contentHash !== sha256Hex(stableStringify(result)))
            throw executionError("invocation_result_conflict");
        await adoptRetainedTextKey(
            ctx,
            preparedResult._id,
            `${mission._id}:result`,
        );
        return { result: undefined, resultTextId: preparedResult._id };
    }
    const json = JSON.stringify(result);
    if (
        !("protocolVersion" in mission) ||
        new TextEncoder().encode(json).length <= RETAINED_TEXT_INLINE_BYTES
    )
        return domainDataPatch(mission, { result });
    throw executionError("invocation_result_not_prepared");
}

/** Resolves the immutable JSON result owned by a non-conversation mission. */
export async function retainedMissionResult(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
    textId: Id<"retainedTexts">,
) {
    const text = await completeRetainedText(ctx, textId);
    if (text.key !== `${mission._id}:result`)
        throw executionError("invocation_result_invalid");
    return text;
}

export function missionTextualResultKey(missionId: Id<"agentMissions">) {
    return `${missionId}:textual_outcome`;
}

/** A completed result either shares a published delivery or owns its own exact text. */
export function textualOutcomeKey(mission: Doc<"agentMissions">) {
    if (
        "protocolVersion" in mission &&
        mission.textualOutcome?.ownership === "mission"
    )
        return missionTextualResultKey(mission._id);
    if (mission.conversationTurnId)
        return retainedReplyKey(mission.conversationTurnId);
    throw executionError("invocation_result_invalid");
}
