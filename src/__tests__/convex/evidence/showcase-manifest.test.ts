/// <reference types="vite/client" />
import type { Id } from "@convex/_generated/dataModel";
import {
    clearShowcaseManifests,
    lookupShowcaseManifest,
    registerShowcaseManifest,
    type ShowcaseManifestEntry,
} from "@convex/domain/showcaseManifest";
import schema from "@convex/schema";
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, test } from "vitest";

const modules = import.meta.glob("/convex/**/*.ts");
const originalE2eFixturesEnabled = process.env.E2E_FIXTURES_ENABLED;

const registerFixtureManifestEntry = makeFunctionReference<
    "mutation",
    ShowcaseManifestEntry,
    Id<"showcaseManifestEntries">
>("fixtureManifestStore:registerFixtureManifestEntry");

const getFixtureManifestEntry = makeFunctionReference<
    "query",
    { inputHash: string },
    ShowcaseManifestEntry | null
>("fixtureManifestStore:getFixtureManifestEntry");

const sampleEntry: ShowcaseManifestEntry = {
    fixtureId: "ccc-showcase-claims",
    fixtureVersion: "ccc-showcase-v1",
    schemaVersion: "claim-v1",
    adapterVersion: "showcase-adapter-v1",
    inputHash:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    claims: [
        {
            statement:
                "CCC connects approximately 30,000 repair facilities and 300+ insurance carriers.",
            classification: "Fact",
            evidence: [
                {
                    quotationHash: "abc123hash",
                    passageKey: "passage-1",
                    relation: "supporting",
                },
            ],
            dimensionLinks: [
                {
                    dimensionKey: "workflow_control",
                    rationale: "Direct multi-sided network connections.",
                },
            ],
        },
    ],
};

afterEach(() => {
    clearShowcaseManifests();
    if (originalE2eFixturesEnabled === undefined) {
        delete process.env.E2E_FIXTURES_ENABLED;
    } else {
        process.env.E2E_FIXTURES_ENABLED = originalE2eFixturesEnabled;
    }
});

describe("in-memory showcase manifest registry", () => {
    test("registers and retrieves manifest entry", () => {
        registerShowcaseManifest(sampleEntry);
        const retrieved = lookupShowcaseManifest(sampleEntry.inputHash);
        expect(retrieved).not.toBeNull();
        expect(retrieved?.fixtureId).toBe(sampleEntry.fixtureId);
    });

    test("equivalent manifest replay returns without Map replacement and preserves object identity", () => {
        registerShowcaseManifest(sampleEntry);
        const first = lookupShowcaseManifest(sampleEntry.inputHash);
        expect(first).not.toBeNull();

        // Register identical clone
        const clone = JSON.parse(JSON.stringify(sampleEntry));
        registerShowcaseManifest(clone);

        const second = lookupShowcaseManifest(sampleEntry.inputHash);
        // Must be the exact same object reference in memory (Map.set was NOT called again)
        expect(second).toBe(first);
    });

    test("conflicting manifest replay throws and lookup remains unchanged", () => {
        registerShowcaseManifest(sampleEntry);
        const original = lookupShowcaseManifest(sampleEntry.inputHash);

        const conflicting: ShowcaseManifestEntry = {
            ...sampleEntry,
            fixtureId: "different-fixture-id",
        };

        expect(() => registerShowcaseManifest(conflicting)).toThrow(
            "Attempted to mutate immutable showcase manifest entry for existing input hash",
        );

        const afterConflict = lookupShowcaseManifest(sampleEntry.inputHash);
        expect(afterConflict).toBe(original);
        expect(afterConflict?.fixtureId).toBe(sampleEntry.fixtureId);
    });
});

describe("durable fixture manifest store", () => {
    test("durable exact replay returns existing row ID and getFixtureManifestEntry returns unchanged row", async () => {
        process.env.E2E_FIXTURES_ENABLED = "true";
        const t = convexTest(schema, modules);

        const id1 = await t.mutation(registerFixtureManifestEntry, sampleEntry);
        const id2 = await t.mutation(registerFixtureManifestEntry, sampleEntry);
        expect(id2).toBe(id1);

        const entry = await t.query(getFixtureManifestEntry, {
            inputHash: sampleEntry.inputHash,
        });
        expect(entry).not.toBeNull();
        expect(entry?.fixtureId).toBe(sampleEntry.fixtureId);
    });

    test("durable conflicting manifest replay throws and query lookup remains original", async () => {
        process.env.E2E_FIXTURES_ENABLED = "true";
        const t = convexTest(schema, modules);

        await t.mutation(registerFixtureManifestEntry, sampleEntry);

        const conflicting: ShowcaseManifestEntry = {
            ...sampleEntry,
            fixtureId: "conflicting-fixture-id",
        };

        await expect(
            t.mutation(registerFixtureManifestEntry, conflicting),
        ).rejects.toThrow(
            "Attempted to mutate immutable durable showcase manifest entry for existing input hash",
        );

        const entry = await t.query(getFixtureManifestEntry, {
            inputHash: sampleEntry.inputHash,
        });
        expect(entry?.fixtureId).toBe(sampleEntry.fixtureId);
    });
});
