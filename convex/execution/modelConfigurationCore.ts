import type { Doc, Id } from "@convex/_generated/dataModel";
import type { MutationCtx, QueryCtx } from "@convex/_generated/server";
import { DEFAULT_RESPONSE_CONTROL_POLICY } from "@convex/domain/workbenchResponseControlContracts";
import {
    modelConfigurationKey,
    NATIVE_MODEL_SERIALIZER,
    NATIVE_PROFILE_CATALOG,
} from "@convex/integrations/modelRouting";
import type {
    effectiveModelConfiguration,
    modelAgent,
    reasoningEffort,
} from "@convex/modelConfigurationSchema";
import type { Infer } from "convex/values";
import { executionError, executionFailureCode } from "./errors";
export function requireAgentCompatibility(
    agent: Infer<typeof modelAgent>,
    revision: Doc<"modelRevisions"> | null,
) {
    if (!revision) throw executionError("model_unavailable");
    if (agent !== "workbench" && !revision.descriptor.structuredOutputs)
        throw executionError("model_not_compatible");
    return revision;
}
export function modelPrepared(model: Doc<"modelCatalog">) {
    return (
        model.status === "ready" &&
        model.preparedSerializer === NATIVE_MODEL_SERIALIZER &&
        model.preparedProfileCatalog === NATIVE_PROFILE_CATALOG
    );
}

export async function resolveAgentModel(
    ctx: QueryCtx,
    agent: Infer<typeof modelAgent>,
    selected?: Id<"modelCatalog">,
) {
    const setting = selected
        ? null
        : await ctx.db
              .query("agentModelSettings")
              .withIndex("by_agent", (q) => q.eq("agent", agent))
              .unique();
    const id = selected ?? setting?.catalogId;
    const catalog = id ? await ctx.db.get(id) : null;
    if (
        !catalog?.enabled ||
        !modelPrepared(catalog) ||
        !catalog.currentRevisionId ||
        (selected && !catalog.workbenchSelectable)
    )
        throw executionError("model_unavailable");
    const revision = await ctx.db.get(catalog.currentRevisionId);
    return requireAgentCompatibility(agent, revision);
}

export function revisionRoute(
    revision: Infer<typeof effectiveModelConfiguration>,
) {
    return {
        model: revision.model,
        provider: revision.provider,
        reasoningEffort: revision.reasoningEffort,
        descriptor: revision.descriptor,
        profileKey: modelConfigurationKey(revision.descriptor),
        authorizedForAgent: true as const,
    };
}

/** Explicit dossier choices must remain valid for the selected immutable configuration. */
export function requireReasoningEffort(
    model: Doc<"modelRevisions">,
    effort: Infer<typeof reasoningEffort> | undefined,
) {
    if (effort === undefined) return;
    const available = model.descriptor.reasoningEfforts;
    if (
        (available
            ? !available.includes(effort)
            : effort !== model.reasoningEffort) ||
        (effort === "none" && model.descriptor.reasoningMandatory)
    )
        throw executionError("model_effort_unavailable");
}

/** Admission and recovery share one immutable routing decision, independent of worker lifetimes. */
export async function pinMissionModel(
    ctx: MutationCtx,
    mission: Doc<"agentMissions">,
) {
    if (mission.modelRevisionId) return;
    const agent =
        mission.definitionId === "workbench_v1"
            ? "workbench"
            : mission.definitionId === "sources_v1"
              ? "sources"
              : mission.definitionId === "saved_material_inspection_v1"
                ? "saved_material_inspection"
                : null;
    if (
        !agent ||
        (agent === "workbench" &&
            process.env.WORKBENCH_AGENT_ENABLED !== "true")
    )
        return;
    const conversation =
        agent === "workbench"
            ? await ctx.db
                  .query("agentConversations")
                  .withIndex("by_run", (q) => q.eq("runId", mission.runId))
                  .unique()
            : null;
    let model: Doc<"modelRevisions">;
    let effort: Infer<typeof reasoningEffort> | undefined;
    try {
        model = await resolveAgentModel(
            ctx,
            agent,
            conversation?.modelCatalogId,
        );
        effort = conversation?.reasoningEffort ?? model.reasoningEffort;
        requireReasoningEffort(model, effort);
    } catch (error) {
        // The executor records the existing typed missing-route outcome without dispatch.
        if (
            ["model_unavailable", "model_effort_unavailable"].includes(
                executionFailureCode(error) ?? "",
            )
        )
            return;
        throw error;
    }
    await ctx.db.patch(mission._id, {
        modelRevisionId: model._id,
        ...(effort ? { reasoningEffort: effort } : {}),
    });
    if (conversation && !conversation.modelCatalogId)
        await ctx.db.patch(conversation._id, {
            modelCatalogId: model.catalogId,
        });
}

export async function missionModel(
    ctx: QueryCtx,
    mission: Doc<"agentMissions">,
) {
    if (
        mission.definitionId === "workbench_v1" &&
        process.env.WORKBENCH_AGENT_ENABLED !== "true"
    )
        return undefined;
    const revision = mission.modelRevisionId
        ? await ctx.db.get(mission.modelRevisionId)
        : null;
    return revision
        ? {
              model: revision.model,
              provider: revision.provider,
              descriptor: revision.descriptor,
              reasoningEffort:
                  mission.reasoningEffort ?? revision.reasoningEffort,
          }
        : undefined;
}

export async function readResponseControlPolicy(ctx: QueryCtx) {
    const row = await ctx.db
        .query("responseControlSettings")
        .withIndex("by_key", (q) => q.eq("key", "global"))
        .unique();
    if (!row) return { ...DEFAULT_RESPONSE_CONTROL_POLICY };
    const {
        _id,
        _creationTime,
        key: _key,
        updatedAt: _updatedAt,
        ...policy
    } = row;
    return policy;
}
