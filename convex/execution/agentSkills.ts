import { internal } from "@convex/_generated/api";
import { sha256Hex } from "@convex/domain/sourcePassages";
import packages from "@convex/integrations/agentSkillPackages.json";
import { activeResponseControl } from "@convex/responseControl";
import { zodToConvex } from "convex-helpers/server/zod4";
import { getAgentDefinition } from "./agentCatalog";
import type { AgentSkillBinding } from "./agentSkillContracts";
import { skillReadInput, skillReadResult } from "./agentSkillContracts";
import { executionError, executionFailureCode } from "./errors";
import type { AgentOperationDefinition } from "./executionProtocol";
import { operationReuseIdentity } from "./missionData";
import { operationResultValidator } from "./operationResults";

export function skillPackage(binding: AgentSkillBinding) {
    const pkg = packages.packages.find((item) => item.id === binding.packageId);
    if (!pkg) throw executionError("skill_package_unavailable");
    const { hash, ...content } = pkg;
    if (sha256Hex(JSON.stringify(content)) !== hash)
        throw executionError("skill_package_mismatch");
    const skill = pkg.skills[binding.skillName];
    if (!skill) throw executionError("skill_resource_unavailable");
    return { pkg, skill };
}
export function skillCatalogue(binding: AgentSkillBinding): string {
    return skillPackage(binding).skill.catalogue;
}

/** Resolves only explicitly admitted immutable Markdown resources; there is no host filesystem fallback. */
export function skillResource(binding: AgentSkillBinding, path: string) {
    const { pkg, skill } = skillPackage(binding);
    if (!skill.paths.includes(path))
        throw executionError("skill_resource_not_allowed");
    const resource = pkg.resources.find((item) => item.path === path);
    if (!resource) throw executionError("skill_resource_unavailable");
    if (sha256Hex(resource.content) !== resource.hash)
        throw executionError("skill_package_mismatch");
    return { pkg, resource };
}

export const readSkillOperation: AgentOperationDefinition = {
    effectKind: "durable_effect",
    contextRead: true,
    version: 1,
    description:
        "Read the admitted task skill or its references. Use the catalogue's absolute path; offset is a one-based line number and limit is a line count. Relative annex paths resolve from the bound skill directory (the parent of SKILL.md).",
    inputValidator: skillReadInput,
    resultValidator: operationResultValidator(zodToConvex(skillReadResult)),

    identity(context) {
        if (
            context.input.kind !== "read" ||
            context.pin?.kind !== "agent_skill"
        )
            return operationReuseIdentity(context);
        const binding =
            context.mission &&
            getAgentDefinition(
                context.mission.definitionId,
                context.mission.definitionVersion,
            ).skills;
        const count = binding
            ? skillResource(binding, context.pin.path).resource.content.split(
                  "\n",
              ).length
            : undefined;
        return operationReuseIdentity({
            ...context,
            input: {
                ...context.input,
                path: context.pin.path,
                offset: context.input.offset ?? 1,
                limit:
                    count === undefined
                        ? context.input.limit
                        : Math.min(
                              context.input.limit ?? count,
                              count - (context.input.offset ?? 1) + 1,
                          ),
            },
        });
    },
    scheduledAction: internal.integrations.agentSkillReader.execute,
    async pin(ctx, mission, input) {
        if (!mission || input.kind !== "read")
            return { kind: "unavailable", code: "mission_required" };
        if (mission.definitionId === "workbench_v1") {
            const run = await ctx.db.get(mission.runId);
            const control = await activeResponseControl(ctx, mission);
            if (!run || run.fixedFramingRevisionId || control.correction)
                return {
                    kind: "unavailable",
                    code: "skill_resource_not_allowed",
                };
        }
        const binding = getAgentDefinition(
            mission.definitionId,
            mission.definitionVersion,
        ).skills;
        if (!binding)
            return { kind: "unavailable", code: "skill_resource_not_allowed" };
        if (
            [input.offset, input.limit].some(
                (value) =>
                    value !== undefined &&
                    (!Number.isSafeInteger(value) || value < 1),
            )
        )
            return { kind: "unavailable", code: "invalid_operation_input" };
        let path: string;
        try {
            path = new URL(
                input.path,
                `file:///agent-skills/${binding.packageId}/${binding.skillName}/`,
            ).pathname;
        } catch (error) {
            if (error instanceof TypeError)
                return { kind: "unavailable", code: "invalid_operation_input" };
            throw error;
        }
        let resolved: ReturnType<typeof skillResource>;
        try {
            resolved = skillResource(binding, path);
        } catch (error) {
            const code = executionFailureCode(error);
            if (code?.startsWith("skill_"))
                return { kind: "unavailable", code };
            throw error;
        }
        const { pkg, resource } = resolved;
        if ((input.offset ?? 1) > resource.content.split("\n").length)
            return { kind: "unavailable", code: "invalid_operation_input" };
        return {
            kind: "available",
            pin: {
                kind: "agent_skill",
                packageId: pkg.id,
                packageHash: pkg.hash,
                path: resource.path,
                resourceHash: resource.hash,
            },
        };
    },
    validateOutcome(request, outcome) {
        if (outcome.kind !== "success") return outcome;
        const value = skillReadResult.parse(JSON.parse(outcome.valueJson));
        const pin = request.pin;
        if (
            pin?.kind !== "agent_skill" ||
            value.packageId !== pin.packageId ||
            value.resourceHash !== pin.resourceHash ||
            value.path !== pin.path
        )
            throw executionError("skill_package_mismatch");
        return outcome;
    },
};
