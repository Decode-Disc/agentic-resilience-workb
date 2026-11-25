import { internal } from "@convex/_generated/api";
import { internalAction, internalQuery } from "@convex/_generated/server";
import { localBrowserFixturesEnabled } from "@convex/runWorkspace";
import { type Infer, v } from "convex/values";
import { getAgentDefinition } from "./agentCatalog";
import { agentDefinitionIdValidator } from "./agentSchemas";
import { executionError, requireMissionAuthority } from "./authority";
import { invocationResponseValidator } from "./executionProtocol";
import { admittedInputFragment, admittedInputHash } from "./journal";
import { verifyRetainedText } from "./retainedText";

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

const invocationScope = {
    invocationId: v.id("agentInvocations"),
    expectedGeneration: v.number(),
};

export const admittedFragment = internalQuery({
    args: {
        ...invocationScope,
        index: v.number(),
        contentHash: v.optional(v.string()),
    },
    returns: v.object({
        definitionId: agentDefinitionIdValidator,
        definitionVersion: v.number(),
        content: v.string(),
        contentHash: v.string(),
        sizeBytes: v.number(),
        characters: v.number(),
        fragmentCount: v.number(),
    }),
    handler: async (ctx, args) => {
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
        const contentHash = admittedInputHash(invocation);
        if (args.contentHash !== undefined && args.contentHash !== contentHash)
            throw executionError("invocation_input_invalid");
        return {
            definitionId: mission.definitionId,
            definitionVersion: mission.definitionVersion,
            ...(await admittedInputFragment(
                ctx,
                invocation,
                args.index,
                contentHash,
            )),
        };
    },
});

/** A local scripted model exercises the real executor without dispatching to a provider. */
export const invoke = internalAction({
    args: invocationScope,
    returns: invocationResponseValidator,
    handler: async (
        ctx,
        args,
    ): Promise<Infer<typeof invocationResponseValidator>> => {
        const read = internal.execution.simulation.admittedFragment;
        const first = await ctx.runQuery(read, { ...args, index: 0 });
        const definition = getAgentDefinition(
            first.definitionId,
            first.definitionVersion,
        );
        if (!definition.simulate)
            throw executionError("simulation_not_configured");
        const fragments = [first.content];
        for (let index = 1; index < first.fragmentCount; index++) {
            const next = await ctx.runQuery(read, {
                ...args,
                index,
                contentHash: first.contentHash,
            });
            if (
                next.definitionId !== first.definitionId ||
                next.definitionVersion !== first.definitionVersion
            )
                throw executionError("invocation_input_invalid");
            fragments.push(next.content);
        }
        return definition.simulate(
            JSON.parse(verifyRetainedText(first, fragments.join(""))),
        );
    },
});
