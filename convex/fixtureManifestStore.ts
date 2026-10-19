import { v } from "convex/values";

import { env, internalMutation, internalQuery } from "./_generated/server";
import {
    showcaseClaimOutputValidator,
    freezeShowcaseManifestEntry,
    type ShowcaseManifestEntry,
} from "./domain/showcaseManifest";
import {
    MAX_CLAIMS_PER_RUN,
    MAX_CLAIM_STATEMENT_CHARS,
    MAX_CLAIM_RATIONALE_CHARS,
} from "./resourceLimits";

const manifestEntryValidator = v.object({
    inputHash: v.string(),
    fixtureId: v.string(),
    fixtureVersion: v.string(),
    schemaVersion: v.string(),
    adapterVersion: v.string(),
    claims: v.array(showcaseClaimOutputValidator),
});

/**
 * Persists a showcase manifest entry behind the local-only E2E gate so a real
 * local Convex deployment can resolve the identical fixture claims across
 * separate function invocations. Every read and write is gated on
 * E2E_FIXTURES_ENABLED; with the gate disabled this table stays empty and the
 * in-memory showcase manifest remains the only claim source.
 */
export const registerFixtureManifestEntry = internalMutation({
    args: manifestEntryValidator,
    returns: v.id("showcaseManifestEntries"),
    handler: async (ctx, args) => {
        if (env.E2E_FIXTURES_ENABLED !== "true") {
            throw new Error("E2E fixtures are disabled");
        }
        const entry: ShowcaseManifestEntry = {
            fixtureId: args.fixtureId,
            fixtureVersion: args.fixtureVersion,
            schemaVersion: args.schemaVersion,
            adapterVersion: args.adapterVersion,
            inputHash: args.inputHash,
            claims: args.claims,
        };
        // Freeze validates fixture/schema/adapter versions and deep-freezes the
        // entry so later caller mutation cannot change the durable manifest.
        const frozen = freezeShowcaseManifestEntry(entry);
        if (
            frozen.inputHash.length === 0 ||
            frozen.inputHash.length > 64 ||
            frozen.claims.length === 0 ||
            frozen.claims.length > MAX_CLAIMS_PER_RUN
        ) {
            throw new Error("Invalid durable showcase manifest entry");
        }
        for (const claim of frozen.claims) {
            if (
                !claim.statement ||
                claim.statement.trim().length === 0 ||
                claim.statement.length > MAX_CLAIM_STATEMENT_CHARS
            ) {
                throw new Error(
                    "Durable showcase claim has invalid statement length",
                );
            }
            if (
                claim.dimensionLinks.some(
                    (link) =>
                        link.rationale &&
                        link.rationale.length > MAX_CLAIM_RATIONALE_CHARS,
                )
            ) {
                throw new Error(
                    "Durable showcase claim rationale exceeds bounds",
                );
            }
        }
        const existing = await ctx.db
            .query("showcaseManifestEntries")
            .withIndex("by_input_hash", (query) =>
                query.eq("inputHash", frozen.inputHash),
            )
            .first();
        if (existing) {
            const normalizedIncoming = {
                inputHash: frozen.inputHash,
                fixtureId: frozen.fixtureId,
                fixtureVersion: frozen.fixtureVersion,
                schemaVersion: frozen.schemaVersion,
                adapterVersion: frozen.adapterVersion,
                claims: frozen.claims,
            };
            const normalizedExisting = {
                inputHash: existing.inputHash,
                fixtureId: existing.fixtureId,
                fixtureVersion: existing.fixtureVersion,
                schemaVersion: existing.schemaVersion,
                adapterVersion: existing.adapterVersion,
                claims: existing.claims,
            };
            if (
                JSON.stringify(normalizedIncoming) !==
                JSON.stringify(normalizedExisting)
            ) {
                throw new Error(
                    "Attempted to mutate immutable durable showcase manifest entry for existing input hash",
                );
            }
            return existing._id;
        }
        return ctx.db.insert("showcaseManifestEntries", {
            inputHash: frozen.inputHash,
            fixtureId: frozen.fixtureId,
            fixtureVersion: frozen.fixtureVersion,
            schemaVersion: frozen.schemaVersion,
            adapterVersion: frozen.adapterVersion,
            claims: frozen.claims,
            createdAt: Date.now(),
        });
    },
});

/**
 * Reads a persisted fixture manifest entry by exact input hash, or returns
 * null when the E2E gate is disabled or no exact match exists. Disabled gate
 * can never activate a fixture claim because this returns null without ever
 * query-scattering a persisted entry into a live claim path.
 */
export const getFixtureManifestEntry = internalQuery({
    args: { inputHash: v.string() },
    returns: v.union(
        v.null(),
        v.object({
            fixtureId: v.string(),
            fixtureVersion: v.string(),
            schemaVersion: v.string(),
            adapterVersion: v.string(),
            inputHash: v.string(),
            claims: v.array(showcaseClaimOutputValidator),
        }),
    ),
    handler: async (ctx, args) => {
        if (env.E2E_FIXTURES_ENABLED !== "true") {
            return null;
        }
        if (
            args.inputHash.length === 0 ||
            args.inputHash.length > 64 ||
            !/^[0-9a-f]{64}$/.test(args.inputHash)
        ) {
            return null;
        }
        const entry = await ctx.db
            .query("showcaseManifestEntries")
            .withIndex("by_input_hash", (query) =>
                query.eq("inputHash", args.inputHash),
            )
            .first();
        if (!entry) {
            return null;
        }
        return {
            fixtureId: entry.fixtureId,
            fixtureVersion: entry.fixtureVersion,
            schemaVersion: entry.schemaVersion,
            adapterVersion: entry.adapterVersion,
            inputHash: entry.inputHash,
            claims: entry.claims,
        };
    },
});
