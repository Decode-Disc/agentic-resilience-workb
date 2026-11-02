import { defineTable } from "convex/server";
import { v } from "convex/values";

export const modelAgent = v.union(
    v.literal("workbench"),
    v.literal("sources"),
    v.literal("investigation"),
    v.literal("synthesis"),
    v.literal("saved_material_inspection"),
);
export const reasoningEffort = v.union(
    v.literal("none"),
    v.literal("minimal"),
    v.literal("low"),
    v.literal("medium"),
    v.literal("high"),
    v.literal("xhigh"),
    v.literal("max"),
);
export const initialModelSelection = v.object({
    catalogId: v.id("modelCatalog"),
    reasoningEffort: v.optional(reasoningEffort),
});
export const reasoningEffortValues = reasoningEffort.members.map(
    (member) => member.value,
);
/** Shared preparation identity for administrator admission and its action. */
export const modelPreparationInput = v.object({
    model: v.string(),
    provider: v.optional(v.string()),
    catalogId: v.optional(v.id("modelCatalog")),
    label: v.string(),
    requestKey: v.string(),
    expectedRevision: v.optional(v.number()),
});
export const modelDescriptor = v.object({
    contextWindow: v.number(),
    maxTokens: v.number(),
    reasoning: v.boolean(),
    reasoningEfforts: v.optional(v.array(reasoningEffort)),
    reasoningMandatory: v.optional(v.boolean()),
    reasoningDefault: v.optional(reasoningEffort),
    inputPrice: v.number(),
    outputPrice: v.number(),
    cacheReadPrice: v.number(),
    structuredOutputs: v.boolean(),
});
export const effectiveModelConfiguration = v.object({
    model: v.string(),
    provider: v.optional(v.string()),
    descriptor: modelDescriptor,
    reasoningEffort: v.optional(reasoningEffort),
});
export const nativeProfile = v.object({ key: v.string(), bytes: v.number() });
export const modelConfigurationTables = {
    modelCatalog: defineTable({
        model: v.string(),
        provider: v.optional(v.string()),
        label: v.string(),
        revision: v.number(),
        enabled: v.boolean(),
        workbenchSelectable: v.boolean(),
        status: v.union(
            v.literal("preparing"),
            v.literal("ready"),
            v.literal("failed"),
        ),
        failure: v.optional(v.string()),
        currentRevisionId: v.optional(v.id("modelRevisions")),
        defaultsInitialized: v.optional(v.boolean()),
        preparedSerializer: v.optional(v.string()),
        preparationKey: v.string(),
        preparationHash: v.string(),
        lastUpdateKey: v.optional(v.string()),
        lastUpdateHash: v.optional(v.string()),
        updatedAt: v.number(),
    })
        .index("by_model_and_provider", ["model", "provider"])
        .index("by_preparation_key", ["preparationKey"])
        .index("by_enabled_and_workbench_selectable", [
            "enabled",
            "workbenchSelectable",
        ]),
    modelRevisions: defineTable({
        catalogId: v.id("modelCatalog"),
        revision: v.number(),
        ...effectiveModelConfiguration.fields,
        preparationHash: v.string(),
        createdAt: v.number(),
    }).index("by_catalog_and_revision", ["catalogId", "revision"]),
    nativeInputProfiles: defineTable({
        key: v.string(),
        bytes: v.number(),
    }).index("by_key", ["key"]),
    agentModelSettings: defineTable({
        agent: modelAgent,
        catalogId: v.id("modelCatalog"),
        revision: v.number(),
        requestKey: v.string(),
        requestHash: v.string(),
        updatedAt: v.number(),
    }).index("by_agent", ["agent"]),
};
