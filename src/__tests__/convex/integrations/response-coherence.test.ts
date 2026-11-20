import { RESPONSE_CONTROL_LIMITS } from "@convex/domain/workbenchResponseControlContracts";
import {
    checkResponseCoherence,
    verifyResponseControlModel,
} from "@convex/integrations/responseCoherence";
import { expect, test, vi } from "vitest";
import { modelAttemptAuthority } from "@/__tests__/setup/model-configuration";

test.each([
    "missing",
    "expired",
])("response control with %s authority cannot reach the provider", async (state) => {
    const fetch = vi.fn(async () => Response.json({}));
    const result = await checkResponseCoherence({
        requestJson: "{}",
        apiKey: "offline-only",
        fetch,
        authority:
            state === "missing"
                ? undefined
                : {
                      resourcePolicy: "authority_native_v1",
                      deadlineAt: Date.now() - 1,
                  },
    });
    expect(result).toMatchObject({
        status: "unavailable",
        reason:
            state === "missing"
                ? "resource_policy_unsupported"
                : "execution_deadline",
    });
    expect(fetch).not.toHaveBeenCalled();
});

test("oversized malformed native responses cannot expand the retained audit", async () => {
    const fetch = vi.fn(
        async () =>
            new Response("x".repeat(RESPONSE_CONTROL_LIMITS.inputBytes + 1)),
    );
    const result = await checkResponseCoherence({
        authority: modelAttemptAuthority(),
        requestJson: "{}",
        apiKey: "test-key",
        fetch,
    });
    expect(result).toMatchObject({
        status: "unavailable",
        reason: "response_capacity",
    });
    expect(result.rawResponseJson).toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([
    { supported: 0.9, contradicted: 0.05, insufficient_information: 0.06 },
    { supported: 1.1, contradicted: -0.1, insufficient_information: 0 },
    { supported: 0.9, contradicted: 0.1 },
])("invalid native distributions stay unavailable without fabricated scores", async (probabilities) => {
    const fetch = vi.fn(async () =>
        Response.json({
            answers: {
                assessment: {
                    type: "choice",
                    choice: "supported",
                    confidence: 0.9,
                    probabilities,
                },
            },
        }),
    );
    const result = await checkResponseCoherence({
        authority: modelAttemptAuthority(),
        requestJson: "{}",
        apiKey: "test-key",
        fetch,
    });
    expect(result).toMatchObject({
        status: "unavailable",
        reason: "response_invalid",
    });
    expect(result).not.toHaveProperty("scores");
    expect(fetch).toHaveBeenCalledTimes(1);
});

test("native transport preserves probabilities and redacts accidental credential echoes", async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
        expect(init?.redirect).toBe("error");
        expect(JSON.parse(String(init?.body))).not.toHaveProperty("provider");
        return Response.json({
            model: "test-key",
            answers: {
                assessment: {
                    type: "choice",
                    choice: "supported",
                    confidence: 0.9,
                    probabilities: {
                        supported: 0.9,
                        contradicted: 0.05,
                        insufficient_information: 0.05,
                    },
                },
            },
            usage: { cost: 0.00001 },
        });
    });
    const result = await checkResponseCoherence({
        authority: modelAttemptAuthority(),
        requestJson: "{}",
        apiKey: "test-key",
        fetch,
    });
    expect(result).toMatchObject({
        status: "checked",
        reportedCost: 0.00001,
        scores: { supported: 0.9 },
    });
    expect(result.rawResponseJson).not.toContain("test-key");
});

test("response-control model verification rejects non-Decisions models, invalid pricing, and catalogue outages", async () => {
    const catalogueFetch = vi.fn(async (url: unknown) => {
        expect(String(url)).toBe(
            "https://openrouter.ai/api/v1/models?output_modalities=decisions",
        );
        return Response.json({
            data: [
                {
                    id: "openrouter/decisions-ok",
                    context_length: 32768,
                    pricing: { prompt: "0.0000001", completion: "0" },
                },
                {
                    id: "openrouter/decisions-paid-completion",
                    context_length: 32768,
                    pricing: { prompt: "0.0000001", completion: "0.000001" },
                },
                {
                    id: "openrouter/decisions-over-price",
                    context_length: 32768,
                    pricing: { prompt: "0.0000002", completion: "0" },
                },
            ],
        });
    });
    await expect(
        verifyResponseControlModel({
            model: "z-ai/glm-5.3-flash",
            fetch: catalogueFetch,
        }),
    ).resolves.toEqual({ ok: false, reason: "model_not_compatible" });
    await expect(
        verifyResponseControlModel({
            model: "openrouter/decisions-paid-completion",
            fetch: catalogueFetch,
        }),
    ).resolves.toEqual({ ok: false, reason: "model_not_compatible" });
    await expect(
        verifyResponseControlModel({
            model: "openrouter/decisions-over-price",
            fetch: catalogueFetch,
        }),
    ).resolves.toEqual({ ok: false, reason: "model_not_compatible" });
    await expect(
        verifyResponseControlModel({
            model: "openrouter/decisions-ok",
            fetch: catalogueFetch,
        }),
    ).resolves.toEqual({
        ok: true,
        model: "openrouter/decisions-ok",
        contextWindowTokens: 32768,
    });
    const outageFetch = vi.fn(
        async () => new Response("unavailable", { status: 503 }),
    );
    await expect(
        verifyResponseControlModel({
            model: "openrouter/decisions-ok",
            fetch: outageFetch,
        }),
    ).resolves.toEqual({ ok: false, reason: "configuration_unavailable" });
});
