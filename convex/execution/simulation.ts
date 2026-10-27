import { internalQuery } from "@convex/_generated/server";
import { localBrowserFixturesEnabled } from "@convex/runWorkspace";
import { type Infer, v } from "convex/values";
import { executionError, requireMissionAuthority } from "./authority";
import { invocationResponseValidator } from "./contracts";

/** A local scripted model exercises the real executor without claiming provider or semantic verification. */
export const invoke = internalQuery({
    args: {
        invocationId: v.id("agentInvocations"),
        expectedGeneration: v.number(),
    },
    returns: invocationResponseValidator,
    handler: async (
        ctx,
        args,
    ): Promise<Infer<typeof invocationResponseValidator>> => {
        const invocation = await ctx.db.get(args.invocationId);
        if (
            !invocation?.missionId ||
            invocation.provenance !== "simulation" ||
            !localBrowserFixturesEnabled()
        )
            throw executionError("simulation_not_authorized");
        const { run } = await requireMissionAuthority(
            ctx,
            invocation.missionId,
            args.expectedGeneration,
        );
        if (run.purpose !== "browser_test")
            throw executionError("simulation_not_authorized");
        const input: unknown = JSON.parse(invocation.inputJson);
        if (
            !input ||
            typeof input !== "object" ||
            !("availableMaterials" in input) ||
            !Array.isArray(input.availableMaterials) ||
            !("triggeringRequestsAndResults" in input) ||
            !Array.isArray(input.triggeringRequestsAndResults)
        )
            throw executionError("simulation_context_invalid");
        const source: unknown = input.availableMaterials[0];
        if (
            !source ||
            typeof source !== "object" ||
            !("sourceId" in source) ||
            typeof source.sourceId !== "string"
        )
            return { kind: "blocked", code: "simulation_material_unavailable" };
        const requests = input.triggeringRequestsAndResults;
        const latest: unknown = requests.at(-1);
        const operation: unknown =
            latest && typeof latest === "object" && "input" in latest
                ? latest.input
                : null;
        const previousKind =
            operation && typeof operation === "object" && "kind" in operation
                ? operation.kind
                : null;
        const request = (name: string, value: unknown) => ({
            kind: "operations" as const,
            requests: [
                {
                    callId: `simulated-${name}`,
                    name,
                    inputJson: JSON.stringify(value),
                },
            ],
            workingNotes:
                "Simulation: inspect retained material; no analytical conclusion is established.",
        });
        if (!previousKind) return request("consult_mission_state", {});
        if (previousKind === "consult_mission_state")
            return request("search_available_material", {
                sourceId: source.sourceId,
                query: "workflow",
            });
        if (previousKind === "search_available_material")
            return request("read_in_context", {
                sourceId: source.sourceId,
                passageOrder: 0,
            });
        if (
            previousKind === "read_in_context" &&
            latest &&
            typeof latest === "object" &&
            "outcome" in latest
        ) {
            const outcome: unknown = latest.outcome;
            if (
                outcome &&
                typeof outcome === "object" &&
                "kind" in outcome &&
                outcome.kind === "success" &&
                "captureId" in outcome &&
                typeof outcome.captureId === "string"
            ) {
                const id = ctx.db.normalizeId(
                    "sourceCaptures",
                    outcome.captureId,
                );
                if (id) return { kind: "complete", captureIds: [id] };
            }
        }
        return { kind: "blocked", code: "simulation_read_unavailable" };
    },
});
