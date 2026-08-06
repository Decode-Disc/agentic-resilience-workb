import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import { manualSourceIntakeError } from "./domain/manualSourceIntake";

const preparationResultValidator = v.object({
    preparationId: v.id("manualSourcePreparations"),
    canonicalUrl: v.string(),
    title: v.string(),
    expiresAt: v.number(),
});

function requireBoundedKey(value: string, name: string): string {
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > 128) {
        throw new Error(`Invalid ${name}`);
    }
    return normalized;
}

export const findPreparation = internalQuery({
    args: {
        collectionKey: v.string(),
        requestKey: v.string(),
        inputDigest: v.string(),
        now: v.number(),
    },
    returns: v.union(preparationResultValidator, v.null()),
    handler: async (ctx, args) => {
        const ownerAuthUserId = await getAuthUserId(ctx);
        if (!ownerAuthUserId) {
            throw new Error("Not authenticated");
        }
        const collectionKey = requireBoundedKey(
            args.collectionKey,
            "collection key",
        );
        const requestKey = requireBoundedKey(args.requestKey, "request key");
        const inputDigest = requireBoundedKey(args.inputDigest, "input digest");
        const existing = await ctx.db
            .query("manualSourcePreparations")
            .withIndex(
                "by_owner_auth_user_and_collection_key_and_request_key",
                (query) =>
                    query
                        .eq("ownerAuthUserId", ownerAuthUserId)
                        .eq("collectionKey", collectionKey)
                        .eq("requestKey", requestKey),
            )
            .unique();
        if (!existing) {
            return null;
        }
        if (existing.expiresAt <= args.now || existing.consumedAt) {
            throw new ConvexError(
                manualSourceIntakeError("preparation_expired", {
                    preparationId: existing._id,
                }).data,
            );
        }
        if (existing.inputDigest !== inputDigest) {
            throw new Error("Preparation request key is already in use");
        }
        return {
            preparationId: existing._id,
            canonicalUrl: existing.canonicalUrl,
            title: existing.title,
            expiresAt: existing.expiresAt,
        };
    },
});

export const persistPreparation = internalMutation({
    args: {
        collectionKey: v.string(),
        requestKey: v.string(),
        inputDigest: v.string(),
        canonicalUrl: v.string(),
        title: v.string(),
        providerReference: v.string(),
        expiresAt: v.number(),
    },
    returns: preparationResultValidator,
    handler: async (ctx, args) => {
        const ownerAuthUserId = await getAuthUserId(ctx);
        if (!ownerAuthUserId) {
            throw new Error("Not authenticated");
        }
        const collectionKey = requireBoundedKey(
            args.collectionKey,
            "collection key",
        );
        const requestKey = requireBoundedKey(args.requestKey, "request key");
        const inputDigest = requireBoundedKey(args.inputDigest, "input digest");
        const existing = await ctx.db
            .query("manualSourcePreparations")
            .withIndex(
                "by_owner_auth_user_and_collection_key_and_request_key",
                (query) =>
                    query
                        .eq("ownerAuthUserId", ownerAuthUserId)
                        .eq("collectionKey", collectionKey)
                        .eq("requestKey", requestKey),
            )
            .unique();
        if (existing) {
            if (
                existing.inputDigest !== inputDigest ||
                existing.canonicalUrl !== args.canonicalUrl
            ) {
                throw new Error("Preparation request key is already in use");
            }
            if (existing.expiresAt <= Date.now() || existing.consumedAt) {
                throw new ConvexError(
                    manualSourceIntakeError("preparation_expired", {
                        preparationId: existing._id,
                    }).data,
                );
            }
            return {
                preparationId: existing._id,
                canonicalUrl: existing.canonicalUrl,
                title: existing.title,
                expiresAt: existing.expiresAt,
            };
        }
        const now = Date.now();
        if (args.expiresAt <= now) {
            throw new Error("Preparation expiry must be in the future");
        }
        const preparationId = await ctx.db.insert("manualSourcePreparations", {
            ownerAuthUserId,
            collectionKey,
            requestKey,
            inputDigest,
            canonicalUrl: args.canonicalUrl,
            title: args.title,
            providerReference: args.providerReference,
            expiresAt: args.expiresAt,
            createdAt: now,
        });
        return {
            preparationId,
            canonicalUrl: args.canonicalUrl,
            title: args.title,
            expiresAt: args.expiresAt,
        };
    },
});
