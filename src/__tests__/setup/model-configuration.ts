import { api, internal } from "@convex/_generated/api";
import type { ModelRoute } from "@convex/integrations/modelRouting";
import { NATIVE_PROFILE_CATALOG } from "@convex/integrations/modelRouting";
import { prepareNativeProfiles } from "@convex/integrations/piModelProfiles";
import type { modelDescriptor } from "@convex/modelConfigurationSchema";
import {
    NATIVE_PROFILE_BATCH_SIZE,
    RESOURCE_POLICY_VERSION,
    STRUCTURED_OUTPUT_POLICY,
} from "@convex/resourcePolicy";
import type schema from "@convex/schema";
import type { Infer } from "convex/values";
import type { TestConvex } from "convex-test";
import { vi } from "vitest";
import { SOURCES_TEST_WINDOW_MINUTES } from "./sources-mission";

/** An explicit current grant for deterministic transport fixtures, evaluated at fixture creation. */
export function modelAttemptAuthority(
    deadlineAt = Date.now() + SOURCES_TEST_WINDOW_MINUTES * 60_000,
) {
    return {
        resourcePolicy: RESOURCE_POLICY_VERSION,
        deadlineAt,
        structuredOutputPolicy: STRUCTURED_OUTPUT_POLICY,
    };
}

export const fixtureModelDescriptor = {
    contextWindow: 131072,
    maxTokens: 8192,
    reasoning: false,
    inputPrice: 0.03,
    outputPrice: 0.1,
    cacheReadPrice: 0.01,
    structuredOutputs: true,
};

const prepared = new Map<string, ReturnType<typeof prepareNativeProfiles>>();

/** Supplies a real configured binding; only provider metadata is a deterministic external fixture. */
export async function installModel(
    t: TestConvex<typeof schema>,
    route: ModelRoute,
    agent: "workbench" | "sources" | "saved_material_inspection" = "workbench",
    capabilities: Partial<
        Pick<
            Infer<typeof modelDescriptor>,
            | "reasoningEfforts"
            | "reasoningMandatory"
            | "reasoningDefault"
            | "contextWindow"
            | "maxTokens"
        >
    > = {},
) {
    if (process.env.SOURCES_PREPARATION_WINDOW_MINUTES === undefined)
        vi.stubEnv(
            "SOURCES_PREPARATION_WINDOW_MINUTES",
            String(SOURCES_TEST_WINDOW_MINUTES),
        );
    const userId = await t.run(async (ctx) => {
        const existing = await ctx.db
            .query("invitations")
            .withIndex("by_slot_key", (q) => q.eq("slotKey", "admin"))
            .unique();
        if (existing?.claimedByVisitorId) {
            const visitor = await ctx.db.get(existing.claimedByVisitorId);
            if (visitor?.authUserId) return visitor.authUserId;
        }
        const userId = await ctx.db.insert("users", { isAnonymous: true });
        const invitationId = await ctx.db.insert("invitations", {
            slotKey: "admin",
            role: "admin",
            codeDigest: "model-admin",
            status: "claimed",
            createdAt: 1,
        });
        const visitorId = await ctx.db.insert("visitors", {
            authUserId: userId,
            invitationId,
            role: "admin",
            status: "active",
            analysesReserved: 0,
            admittedAt: 1,
        });
        await ctx.db.patch(invitationId, { claimedByVisitorId: visitorId });
        return userId;
    });
    const admin = t.withIdentity({ subject: userId });
    const descriptor = {
        ...fixtureModelDescriptor,
        reasoning: !!route.reasoningEffort,
        ...(route.reasoningEffort
            ? { reasoningEfforts: [route.reasoningEffort] }
            : {}),
        ...capabilities,
    };
    const key = JSON.stringify({ route, capabilities });
    let profiles = prepared.get(key);
    if (!profiles) {
        profiles = prepareNativeProfiles(route, descriptor);
        prepared.set(key, profiles);
    }
    const pending = await admin.mutation(
        internal.modelConfiguration.beginPreparation,
        {
            model: route.model,
            provider: route.provider,
            label: route.model,
            requestKey: `prepare:${route.model}`,
        },
    );
    const allProfiles = await profiles;
    let offset = 0;
    for (
        ;
        offset + NATIVE_PROFILE_BATCH_SIZE < allProfiles.length;
        offset += NATIVE_PROFILE_BATCH_SIZE
    ) {
        await admin.mutation(
            internal.modelConfiguration.retainNativeProfileBatch,
            {
                profileCatalog: NATIVE_PROFILE_CATALOG,
                profiles: allProfiles.slice(
                    offset,
                    offset + NATIVE_PROFILE_BATCH_SIZE,
                ),
            },
        );
    }
    const ready = await admin.mutation(
        internal.modelConfiguration.finishPreparation,
        {
            catalogId: pending.catalogId,
            revision: pending.revision,
            descriptor,
            profileCatalog: NATIVE_PROFILE_CATALOG,
            profiles: allProfiles.slice(offset),
        },
    );
    await admin.mutation(api.modelConfiguration.updateAvailability, {
        catalogId: ready.catalogId,
        expectedRevision: ready.revision,
        enabled: true,
        workbenchSelectable: true,
        requestKey: `enable:${route.model}`,
    });
    const config = await admin.query(api.modelConfiguration.list, {});
    const existing = config.assignments.find((a) => a.agent === agent);
    await admin.mutation(api.modelConfiguration.assign, {
        agent,
        catalogId: ready.catalogId,
        expectedRevision: existing?.revision ?? 0,
        requestKey: `assign:${route.model}`,
    });
    return { admin, catalogId: ready.catalogId };
}
