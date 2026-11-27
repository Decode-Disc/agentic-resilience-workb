/** Encodes existing external model fixtures as the provider's native SSE protocol. */
export function providerFixtureResponse(
    value: unknown,
    init?: ResponseInit,
): Response {
    if (
        !value ||
        typeof value !== "object" ||
        !("choices" in value) ||
        !Array.isArray(value.choices)
    )
        return Response.json(value, init);
    const choices = value.choices.map(
        (choice: {
            index?: number;
            message?: unknown;
            finish_reason?: unknown;
        }) => ({
            index: choice.index ?? 0,
            delta: choice.message ?? {},
            finish_reason: choice.finish_reason ?? null,
        }),
    );
    return new Response(
        `data: ${JSON.stringify({ ...value, choices })}\n\ndata: [DONE]\n\n`,
        {
            ...init,
            headers: {
                ...Object.fromEntries(new Headers(init?.headers)),
                "content-type": "text/event-stream",
            },
        },
    );
}

/** Keeps HTTP failures/malformed bodies intact while successful model fixtures use SSE. */
export function streamingModelFetch(fetchFixture: typeof fetch): typeof fetch {
    return async (input, init) => {
        const response = await fetchFixture(input, init);
        if (
            !response.ok ||
            !response.headers.get("content-type")?.includes("application/json")
        )
            return response;
        const requestBody =
            typeof init?.body === "string" ? JSON.parse(init.body) : null;
        if (!requestBody?.stream) return response;
        const body = await response
            .clone()
            .json()
            .catch(() => null);
        if (!body || typeof body !== "object" || !("choices" in body))
            return response;
        return providerFixtureResponse(body, {
            status: response.status,
            headers: response.headers,
        });
    };
}

/** Supplies supported context findings at the external documentary-model boundary. */
export function documentaryReply(init?: RequestInit) {
    const wire = JSON.parse(String(init?.body));
    const contributions: { id: string; needIds: string[] }[] = JSON.parse(
        wire.messages.at(-1).content,
    ).contributions;
    return providerFixtureResponse({
        id: "offline-valid",
        model: "z-ai/glm-5.3-flash",
        choices: [
            {
                index: 0,
                message: {
                    role: "assistant",
                    content: JSON.stringify({
                        objections: [],
                        findings: Object.fromEntries(
                            contributions.map(({ id, needIds }) => [
                                id,
                                {
                                    conclusion: "supported",
                                    permittedUse: "context_only",
                                    needs: Object.fromEntries(
                                        needIds.map((needId) => [
                                            needId,
                                            "context_only",
                                        ]),
                                    ),
                                    diagnostic:
                                        "The exact quotation supports this context.",
                                },
                            ]),
                        ),
                    }),
                },
                finish_reason: "stop",
            },
        ],
        usage: {
            prompt_tokens: 10,
            completion_tokens: 10,
            total_tokens: 20,
            cost: 0.00001,
        },
    });
}

/** Maps per-contribution fixture choices to the examiner's external result shape. */
export function scopedFixtureControl(
    contributions: readonly Pick<
        import("@convex/domain/sourcesContracts").DocumentaryContribution,
        "id" | "needIds"
    >[],
    findings: readonly {
        contributionId: string;
        conclusion: "supported" | "documentary_conflict" | "not_established";
        permittedUse: import("@convex/domain/sourcesContracts").DocumentaryUse;
        diagnostic: string;
    }[],
): import("@convex/domain/sourcesContracts").DocumentaryControlV2 {
    return {
        findings: Object.fromEntries(
            findings.map(({ contributionId, ...finding }) => [
                contributionId,
                {
                    ...finding,
                    needs: Object.fromEntries(
                        (
                            contributions.find(
                                ({ id }) => id === contributionId,
                            )?.needIds ?? []
                        ).map((needId) => [needId, finding.permittedUse]),
                    ),
                },
            ]),
        ),
        objections: [],
    };
}
