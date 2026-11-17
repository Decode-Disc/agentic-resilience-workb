import type { Doc } from "@convex/_generated/dataModel";
import {
    type CoherenceScores,
    RESPONSE_CONTROL_LIMITS,
    validCoherenceScores,
} from "@convex/domain/workbenchResponseControlContracts";
import { resolveGenerationAuthority } from "@convex/resourcePolicy";
import { createBoundedModelFetch, readReportedCost } from "./modelTransport";

const DECISIONS_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
function record(value: unknown): Record<string, unknown> | undefined {
    return value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}
/** One native request, using the shared bounded HTTP reader and no provider pin or retry. */
export async function checkResponseCoherence(args: {
    requestJson: string;
    authority?: Pick<Doc<"agentMissions">, "resourcePolicy" | "deadlineAt">;
    apiKey: string;
    signal?: AbortSignal;
    fetch?: typeof fetch;
}) {
    const authority = resolveGenerationAuthority(args.authority, Date.now());
    if (authority.kind === "blocked")
        return {
            status: "unavailable" as const,
            reason: authority.code,
            scores: undefined,
            rawResponseJson: undefined,
            model: undefined,
            reportedCost: undefined,
            usage: undefined,
            httpStatus: undefined,
            latencyMs: 0,
        };
    const state = { responseTooLarge: false };
    const boundedFetch = createBoundedModelFetch({ fetch: args.fetch }, state);
    const deadline = AbortSignal.timeout(authority.timeoutMs);
    const signal = args.signal
        ? AbortSignal.any([args.signal, deadline])
        : deadline;
    const startedAt = Date.now();
    const response = await boundedFetch(DECISIONS_ENDPOINT, {
        method: "POST",
        signal,
        headers: {
            Authorization: `Bearer ${args.apiKey}`,
            "Content-Type": "application/json",
        },
        body: args.requestJson,
    });
    const raw = await response.text();
    const rawResponseJson = raw.replaceAll(args.apiKey, "[REDACTED]");
    if (
        new TextEncoder().encode(rawResponseJson).length >
        RESPONSE_CONTROL_LIMITS.inputBytes
    )
        return {
            status: "unavailable" as const,
            reason: "response_capacity",
            rawResponseJson: undefined,
            model: undefined,
            reportedCost: undefined,
            usage: undefined,
            httpStatus: response.status,
            latencyMs: Date.now() - startedAt,
        };
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawResponseJson);
    } catch {
        return {
            status: "unavailable" as const,
            reason: "response_invalid",
            scores: undefined,
            model: undefined,
            rawResponseJson,
            reportedCost: undefined,
            usage: undefined,
            httpStatus: response.status,
            latencyMs: Date.now() - startedAt,
        };
    }
    const body = record(parsed);
    const usage = record(body?.usage);
    const assessment = record(record(body?.answers)?.assessment);
    const probabilities = record(assessment?.probabilities);
    const scores: CoherenceScores | undefined =
        probabilities &&
        Object.keys(probabilities).length === 3 &&
        typeof probabilities.supported === "number" &&
        typeof probabilities.contradicted === "number" &&
        typeof probabilities.insufficient_information === "number"
            ? {
                  supported: probabilities.supported,
                  contradicted: probabilities.contradicted,
                  insufficient_information:
                      probabilities.insufficient_information,
              }
            : undefined;
    const valid =
        response.ok &&
        !state.responseTooLarge &&
        assessment?.type === "choice" &&
        scores &&
        validCoherenceScores(scores) &&
        typeof assessment.choice === "string" &&
        Object.keys(scores).includes(assessment.choice) &&
        typeof assessment.confidence === "number" &&
        assessment.confidence >= 0 &&
        assessment.confidence <= 1;
    const receipt = {
        model: typeof body?.model === "string" ? body.model : undefined,
        rawResponseJson:
            new TextEncoder().encode(rawResponseJson).length <=
            RESPONSE_CONTROL_LIMITS.inputBytes
                ? rawResponseJson
                : undefined,
        reportedCost: readReportedCost(usage),
        usage,
        httpStatus: response.status,
        latencyMs: Date.now() - startedAt,
    };
    return valid && scores && receipt.rawResponseJson !== undefined
        ? { ...receipt, status: "checked" as const, scores }
        : {
              ...receipt,
              status: "unavailable" as const,
              reason:
                  receipt.rawResponseJson === undefined
                      ? "response_capacity"
                      : "response_invalid",
          };
}
