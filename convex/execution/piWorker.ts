"use node";

import { internal } from "@convex/_generated/api";
import { internalAction } from "@convex/_generated/server";
import { executionError, executionFailureCode } from "@convex/execution/errors";
import { runPiMission } from "@convex/integrations/piMission";
import { nodeActionGenerationDeadline } from "@convex/resourcePolicy";
import { v } from "convex/values";

export const run = internalAction({
    args: {
        missionId: v.id("agentMissions"),
        expectedGeneration: v.number(),
        token: v.string(),
    },
    returns: v.null(),
    handler: async (ctx, args) => {
        const executionDeadlineAt = nodeActionGenerationDeadline(Date.now());
        const writer = crypto.randomUUID();
        const ready = await ctx.runMutation(
            internal.execution.piControl.prepare,
            { ...args, writer },
        );
        if (!ready) return null;
        try {
            await runPiMission(
                ctx,
                {
                    missionId: args.missionId,
                    expectedGeneration: args.expectedGeneration,
                },
                writer,
                executionDeadlineAt,
            );
        } catch (error) {
            await ctx.runMutation(internal.execution.piControl.closeWorker, {
                missionId: args.missionId,
                expectedGeneration: args.expectedGeneration,
                writer,
                error:
                    Date.now() >= executionDeadlineAt
                        ? "node_action_deadline"
                        : (executionFailureCode(error) ??
                          "execution_interrupted"),
            });
            if (!executionFailureCode(error))
                throw executionError("execution_interrupted");
        }
        return null;
    },
});
