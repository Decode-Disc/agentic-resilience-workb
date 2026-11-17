import type { Doc } from "@convex/_generated/dataModel";
import { supportsResearchControl } from "@convex/domain/transitions";
import type {
    AgentProgressMission,
    AgentResult,
    AgentScope,
    AgentState,
    OperationOutcome,
    OperationPin,
} from "./agentDefinition";
import { executionError } from "./errors";

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
