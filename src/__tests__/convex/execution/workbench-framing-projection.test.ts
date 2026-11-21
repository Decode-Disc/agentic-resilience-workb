import { api } from "@convex/_generated/api";
import { getAgentDefinition } from "@convex/execution/agentCatalog";
import { agentToolSchemas } from "@convex/execution/agentDefinition";
import { piToolMetadata } from "@convex/integrations/modelInput";
import { afterEach, assert, expect, test, vi } from "vitest";
import { fromJSONSchema } from "zod";
import {
    nativePiFixtureRoute,
    nativeTextReply,
    nativeToolReply,
} from "@/__tests__/setup/pi-native";
import { seedWorkbench } from "@/__tests__/setup/workbench";

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

test("new conversations expose initial requirements and refresh the schema after a saved draft", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "fixture-only");
    const scope =
        "Investigate insurer estimate review after the latest announcement.";
    const content = {
        scope,
        questions: [
            {
                id: "rights",
                shortLabel: "Rights",
                text: "Who controls estimate review?",
                rationale: "Identify workflow authority.",
            },
        ],
    };
    const { t, client, runId } = await seedWorkbench(
        false,
        nativePiFixtureRoute,
        60000,
        scope,
        undefined,
        null,
    );
    const errors: unknown[] = [];
    let generation = 0;
    vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (_url, init) => {
            try {
                const request = JSON.parse(String(init?.body));
                const tool = request.tools.find(
                    (tool: { function: { name: string } }) =>
                        tool.function.name === "adjust_framing",
                );
                const schema = fromJSONSchema(tool.function.parameters);
                const step = generation++;
                if (step < 2) {
                    expect(
                        schema.safeParse({
                            content,
                            eventBasis: { kind: "open" },
                        }).success,
                    ).toBe(false);
                    expect(schema.safeParse({ content }).success).toBe(false);
                    expect(
                        schema.safeParse({
                            content,
                            eventBasis: {
                                kind: "open",
                                activityExcerpt: scope,
                            },
                        }).success,
                    ).toBe(true);
                }
                if (step === 0)
                    return nativeToolReply("adjust_framing", {
                        content,
                        eventBasis: { kind: "open" },
                    });
                const rawReceipt = request.messages
                    .filter((m: { role: string }) => m.role === "tool")
                    .at(-1).content;
                if (step === 1) {
                    expect(rawReceipt).toContain("eventBasis.activityExcerpt");
                    expect(rawReceipt).not.toContain(
                        "none for ordinary framing",
                    );
                    return nativeToolReply("adjust_framing", {
                        content,
                        eventBasis: { kind: "open", activityExcerpt: scope },
                    });
                }
                const receipt = JSON.parse(rawReceipt);
                expect(receipt.kind).toBe("success");
                expect(schema.safeParse({ content }).success).toBe(true);
                if (step === 2)
                    return nativeToolReply("adjust_framing", {
                        content: {
                            ...content,
                            questions: [
                                ...content.questions,
                                {
                                    id: "switching",
                                    shortLabel: "Switching",
                                    text: "Which dependencies constrain switching?",
                                    rationale: "Test substitution.",
                                },
                            ],
                        },
                    });
                return nativeTextReply(
                    "The provisional program is saved; the announcement remains unresolved.",
                );
            } catch (error) {
                errors.push(error);
                return nativeTextReply("The proposal could not be saved.");
            }
        }),
    );
    await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(10), 250);
    if (errors.length) throw errors[0];
    expect(generation).toBe(4);
    expect(await client.query(api.framing.get, { runId })).toMatchObject({
        revision: 3,
        content: {
            scope,
            questions: [
                ...content.questions,
                expect.objectContaining({ id: "switching" }),
            ],
        },
        eventBasis: { kind: "open", activityExcerpt: scope },
    });
    const conversation = await t.run((ctx) =>
        ctx.db
            .query("agentConversations")
            .withIndex("by_run", (q) => q.eq("runId", runId))
            .unique(),
    );
    expect(conversation?.definitionVersion).toBe(12);
}, 30000);

test.each([
    5, 6, 7, 8,
])("retained definition %s preserves its optional open anchor", async (version) => {
    const definition = getAgentDefinition("workbench_v1", version);
    const operations = agentToolSchemas(definition, {
        framing: { revision: 1, fixed: false, scope: "", questions: [] },
        conversationInstructions: {
            messages: [
                { messageId: "active", text: "Investigate estimate review." },
            ],
        },
    });
    assert(operations.adjust_framing);
    const metadata = await piToolMetadata(
        "adjust_framing",
        operations.adjust_framing,
    );
    expect(metadata).toBeDefined();
    // Runtime admission still enforces the retained version's business requirements.
    expect(
        fromJSONSchema(
            JSON.parse(JSON.stringify(metadata.parameters)),
        ).safeParse({
            content: { scope: "Estimate review", questions: [] },
            eventBasis: { kind: "open" },
        }).success,
    ).toBe(true);
});
