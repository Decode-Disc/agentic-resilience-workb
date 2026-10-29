import { internalQuery } from "@convex/_generated/server";
import { localBrowserFixturesEnabled } from "@convex/runWorkspace";
import { type Infer, v } from "convex/values";
import { getAgentDefinition } from "./agentCatalog";
import { executionError, requireMissionAuthority } from "./authority";
import { invocationResponseValidator } from "./executionProtocol";

/** Replaces only provider I/O: both real generation libraries still prepare and execute their turn. */
export function simulationFetch(
    response: Infer<typeof invocationResponseValidator>,
): typeof fetch {
    let dispatched = false;
    return async () => {
        if (dispatched) throw executionError("simulation_redispatch_forbidden");
        dispatched = true;
        const operations = response.kind === "operations";
        return new Response(
            JSON.stringify({
                id: "local-simulation",
                created: 1,
                model: "simulation/controlled-turn",
                choices: [
                    {
                        index: 0,
                        message: {
                            role: "assistant",
                            content: operations
                                ? null
                                : JSON.stringify(response),
                            ...(operations
                                ? {
                                      tool_calls: response.requests.map(
                                          (request) => ({
                                              id: request.callId,
                                              type: "function",
                                              function: {
                                                  name: request.name,
                                                  arguments: request.inputJson,
                                              },
                                          }),
                                      ),
                                  }
                                : {}),
                        },
                        finish_reason: operations ? "tool_calls" : "stop",
                    },
                ],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0,
                },
            }),
            { headers: { "Content-Type": "application/json" } },
        );
    };
}

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
