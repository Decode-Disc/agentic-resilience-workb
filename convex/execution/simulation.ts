import { internalQuery } from "@convex/_generated/server";
import { localBrowserFixturesEnabled } from "@convex/runWorkspace";
import { type Infer, v } from "convex/values";
import { getAgentDefinition } from "./agentCatalog";
import { executionError, requireMissionAuthority } from "./authority";
import { invocationResponseValidator } from "./executionProtocol";

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
        const { run, mission } = await requireMissionAuthority(
            ctx,
            invocation.missionId,
            args.expectedGeneration,
        );
        if (run.purpose !== "browser_test")
            throw executionError("simulation_not_authorized");
        const definition = getAgentDefinition(
            mission.definitionId,
            mission.definitionVersion,
        );
        if (!definition.simulate)
            throw executionError("simulation_not_configured");
        return definition.simulate(JSON.parse(invocation.inputJson));
    },
});
