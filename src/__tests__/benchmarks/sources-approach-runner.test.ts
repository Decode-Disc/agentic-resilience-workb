// @vitest-environment node
import assert from "node:assert/strict";

import { SOURCE_COVERAGE_ROLES } from "@convex/domain/sourceSelectionPolicy";
import { expect, test, vi } from "vitest";

const { runSourcesMission } = (await import(
    new URL(
        "../../../scripts/evaluations/source-selection/sources-approach-runner.ts",
        import.meta.url,
    ).href
)) as typeof import("../../../scripts/evaluations/source-selection/sources-approach-runner");
const { sourcesDigest } = (await import(
    new URL(
        "../../../scripts/evaluations/source-selection/sources-approach-study.ts",
        import.meta.url,
    ).href
)) as typeof import("../../../scripts/evaluations/source-selection/sources-approach-study");

function options() {
    const text =
        "Acme provides subscription services under this agreement. Customers pay the fees in their order form.";
    return {
        missionId: "case.fixed.off.r1",
        scenarioId: "case",
        approach: "fixed" as const,
        reasoning: "off" as const,
        repetition: 1,
        execution: "offline" as const,
        apiKey: "synthetic-test-credential",
        profile: {
            model: "fixture/model",
            provider: "fixture",
            inputPricePerToken: 0.0000001,
            outputPricePerToken: 0.000001,
            contextLength: 1_000_000,
        },
        scenario: {
            id: "case",
            phase: "development" as const,
            company: {
                cik: "123",
                legalName: "Acme",
                ticker: "ACME",
                websiteUrl: "https://acme.example",
            },
            asOfTime: Date.UTC(2026, 9, 25),
            researchAngle: "Commercial terms",
            sources: [
                {
                    candidate: {
                        sourceId: "terms",
                        title: "Acme subscription terms",
                        canonicalUrl:
                            "https://acme.example/legal/subscription-terms",
                        origin: "exa" as const,
                        category: "commercial",
                        createdAt: 0,
                    },
                    text,
                    contentHash: sourcesDigest(text),
                },
            ] satisfies [unknown],
        },
    };
}
function proposal() {
    return {
        companyMatch: "subject",
        companyPassageKeys: ["p0"],
        documentKind: "official_commercial_terms",
        reportingPeriodEnd: null,
        reportingPeriodPassageKeys: [],
        contributions: {
            ...Object.fromEntries(
                SOURCE_COVERAGE_ROLES.map((role) => [role, null]),
            ),
            official_commercial_terms: [
                {
                    summary:
                        "Customers pay the fees specified in their order form.",
                    relevance:
                        "Documents how subscription fees are established.",
                    scope: "Contract terms; no realized pricing power is established.",
                    kind: "asserted_fact",
                    period: "unspecified",
                    periodPassageKeys: [],
                    passageKeys: ["p0"],
                    dependsOnFlaggedAssertion: false,
                },
            ] satisfies [unknown],
        },
        limitations: [],
    };
}
function envelope(content: unknown) {
    return new Response(
        JSON.stringify({
            id: "test-generation",
            model: "fixture/model",
            provider: "fixture",
            created: 0,
            choices: [
                {
                    index: 0,
                    finish_reason: "stop",
                    message: {
                        role: "assistant",
                        content: JSON.stringify(content),
                    },
                },
            ],
            usage: {
                prompt_tokens: 100,
                completion_tokens: 50,
                total_tokens: 150,
                cost: 0.001,
            },
        }),
        { headers: { "Content-Type": "application/json" } },
    );
}

test("inspection agent starts with the dossier and compact tools and can finish without notes", async () => {
    const { SourcesPreparation, inspectionScenarioHash } = await import(
        "../../../scripts/evaluations/source-selection/sources-approach-study"
    );
    const args = options();
    const initial = new SourcesPreparation(args.scenario);
    initial.readSource("terms");
    expect(initial.submitQualification("terms", proposal()).status).toBe(
        "accepted",
    );
    const baseline = {
        scenarioHash: inspectionScenarioHash(args.scenario),
        sources: initial.finish().sources,
    };
    const requests: Record<string, unknown>[] = [];
    const result = await runSourcesMission({
        ...args,
        approach: "agent",
        inspection: {
            baseline,
            mandate: "Inspect the contractual evidence and its limitations.",
            search: async () => ({
                status: "available",
                hits: [],
                nextOffset: null,
            }),
        },
        fetch: async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            requests.push(body);
            return toolEnvelope("complete", {});
        },
    });
    expect(result.stopReason).toBeUndefined();
    expect(result.sources[0]?.qualification).toEqual(
        baseline.sources[0]?.qualification,
    );
    expect(requests).toHaveLength(1);
    expect(JSON.stringify(requests[0]?.tools).length).toBeLessThan(12000);
    expect(JSON.stringify(requests[0]?.messages)).toContain(
        "Inspect the contractual evidence",
    );
    expect(JSON.stringify(requests[0]?.tools)).toContain("search_captures");
    expect(JSON.stringify(requests[0]?.tools)).not.toContain("mission_control");
    expect(
        JSON.stringify(requests[0]?.messages).includes(
            "Customers pay the fees in their order form.",
        ),
    ).toBe(false);
});

test("inspection reserves comparison work and finalizes it even when the agent exhausts its inspection steps", async () => {
    const { SourcesPreparation, inspectionScenarioHash } = await import(
        "../../../scripts/evaluations/source-selection/sources-approach-study"
    );
    const args = options();
    const preparation = new SourcesPreparation(args.scenario);
    preparation.readSource("terms");
    const qualification = proposal();
    qualification.contributions.official_commercial_terms[0].kind =
        "attributed_argument";
    expect(preparation.submitQualification("terms", qualification).status).toBe(
        "accepted",
    );
    const baseline = {
        scenarioHash: inspectionScenarioHash(args.scenario),
        sources: preparation.finish().sources,
    };
    let count = 0;
    const result = await runSourcesMission({
        ...args,
        approach: "agent",
        inspection: {
            baseline,
            mandate: "Inspect the retained commercial premise.",
            focusSourceIds: ["terms"],
            search: async () => ({
                status: "available",
                hits: [],
                nextOffset: null,
            }),
        },
        fetch: async (_url, init) => {
            count++;
            if (count <= 6) return toolEnvelope("preview_selection", {});
            const body = JSON.parse(String(init?.body));
            const context = JSON.parse(
                body.messages.find((m: { role: string }) => m.role === "user")
                    .content,
            );
            return envelope({
                findings: context.findings.map(
                    (finding: {
                        findingIndex: number;
                        targetPassages: { referenceKey: string }[];
                    }) => ({
                        findingIndex: finding.findingIndex,
                        targetPassageKeys: finding.targetPassages.map(
                            (p) => p.referenceKey,
                        ),
                        premises: [
                            {
                                statement: "The fees are contractual.",
                                disposition: "inconclusive",
                                explanation:
                                    "No comparable primary passage is available.",
                                comparableDimensions: [],
                                primaryPassageKeys: [],
                            },
                        ],
                    }),
                ),
            });
        },
    });
    expect(result.calls).toHaveLength(7);
    expect(result.stopReason).toBe("inspection_step_limit");
    expect(result.sources[0]?.comparisonStatus).toBe("compared");
    expect(result.sources[0]?.comparison?.findings[0]?.disposition).toBe(
        "inconclusive",
    );
});

test("inspection rechecks a focused comparison even when its qualification has not changed", async () => {
    const { SourcesPreparation, inspectionScenarioHash } = await import(
        "../../../scripts/evaluations/source-selection/sources-approach-study"
    );
    const args = options();
    const registry = new SourcesPreparation(args.scenario);
    registry.readSource("terms");
    const qualification = proposal();
    qualification.contributions.official_commercial_terms[0].kind =
        "attributed_argument";
    registry.submitQualification("terms", qualification);
    const context = registry.prepareComparison("terms");
    assert(context.status === "accepted");
    const comparison = (explanation: string) => ({
        findings: context.input.findings.map((finding) => ({
            findingIndex: finding.findingIndex,
            targetPassageKeys: finding.targetPassages.map(
                (p) => p.referenceKey,
            ),
            premises: [
                {
                    statement: "The fees are contractual.",
                    disposition: "inconclusive",
                    explanation,
                    comparableDimensions: [],
                    primaryPassageKeys: [],
                },
            ],
        })),
    });
    expect(
        registry.submitComparison(
            context.contextId,
            comparison("The earlier inspected evidence was insufficient."),
        ).status,
    ).toBe("accepted");
    const baseline = {
        scenarioHash: inspectionScenarioHash(args.scenario),
        sources: registry.finish().sources,
    };
    let count = 0;
    const result = await runSourcesMission({
        ...args,
        approach: "agent",
        inspection: {
            baseline,
            mandate: "Inspect the retained premise.",
            focusSourceIds: ["terms"],
            search: async () => ({
                status: "available",
                hits: [],
                nextOffset: null,
            }),
        },
        fetch: async () =>
            ++count === 1
                ? toolEnvelope("complete", {})
                : envelope(
                      comparison(
                          "The current inspection still lacks comparable primary evidence.",
                      ),
                  ),
    });
    expect(result.calls).toHaveLength(2);
    expect(result.sources[0]?.qualificationRevision).toBe(1);
    expect(result.sources[0]?.comparison?.findings[0]?.explanation).toContain(
        "current inspection",
    );
});

test("the fixed pipeline materializes real structured output and retains its useful clauses", async () => {
    const result = await runSourcesMission({
        ...options(),
        fetch: async () => envelope(proposal()),
    });
    expect(result.stopReason).toBeUndefined();
    expect(
        result.sources[0]?.qualification?.findings[0]?.passages[0]?.quotation,
    ).toEqual(expect.stringContaining("Customers pay"));
    expect(result.status).toBe("complete");
    expect(result.calls).toHaveLength(1);
    expect(result.calls[0]?.costUsd).toBe(0.001);
});

function toolEnvelope(name: string, args: unknown) {
    return new Response(
        JSON.stringify({
            id: "agent-test",
            model: "fixture/model",
            created: 1,
            choices: [
                {
                    index: 0,
                    finish_reason: "tool_calls",
                    message: {
                        role: "assistant",
                        content: null,
                        tool_calls: [
                            {
                                id: `call-${name}`,
                                type: "function",
                                function: {
                                    name,
                                    arguments: JSON.stringify(args),
                                },
                            },
                        ],
                    },
                },
            ],
            usage: {
                prompt_tokens: 100,
                completion_tokens: 50,
                total_tokens: 150,
                cost: 0.001,
            },
        }),
        { headers: { "Content-Type": "application/json" } },
    );
}

test("the agent reads and qualifies directly through controlled tools, then completes", async () => {
    const queue = [
        toolEnvelope("mission_control", {}),
        toolEnvelope("read_source", { sourceId: "terms" }),
        toolEnvelope("submit_qualification", {
            sourceId: "terms",
            proposal: proposal(),
        }),
        toolEnvelope("complete", {
            notes: "The commercial clause remains available for review.",
        }),
    ];
    const request = vi.fn<typeof fetch>(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.tool_choice === "required")
            return new Response(
                JSON.stringify({
                    error: {
                        code: 404,
                        message:
                            "No endpoints found that support the provided tool_choice value",
                    },
                }),
                {
                    status: 404,
                    headers: { "Content-Type": "application/json" },
                },
            );
        return queue.shift() ?? envelope({});
    });
    const result = await runSourcesMission({
        ...options(),
        approach: "agent",
        fetch: request,
    });
    expect(result.stopReason).toBeUndefined();
    expect(result.status).toBe("complete");
    expect(
        result.sources[0]?.qualification?.findings[0]?.passages[0]?.quotation,
    ).toEqual(expect.stringContaining("Customers pay"));
    expect(result.calls).toHaveLength(4);
    expect(result.events.some((e) => e.operation === "mission_control")).toBe(
        true,
    );
});

test("a provider outcome lost after dispatch is retained as unknown without another call", async () => {
    const request = vi.fn<typeof fetch>(async () => {
        throw new Error("connection lost");
    });
    const result = await runSourcesMission({ ...options(), fetch: request });
    expect(result.status).toBe("unknown");
    expect(result.calls[0]).toMatchObject({
        status: "unknown",
        reservationUsd: expect.any(Number),
    });
    expect(result.calls[0]?.costUsd).toBeUndefined();
    expect(request).toHaveBeenCalledOnce();
});

test("offline execution refuses a missing replay transport before network access", async () => {
    const request = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async () => envelope(proposal()));
    try {
        const result = await runSourcesMission(options());
        expect(result.stopReason).toBe("offline_transport_required");
        expect(request).not.toHaveBeenCalled();
    } finally {
        request.mockRestore();
    }
});

test("live execution requires a per-call authorization before provider dispatch", async () => {
    const request = vi.fn<typeof fetch>(async () => envelope(proposal()));
    const result = await runSourcesMission({
        ...options(),
        execution: "live",
        fetch: request,
    });
    expect(result.stopReason).toBe("live_authorization_required");
    expect(request).not.toHaveBeenCalled();
});

test("early completion remains partial and raw provider reasoning is omitted from the journal", async () => {
    const first = toolEnvelope("mission_control", {});
    const raw = await first.json();
    raw.choices[0].message.reasoning = "PRIVATE_REASONING_SENTINEL";
    raw.choices[0].message.reasoning_details = [
        { text: "PRIVATE_REASONING_SENTINEL" },
    ];
    const queue = [
        new Response(JSON.stringify(raw), {
            headers: { "Content-Type": "application/json" },
        }),
        toolEnvelope("complete", { notes: "Unable to inspect sources." }),
    ];
    const entries: unknown[] = [];
    const result = await runSourcesMission({
        ...options(),
        approach: "agent",
        reasoning: "on",
        fetch: async () => {
            const response = queue.shift();
            assert(response);
            return response;
        },
        journal: (entry) => entries.push(entry),
    });
    expect(result.status).toBe("partial");
    expect(result.sources[0]?.read).toBe(false);
    expect(JSON.stringify(entries)).not.toContain("PRIVATE_REASONING_SENTINEL");
});

test("an invalid fixed qualification leaves the other sources available for preparation", async () => {
    const input = options();
    input.scenario.sources.push({
        ...input.scenario.sources[0],
        candidate: {
            ...input.scenario.sources[0].candidate,
            sourceId: "terms-2",
        },
    });
    const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(envelope({ invalid: true }))
        .mockResolvedValueOnce(envelope(proposal()));
    const result = await runSourcesMission({ ...input, fetch: request });
    expect(result.status).toBe("partial");
    expect(result.sources[0]?.qualificationStatus).toBe("invalid");
    expect(result.sources[1]?.qualificationStatus).toBe("qualified");
    expect(result.calls.map((c) => c.status)).toEqual(["invalid", "succeeded"]);
});

test("a denied reservation prevents the external request and records no billable start", async () => {
    const request = vi.fn<typeof fetch>(async () => envelope(proposal()));
    const entries: unknown[] = [];
    const result = await runSourcesMission({
        ...options(),
        execution: "live",
        fetch: request,
        authorizeCall: () => {
            throw new Error("budget exhausted");
        },
        journal: (entry) => entries.push(entry),
    });
    expect(request).not.toHaveBeenCalled();
    expect(result.calls).toEqual([]);
    expect(result.status).toBe("partial");
    expect(JSON.stringify(entries)).not.toContain('"event":"started"');
});

test("the fixed pipeline compares an attributed contribution through the real comparison contract", async () => {
    const qualification = proposal();
    qualification.contributions.official_commercial_terms[0].kind =
        "attributed_argument";
    const request = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(envelope(qualification))
        .mockImplementationOnce(async (_url, init) => {
            const body = JSON.parse(String(init?.body));
            const context = JSON.parse(body.messages.at(-1).content);
            return envelope({
                findings: context.findings.map(
                    (finding: {
                        findingIndex: number;
                        targetPassages: Array<{ referenceKey: string }>;
                    }) => ({
                        findingIndex: finding.findingIndex,
                        targetPassageKeys: finding.targetPassages.map(
                            (p) => p.referenceKey,
                        ),
                        premises: [
                            {
                                statement:
                                    "Subscription fees support pricing resilience.",
                                disposition: "inconclusive",
                                explanation:
                                    "No independent comparable primary passage is available in this fixture.",
                                comparableDimensions: [],
                                primaryPassageKeys: [],
                            },
                        ],
                    }),
                ),
            });
        });
    const result = await runSourcesMission({ ...options(), fetch: request });
    expect(result.stopReason).toBeUndefined();
    expect(result.sources[0]?.comparison?.findings[0]?.disposition).toBe(
        "inconclusive",
    );
    expect(result.sources[0]?.comparisonStatus).toBe("compared");
    expect(result.calls).toHaveLength(2);
});

test("the agent cannot continue after sixteen model calls", async () => {
    const request = vi.fn<typeof fetch>(async () =>
        toolEnvelope("mission_control", {}),
    );
    const result = await runSourcesMission({
        ...options(),
        approach: "agent",
        fetch: request,
    });
    expect(result.calls).toHaveLength(16);
    expect(result.stopReason).toBe("model_call_limit");
    expect(result.status).toBe("partial");
});

test("the agent submits its own comparison against the exact prepared context", async () => {
    const qualification = proposal();
    qualification.contributions.official_commercial_terms[0].kind =
        "attributed_argument";
    const prefix = [
        toolEnvelope("mission_control", {}),
        toolEnvelope("read_source", { sourceId: "terms" }),
        toolEnvelope("submit_qualification", {
            sourceId: "terms",
            proposal: qualification,
        }),
        toolEnvelope("prepare_comparison", { sourceId: "terms" }),
    ];
    let comparisonSent = false;
    const result = await runSourcesMission({
        ...options(),
        approach: "agent",
        fetch: async (_url, init) => {
            const next = prefix.shift();
            if (next) return next;
            if (comparisonSent)
                return toolEnvelope("complete", {
                    notes: "Comparable primary evidence is absent in the fixture.",
                });
            comparisonSent = true;
            const body = JSON.parse(String(init?.body));
            const context = JSON.parse(body.messages.at(-1).content);
            expect(context.responseSchema).toBeDefined();
            return toolEnvelope("submit_comparison", {
                contextId: context.contextId,
                proposalJson: JSON.stringify({
                    findings: context.input.findings.map(
                        (finding: {
                            findingIndex: number;
                            targetPassages: Array<{ referenceKey: string }>;
                        }) => ({
                            findingIndex: finding.findingIndex,
                            targetPassageKeys: finding.targetPassages.map(
                                (p) => p.referenceKey,
                            ),
                            premises: [
                                {
                                    statement:
                                        "Subscription fees support pricing resilience.",
                                    disposition: "inconclusive",
                                    explanation:
                                        "Comparable primary evidence is absent in this fixture.",
                                    comparableDimensions: [],
                                    primaryPassageKeys: [],
                                },
                            ],
                        }),
                    ),
                }),
            });
        },
    });
    expect(result.stopReason).toBeUndefined();
    expect(result.sources[0]?.comparisonStatus).toBe("compared");
    expect(result.sources[0]?.comparison?.findings[0]?.disposition).toBe(
        "inconclusive",
    );
    expect(result.calls).toHaveLength(6);
});

test("a context reservation that cannot fit is blocked before dispatch", async () => {
    const input = options();
    input.profile.contextLength = 100;
    const request = vi.fn<typeof fetch>(async () => envelope(proposal()));
    const result = await runSourcesMission({ ...input, fetch: request });
    expect(request).not.toHaveBeenCalled();
    expect(result.stopReason).toBe("context_reservation_limit");
});

test("a response received after cancellation cannot qualify a source", async () => {
    const controller = new AbortController();
    const result = await runSourcesMission({
        ...options(),
        signal: controller.signal,
        fetch: async () => {
            controller.abort();
            return envelope(proposal());
        },
    });
    expect(result.status).not.toBe("complete");
    expect(result.sources[0]?.qualification).toBeUndefined();
});

test("completed readings leave the agent context, but an explicit reread remains visible", async () => {
    const queue = [
        toolEnvelope("mission_control", {}),
        toolEnvelope("read_source", { sourceId: "terms" }),
        toolEnvelope("submit_qualification", {
            sourceId: "terms",
            proposal: proposal(),
        }),
        toolEnvelope("read_source", { sourceId: "terms" }),
        toolEnvelope("complete", { notes: "Rechecked the retained clause." }),
    ];
    const requests: Array<{
        messages: Array<{ role: string; content: string }>;
    }> = [];
    const result = await runSourcesMission({
        ...options(),
        approach: "agent",
        fetch: async (_url, init) => {
            requests.push(JSON.parse(String(init?.body)));
            const response = queue.shift();
            assert(response);
            return response;
        },
    });
    expect(result.status).toBe("complete");
    const qualificationRequest = requests[3];
    assert(qualificationRequest);
    const afterQualification = qualificationRequest.messages
        .filter((m) => m.role === "tool")
        .map((m) => JSON.parse(m.content));
    expect(
        afterQualification.some(
            (m) =>
                m.status === "stored_qualification" &&
                m.qualification.findings.length === 1,
        ),
    ).toBe(true);
    expect(afterQualification.some((m) => m.input?.document)).toBe(false);
    const rereadRequest = requests[4];
    assert(rereadRequest);
    const afterReread = rereadRequest.messages
        .filter((m) => m.role === "tool")
        .map((m) => JSON.parse(m.content));
    expect(
        afterReread.some((m) => m.input?.document?.passages?.length === 1),
    ).toBe(true);
});

test("a malformed inspection audit retains the dossier and records invalid work without retry", async () => {
    const { SourcesPreparation, inspectionScenarioHash } = await import(
        "../../../scripts/evaluations/source-selection/sources-approach-study"
    );
    const args = options();
    const initial = new SourcesPreparation(args.scenario);
    initial.readSource("terms");
    initial.submitQualification("terms", proposal());
    const baseline = {
        scenarioHash: inspectionScenarioHash(args.scenario),
        sources: initial.finish().sources,
    };
    const request = vi.fn<typeof fetch>(async () =>
        envelope({ revise: "invalid" }),
    );
    const result = await runSourcesMission({
        ...args,
        inspection: {
            baseline,
            mandate: "Inspect the contractual evidence.",
            search: async () => ({
                status: "available",
                hits: [],
                nextOffset: null,
            }),
        },
        fetch: request,
    });
    expect(result.sources).toEqual(baseline.sources);
    expect(result.calls[0]?.status).toBe("invalid");
    expect(result.status).toBe("partial");
    expect(result.stopReason).toBe("inspection_audit_invalid");
    expect(request).toHaveBeenCalledOnce();
});

test("inspection compacts repeated readings even when the qualification has not changed", async () => {
    const { SourcesPreparation, inspectionScenarioHash } = await import(
        "../../../scripts/evaluations/source-selection/sources-approach-study"
    );
    const args = options();
    const text = Array.from(
        { length: 100 },
        (_, i) =>
            `## Section ${i}\n\n${"Customers pay the fees in their order form. ".repeat(60)}`,
    ).join("\n\n");
    const source = args.scenario.sources[0];
    assert(source);
    source.text = text;
    source.contentHash = sourcesDigest(text);
    const initial = new SourcesPreparation(args.scenario);
    initial.readSource("terms");
    expect(initial.submitQualification("terms", proposal()).status).toBe(
        "accepted",
    );
    const baseline = {
        scenarioHash: inspectionScenarioHash(args.scenario),
        sources: initial.finish().sources,
    };
    const bodies: string[] = [];
    const result = await runSourcesMission({
        ...args,
        approach: "agent",
        inspection: {
            baseline,
            mandate: "Inspect the subscription evidence.",
            search: async () => ({
                status: "available",
                hits: [],
                nextOffset: null,
            }),
        },
        fetch: async (_url, init) => {
            bodies.push(String(init?.body));
            return bodies.length <= 4
                ? toolEnvelope("read_source", { sourceId: "terms" })
                : toolEnvelope("complete", {});
        },
    });
    expect(result.stopReason).toBeUndefined();
    expect(bodies.at(-1)?.includes("reading_compacted")).toBe(true);
    expect(result.sources[0]?.qualificationRevision).toBe(1);
});

test.each([
    "fixed",
    "agent",
] as const)("%s inspection searches and reads an omitted clause before retaining it", async (approach) => {
    const { SourcesPreparation, inspectionScenarioHash } = await import(
        "../../../scripts/evaluations/source-selection/sources-approach-study"
    );
    const args = options();
    const clause =
        "Customers retain ownership of Customer Data and authorize processing only to provide the service.";
    const text = Array.from(
        { length: 100 },
        (_, i) =>
            `## Section ${i}\n\n${i === 99 ? clause : "Customers pay the fees stated in their order form. ".repeat(60)}`,
    ).join("\n\n");
    const source = args.scenario.sources[0];
    assert(source);
    source.text = text;
    source.contentHash = sourcesDigest(text);
    const initial = new SourcesPreparation(args.scenario);
    const first = initial.readSource("terms");
    expect(first.status).toBe("accepted");
    if (first.status !== "accepted") throw new Error("Baseline reading failed");
    expect(
        first.input.document.passages.some((p) => p.passageKey === "p99"),
    ).toBe(false);
    initial.submitQualification("terms", proposal());
    const baseline = {
        scenarioHash: inspectionScenarioHash(args.scenario),
        sources: initial.finish().sources,
    };
    const revised = proposal();
    const addedFinding = {
        ...revised.contributions.official_commercial_terms[0],
        summary: "Customers retain ownership of Customer Data.",
        relevance:
            "Documents the boundary on the provider's use of customer information.",
        scope: "Contractual data ownership; no exclusive economic control is established.",
        passageKeys: ["p99"],
    };
    revised.contributions.official_commercial_terms.push(addedFinding);
    const correction = {
        sourceId: "terms",
        expectedRevision: 1,
        documentKind: null,
        findings: [
            {
                index: null,
                replacement: {
                    role: "official_commercial_terms",
                    ...addedFinding,
                },
            },
        ],
        limitations: [],
    };
    let count = 0;
    const search = vi.fn(async () => ({
        status: "available" as const,
        hits: [{ sourceId: "terms", passageKey: "p99", excerpt: clause }],
        nextOffset: null,
    }));
    const result = await runSourcesMission({
        ...args,
        approach,
        inspection: {
            baseline,
            mandate:
                "Inspect the contractual evidence for data rights and commercial resilience.",
            search,
        },
        fetch: async (_url, init) => {
            count++;
            if (approach === "fixed") {
                const request = JSON.parse(String(init?.body));
                if (count === 1)
                    expect(
                        JSON.parse(
                            request.messages.find(
                                (m: { role: string }) => m.role === "user",
                            ).content,
                        ),
                    ).not.toHaveProperty("dossier");
                if (count === 1)
                    expect(JSON.stringify(request.messages)).not.toContain(
                        "Output fields:",
                    );
                if (count === 2)
                    expect(JSON.stringify(request.messages)).toContain(clause);
                return count === 1
                    ? envelope({
                          premises: [
                              {
                                  statement:
                                      "The contract defines data rights.",
                                  passageKeys: ["p0"],
                                  requiresCrossCheck: true,
                              },
                          ],
                          searches: [
                              {
                                  query: "Customer Data ownership",
                                  sourceIds: ["terms"],
                              },
                          ],
                          reason: "Inspect the data-rights clauses before revising the contribution.",
                      })
                    : envelope(correction);
            }
            if (count === 1)
                return toolEnvelope("search_captures", {
                    query: "Customer Data ownership",
                    sourceIds: ["terms"],
                });
            if (count === 2)
                return toolEnvelope("read_passages", {
                    sourceId: "terms",
                    passageKeys: ["p99"],
                });
            if (count === 3) {
                const request = JSON.parse(String(init?.body));
                const reading = request.messages
                    .filter(
                        (m: { role: string; tool_call_id?: string }) =>
                            m.role === "tool" &&
                            m.tool_call_id === "call-read_passages",
                    )
                    .at(-1);
                expect(reading).toBeDefined();
                return toolEnvelope("correct_qualification", correction);
            }
            return toolEnvelope("complete", {});
        },
    });
    expect(result.stopReason).toBeUndefined();
    expect(result.sources[0]?.qualification?.findings).toHaveLength(2);
    expect(
        result.sources[0]?.qualification?.findings[1]?.passages[0]?.quotation,
    ).toBe(clause);
    expect(baseline.sources[0]?.qualification?.findings).toHaveLength(1);
    expect(search).toHaveBeenCalledOnce();
});

test("waits for asynchronous budget authorization before any provider request", async () => {
    let release = () => {};
    const authorized = new Promise<void>((resolve) => {
        release = resolve;
    });
    const request = vi.fn(async () => envelope(proposal()));
    const running = runSourcesMission({
        ...options(),
        execution: "live",
        authorizeCall: () => authorized,
        fetch: request,
    });
    try {
        await new Promise((resolve) => setImmediate(resolve));
        expect(request).not.toHaveBeenCalled();
    } finally {
        release();
        await running;
    }
});
