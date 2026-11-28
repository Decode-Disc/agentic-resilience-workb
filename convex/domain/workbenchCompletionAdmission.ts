import { domainSnapshot } from "@convex/execution/agentDefinition";
import { validate } from "convex-helpers/validators";
import {
    DEFAULT_RESPONSE_CONTROL_POLICY,
    type ResponseControlPolicy,
    responseControlPolicy,
} from "./workbenchResponseControlContracts";

function admittedPolicy(input: unknown): ResponseControlPolicy {
    const policy =
        input && typeof input === "object" && "responseControl" in input
            ? (input.responseControl as { policy?: unknown })?.policy
            : undefined;
    return validate(responseControlPolicy, policy)
        ? policy
        : { ...DEFAULT_RESPONSE_CONTROL_POLICY };
}

/** Projects only the admission facts consumed by response control at completion. */
export function projectWorkbenchCompletionAdmission(snapshot: unknown) {
    const input = domainSnapshot(snapshot);
    return {
        responseControl: { policy: admittedPolicy(input) },
        ...(typeof input.factsRevisionHash === "string"
            ? { factsRevisionHash: input.factsRevisionHash }
            : {}),
    };
}
