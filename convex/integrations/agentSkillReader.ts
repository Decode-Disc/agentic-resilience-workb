"use node";
import { internal } from "@convex/_generated/api";
import { internalAction } from "@convex/_generated/server";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { skillResource } from "@convex/execution/agentSkills";
import {
    operationOutcomeValidator,
    scheduledOperationArgs,
} from "@convex/execution/executionProtocol";
import { executeScheduledOperation } from "@convex/execution/operations";
import { createReadTool } from "@earendil-works/pi-coding-agent";
import { v } from "convex/values";

export const execute = internalAction({
    args: scheduledOperationArgs,
    returns: v.union(operationOutcomeValidator, v.null()),
    handler: async (ctx, args) =>
        executeScheduledOperation(ctx, args, async () => {
            const admitted = await ctx.runQuery(
                internal.execution.operations.readScheduledInput,
                args,
            );
            if (
                admitted.input.kind !== "read" ||
                admitted.pin.kind !== "agent_skill" ||
                !admitted.binding
            )
                return {
                    kind: "unavailable",
                    code: "skill_resource_not_allowed",
                };
            const binding = getAgentDefinition(
                admitted.binding.id,
                admitted.binding.version,
            ).skills;
            if (!binding)
                return {
                    kind: "unavailable",
                    code: "skill_package_unavailable",
                };
            const { pkg, resource } = skillResource(binding, admitted.pin.path);
            const tool = createReadTool(
                `/agent-skills/${pkg.id}/${binding.skillName}/`,
                {
                    operations: {
                        access: async (path) => {
                            skillResource(binding, path);
                        },
                        readFile: async (path) =>
                            Buffer.from(
                                skillResource(binding, path).resource.content,
                            ),
                        detectImageMimeType: async () => null,
                    },
                },
            );
            const result = await tool.execute(String(args.requestId), {
                ...admitted.input,
                path: admitted.pin.path,
            });
            const text = result.content
                .map((item) => {
                    if (item.type !== "text")
                        throw new Error("Non-text skill resource");
                    return item.text;
                })
                .join("\n");
            return {
                kind: "success",
                valueJson: JSON.stringify({
                    packageId: pkg.id,
                    path: resource.path,
                    resourceHash: resource.hash,
                    text,
                }),
            };
        }),
});
