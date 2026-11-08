import type { DocumentaryContribution } from "@convex/domain/sourcesContracts";
import { examineDocumentaryContributions } from "@convex/integrations/documentaryControl";
import { expect, test } from "vitest";
import retained from "@/__tests__/setup/fixtures/documentary-control-replies.json";

const contribution: DocumentaryContribution = {
    id: "documentary-contribution",
    version: 1,
    needIds: ["common-context"],
    statement: "The company supplies estimating software.",
    period: "2025",
    modality: "company statement",
    attribution: "Annual report",
    kind: "asserted_fact",
    evidence: [],
};
const finding = {
    contributionId: contribution.id,
    conclusion: "supported",
    permittedUse: "documentary",
    diagnostic: "The quotation supports the supplied statement.",
};
const input = { contributions: [contribution], needs: [], evidence: [] };

const currentRoute = {
    model: "example/documentary",
    executionPlanVersion: "source_actions_v4" as const,
    descriptor: {
        contextWindow: 64000,
        maxTokens: 20000,
        reasoning: false,
        inputPrice: 0.01,
        outputPrice: 0.02,
        cacheReadPrice: 0,
        structuredOutputs: true,
    },
};

function providerReply(output: unknown, finishReason = "stop") {
    return Response.json({
        id: "offline-documentary",
        model: currentRoute.model,
        choices: [
            {
                index: 0,
                message: { role: "assistant", content: JSON.stringify(output) },
                finish_reason: finishReason,
            },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    });
}

test.each(
    retained.cases,
)("retains the original documentary refusal $id with its precise reason", async (original) => {
    const result = await examineDocumentaryContributions(
        {
            ...input,
            contributions: original.contributionIds.map((id) => ({
                ...contribution,
                id,
            })),
        },
        {
            model: currentRoute.model,
            executionPlanVersion: "source_actions_v3",
        },
        {
            apiKey: "offline-only",
            fetch: async () =>
                Response.json({
                    id: original.id,
                    model: currentRoute.model,
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content: original.text,
                            },
                            finish_reason: original.finishReason,
                        },
                    ],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: 10,
                        total_tokens: 20,
                    },
                }),
        },
    );
    expect(result).toMatchObject({
        status: "failed",
        errorCode: "invalid_output",
        outputDiagnostic: {
            output: original.text,
            reason:
                original.finishReason === "length"
                    ? "finish_reason_invalid"
                    : "documentary_control_identity_invalid",
        },
    });
});

test.each([
    {},
    {
        unknown: {
            conclusion: "supported",
            permittedUse: "documentary",
            diagnostic: "Unknown identity.",
        },
    },
])("new documentary examinations refuse incomplete or foreign findings", async (findings) => {
    const result = await examineDocumentaryContributions(input, currentRoute, {
        apiKey: "offline-only",
        fetch: async () =>
            providerReply({ coherence: true, limitations: [], findings }),
    });
    expect(result).toMatchObject({
        status: "failed",
        errorCode: "invalid_output",
        outputDiagnostic: { reason: "schema_invalid" },
    });
});

test("new documentary examinations bind provider findings to the submitted identities", async () => {
    let wire: Record<string, unknown> = {};
    const { contributionId: _id, ...value } = finding;
    const result = await examineDocumentaryContributions(input, currentRoute, {
        apiKey: "offline-only",
        fetch: async (_url, init) => {
            wire = JSON.parse(String(init?.body));
            return providerReply({
                coherence: true,
                limitations: [],
                findings: { [contribution.id]: value },
            });
        },
    });
    expect(result).toMatchObject({
        status: "succeeded",
        output: { findings: [finding], coherence: true, limitations: [] },
    });
    expect(wire).toMatchObject({
        messages: expect.arrayContaining([
            expect.objectContaining({
                role: "system",
                content: expect.arrayContaining([
                    expect.objectContaining({
                        text: expect.stringContaining("findings object"),
                    }),
                ]),
            }),
        ]),
        response_format: {
            json_schema: {
                schema: {
                    properties: {
                        findings: {
                            type: "object",
                            additionalProperties: false,
                            required: [contribution.id],
                        },
                    },
                },
            },
        },
    });
});

test("duplicate documentary findings retain the rejected reply and a precise diagnostic", async () => {
    const output = {
        coherence: true,
        limitations: [],
        findings: [finding, finding],
    };
    const result = await examineDocumentaryContributions(
        input,
        { model: "example/documentary" },
        {
            apiKey: "offline-only",
            fetch: async () =>
                Response.json({
                    id: "offline-documentary",
                    model: "example/documentary",
                    choices: [
                        {
                            index: 0,
                            message: {
                                role: "assistant",
                                content: JSON.stringify(output),
                            },
                            finish_reason: "stop",
                        },
                    ],
                    usage: {
                        prompt_tokens: 10,
                        completion_tokens: 10,
                        total_tokens: 20,
                    },
                }),
        },
    );
    expect(result).toMatchObject({
        status: "failed",
        errorCode: "invalid_output",
        outputDiagnostic: {
            reason: "documentary_control_identity_invalid",
            output: JSON.stringify(output),
            finishReason: "stop",
        },
    });
});
