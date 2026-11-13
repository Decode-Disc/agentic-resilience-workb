import type { DocumentaryContribution } from "@convex/domain/sourcesContracts";
import { examineDocumentaryContributions } from "@convex/integrations/documentaryControl";
import { expect, test } from "vitest";
import { modelAttemptAuthority } from "@/__tests__/setup/model-configuration";

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

test.each([
    "missing",
    "expired",
])("a documentary request with %s authority cannot reach the provider", async (state) => {
    let dispatched = false;
    const result = await examineDocumentaryContributions(input, currentRoute, {
        apiKey: "offline-only",
        authority:
            state === "missing"
                ? undefined
                : {
                      resourcePolicy: "authority_native_v1",
                      deadlineAt: Date.now() - 1,
                  },
        fetch: async () => {
            dispatched = true;
            const { contributionId: _id, ...value } = finding;
            return providerReply({
                coherence: true,
                limitations: [],
                findings: { [contribution.id]: value },
            });
        },
    });
    expect(result).toMatchObject({
        status: "failed",
        dispatchOutcome: "not_dispatched",
        errorCode:
            state === "missing"
                ? "resource_policy_unsupported"
                : "execution_deadline",
    });
    expect(dispatched).toBe(false);
});

test.each([
    undefined,
    "source_actions_v3" as const,
])("current documentary authority supports retained workflow version %s", async (executionPlanVersion) => {
    let dispatched = false;
    const result = await examineDocumentaryContributions(
        input,
        { ...currentRoute, executionPlanVersion },
        {
            authority: modelAttemptAuthority(),
            apiKey: "offline-only",
            fetch: async () => {
                dispatched = true;
                return providerReply({
                    coherence: true,
                    limitations: [],
                    findings: {
                        [contribution.id]: {
                            conclusion: finding.conclusion,
                            permittedUse: finding.permittedUse,
                            diagnostic: finding.diagnostic,
                        },
                    },
                });
            },
        },
    );
    expect(result).toMatchObject({
        status: "succeeded",
        dispatchOutcome: "response_received",
        output: { findings: [finding] },
    });
    expect(dispatched).toBe(true);
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
        authority: modelAttemptAuthority(),
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
        authority: modelAttemptAuthority(),
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

test("a legacy findings array is refused by the current schema without losing the raw reply", async () => {
    const output = {
        coherence: true,
        limitations: [],
        findings: [finding, finding],
    };
    const result = await examineDocumentaryContributions(input, currentRoute, {
        authority: modelAttemptAuthority(),
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
    });
    expect(result).toMatchObject({
        status: "failed",
        errorCode: "invalid_output",
        outputDiagnostic: {
            reason: "schema_invalid",
            output: JSON.stringify(output),
            finishReason: "stop",
        },
    });
});
