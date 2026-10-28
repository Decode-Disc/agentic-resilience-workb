import type { Doc } from "@convex/_generated/dataModel";
import type {
    AgentResult,
    AgentScope,
    AgentState,
    OperationPin,
} from "./agentDefinition";
import { executionError } from "./errors";

/** Normalizes persisted v1 inspection fields without rewriting historical records. */
export function missionScope(mission: Doc<"agentMissions">): AgentScope {
    return "protocolVersion" in mission
        ? mission.scope
        : {
              kind: "saved_material_inspection_v1",
              corpusRevisionId: mission.corpusRevisionId,
          };
}

export function missionState(mission: Doc<"agentMissions">): AgentState {
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
