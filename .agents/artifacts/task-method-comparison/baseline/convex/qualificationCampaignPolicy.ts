import { z } from "zod";
export const QUALIFICATION_ACCOUNTING_POLICY = "known_final_v1" as const;

import { coveragePresetValidator } from "./domain/validators.ts";
import { reasoningPreferenceValues } from "./modelConfigurationValues.ts";
import { initialFixtureIds } from "./qualificationInitialFixtures.ts";
import {
    MAX_QUALIFICATION_CONTEXT_DURATION_MS,
    MAX_REVIEW_AUTHORITY_DURATION_MS,
    SOURCES_ENVELOPE_MAX_ACQUISITIONS,
    SOURCES_ENVELOPE_MAX_COUNT,
} from "./resourcePolicy.ts";

export const campaignLimitsSchema = z
    .object({
        model: z.number().int().nonnegative().safe(),
        search: z.number().int().nonnegative().safe(),
        acquisition: z.number().int().nonnegative().safe(),
        costUsd: z.number().finite().nonnegative(),
    })
    .strict();
const role = z
    .object({
        model: z.string().min(1).max(200),
        provider: z.string().min(1).max(200).optional(),
        reasoning: z.enum(reasoningPreferenceValues),
    })
    .strict();
/** An explicit mandate, shared by the local CLI and server admission. It never grants authority by itself. */
export const legacyCampaignManifestSchema = z
    .object({
        version: z.literal(1),
        costAccountingPolicy: z
            .enum(["conservative_v1", "known_final_v1"])
            .optional(),
        key: z.string().regex(/^[a-z0-9-]{1,60}$/),
        objective: z.string().min(10).max(2000),
        capability: z.enum(["workbench", "sources"]),
        mode: z.enum(["deterministic", "live"]),
        batteryHash: z.string().regex(/^[a-f0-9]{64}$/),
        expectations: z
            .array(
                z
                    .object({
                        id: z.string().min(1),
                        checks: z.array(z.string().min(1)).min(1),
                    })
                    .strict(),
            )
            .min(1)
            .max(40),
        models: z
            .object({ workbench: role, sources: role.optional() })
            .strict(),
        controllerModel: z.string().min(1).max(200).optional(),
        correctionPaths: z.array(z.string().min(1).max(300)).min(1).max(100),
        maximumLots: z.number().int().min(1).max(100),
        repetitionsPerCandidate: z.number().int().min(1).max(100),
        expiresAt: z.number().int().positive().safe(),
        perLot: campaignLimitsSchema,
        total: campaignLimitsSchema,
    })
    .strict()
    .superRefine((m, ctx) => {
        const issue = (message: string) =>
            ctx.addIssue({ code: "custom", message });
        if (m.capability === "sources" && !m.models.sources)
            issue("Sources model required");
        if (m.controllerModel && m.capability !== "sources")
            issue("Controller qualification requires Sources");
        if (
            new Set(m.expectations.map((e) => e.id)).size !==
                m.expectations.length ||
            m.expectations.some(
                (e) => new Set(e.checks).size !== e.checks.length,
            )
        )
            issue("Duplicate expectations");
        for (const path of m.correctionPaths)
            if (
                path.startsWith("/") ||
                path.split("/").some((p) => p === ".." || p === "") ||
                /[\\*?]/.test(path)
            )
                issue(
                    "Correction paths must be explicit repository paths or directories",
                );
        for (const key of [
            "model",
            "search",
            "acquisition",
            "costUsd",
        ] as const)
            if (m.perLot[key] > m.total[key])
                issue("Per-lot allowance exceeds campaign total");
        if (
            m.perLot.model > (m.capability === "sources" ? 40 : 20) ||
            m.perLot.costUsd > (m.capability === "sources" ? 2 : 0.5) ||
            m.perLot.search > (m.capability === "sources" ? 4 : 0) ||
            m.perLot.acquisition > (m.capability === "sources" ? 12 : 0)
        )
            issue(
                "Per-lot allowance exceeds the existing qualification boundary",
            );
        if (
            m.mode === "live"
                ? m.perLot.model < 1 || m.perLot.costUsd <= 0
                : Object.values(m.total).some((v) => v !== 0)
        )
            issue(
                "Explicit live allowance or zero simulated allowance required",
            );
    });

export type CampaignLimits = z.infer<typeof campaignLimitsSchema>;
export const emptyCampaignLimits = (): CampaignLimits => ({
    model: 0,
    search: 0,
    acquisition: 0,
    costUsd: 0,
});

const identity = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/);
const question = z
    .object({
        id: identity,
        text: z.string().min(1),
        shortLabel: z.string().min(1),
        rationale: z.string().min(1),
    })
    .strict();
const framing = z
    .object({ scope: z.string().min(1), questions: z.array(question).min(1) })
    .strict();
export const qualificationStepSchema = z.discriminatedUnion("action", [
    z
        .object({
            id: identity,
            action: z.literal("save_framing"),
            content: framing.optional(),
        })
        .strict(),
    z
        .object({
            id: identity,
            action: z.literal("send_message"),
            text: z.string().min(1),
            wait: z.enum(["settled", "started"]).optional(),
        })
        .strict(),
    z
        .object({
            id: identity,
            action: z.enum([
                "start_research",
                "pause_research",
                "resume_research",
                "stop_response",
                "reload",
            ]),
        })
        .strict(),
    z
        .object({
            id: identity,
            action: z.literal("navigate"),
            target: z.enum(["dossier", "dossier_list", "framing", "timeline"]),
        })
        .strict(),
    z
        .object({
            id: identity,
            action: z.literal("viewport"),
            width: z.number().int().positive().safe(),
            height: z.number().int().positive().safe(),
        })
        .strict(),
    z
        .object({
            id: identity,
            action: z.literal("wait_for"),
            state: z.enum([
                "conversation_settled",
                "sources_prepared",
                "paused",
                "running",
            ]),
        })
        .strict(),
    z
        .object({
            id: identity,
            action: z.literal("fault"),
            recipe: z.enum([
                "malformed_response",
                "http_refusal",
                "concurrent_edit",
                "stop_before_generation",
            ]),
        })
        .strict(),
]);
export const qualificationEnvelopeSchema = z
    .object({
        version: z.literal(1),
        maxNeeds: z.number().int().min(1).max(SOURCES_ENVELOPE_MAX_COUNT),
        initialSearches: z
            .number()
            .int()
            .min(1)
            .max(SOURCES_ENVELOPE_MAX_COUNT),
        complementSearches: z
            .number()
            .int()
            .min(1)
            .max(SOURCES_ENVELOPE_MAX_COUNT),
        acquisitions: z
            .number()
            .int()
            .min(1)
            .max(SOURCES_ENVELOPE_MAX_ACQUISITIONS),
        controls: z.number().int().min(1).max(SOURCES_ENVELOPE_MAX_COUNT),
    })
    .strict();
export const framingReplaySchema = z
    .object({
        materialHash: z.string().regex(/^[a-f0-9]{64}$/),
        case: z.enum([
            "nvidia",
            "ccc",
            "lookupUnavailable",
            "insufficientDatedSupport",
        ]),
        unavailable: z.boolean(),
        documents: z.array(
            z
                .object({
                    url: z.url().startsWith("https://"),
                    title: z.string().min(1),
                    text: z.string(),
                    publishedAt: z.iso.datetime().optional(),
                })
                .strict(),
        ),
    })
    .strict();

export const qualificationScenarioSchema = z
    .object({
        id: identity,
        company: z
            .object({
                cik: z.string().regex(/^\d{1,10}$/),
                name: z.string().min(1),
                ticker: z.string().min(1),
                websiteUrl: z.string().url(),
            })
            .strict(),
        framing,
        framingRequest: z
            .object({
                text: z
                    .string()
                    .min(1)
                    .max(2000)
                    .refine((text) => !!text.trim()),
                receivedAt: z.iso.datetime(),
            })
            .strict()
            .optional(),
        framingPublicContext: z.literal(true).optional(),
        framingReplay: framingReplaySchema.optional(),
        coveragePreset: z
            .enum(coveragePresetValidator.members.map((value) => value.value))
            .optional(),
        steps: z.array(qualificationStepSchema).min(1),
        limits: campaignLimitsSchema.partial().optional(),
        sourcesEnvelope: qualificationEnvelopeSchema.optional(),
        initialFixture: z
            .object({
                id: z.enum(initialFixtureIds),
                hash: z.string().regex(/^[a-f0-9]{64}$/),
            })
            .strict()
            .optional(),
    })
    .strict();
export const qualificationConfigurationSchema = z
    .object({
        id: identity,
        purpose: z.enum(["quality", "harness_stress"]),
        models: z
            .object({ workbench: role, sources: role.optional() })
            .strict(),
        controllerModel: z.string().min(1).max(200).optional(),
    })
    .strict();
const v2 = z
    .object({
        ...legacyCampaignManifestSchema.shape,
        version: z.literal(2),
        costAccountingPolicy: z
            .enum(["conservative_v1", "known_final_v1"])
            .optional(),
        executionSurface: z.enum(["browser", "backend"]).optional(),
        researchDurationMs: z.number().int().positive().safe().optional(),
        contextDurationMs: z
            .number()
            .int()
            .positive()
            .max(MAX_QUALIFICATION_CONTEXT_DURATION_MS)
            .optional(),
        expectations: z
            .array(
                z
                    .object({
                        id: identity,
                        checks: z.array(z.string().min(1)).min(1),
                    })
                    .strict(),
            )
            .min(1),
        configurations: z.array(qualificationConfigurationSchema).min(1),
        scenarios: z.array(qualificationScenarioSchema).min(1),
        maximumLots: z.number().int().positive().safe(),
        repetitionsPerCandidate: z.number().int().positive().safe(),
    })
    .omit({ models: true, controllerModel: true })
    .strict();
export const configurableCampaignManifestSchema = v2.superRefine((m, ctx) => {
    const issue = (message: string) =>
        ctx.addIssue({ code: "custom", message });
    for (const key of ["model", "search", "acquisition", "costUsd"] as const)
        if (m.perLot[key] > m.total[key])
            issue("Per-lot allowance exceeds campaign total");
    if (
        m.mode === "deterministic"
            ? Object.values(m.total).some((v) => v !== 0)
            : m.perLot.model < 1 || m.perLot.costUsd <= 0
    )
        issue("Explicit live allowance or zero simulated allowance required");
    if (
        new Set(m.configurations.map((c) => c.id)).size !==
            m.configurations.length ||
        new Set(m.scenarios.map((s) => s.id)).size !== m.scenarios.length
    )
        issue("Duplicate scenario or configuration");
    if (m.maximumLots < m.configurations.length)
        issue("Lot allowance cannot cover declared configurations");
    if (
        m.expectations.length !== m.scenarios.length ||
        m.scenarios.some((s) => !m.expectations.some((e) => e.id === s.id)) ||
        new Set(m.expectations.map((e) => e.id)).size !== m.expectations.length
    )
        issue("Expectations must cover every scenario exactly once");
    if (
        m.executionSurface === "backend" &&
        m.scenarios.some((s) =>
            s.steps.some((step) =>
                ["reload", "navigate", "viewport"].includes(step.action),
            ),
        )
    )
        issue(
            "Browser interaction steps require the browser execution surface",
        );
    for (const s of m.scenarios) {
        if (s.framingReplay && (!s.framingRequest || !s.framingPublicContext))
            issue(
                "Frozen retrieval requires a fresh dated framing request and public-context scope",
            );
        if (
            s.framingRequest &&
            (s.initialFixture ||
                s.steps.some((step) => step.action === "save_framing"))
        )
            issue(
                "Fresh framing requires an agent-saved program without scripted framing or documentary seeding",
            );
        if (s.initialFixture && m.capability !== "sources")
            issue("Documentary starting fixtures require Sources capability");
        for (const [index, step] of s.steps.entries())
            if (step.action === "fault") {
                if (
                    step.recipe !== "stop_before_generation" &&
                    (m.mode !== "live" || m.capability !== "workbench")
                )
                    issue("Transport faults require live Workbench relay");
                const next = s.steps[index + 1];
                if (next?.action !== "send_message")
                    issue("Fault recipe must precede its message");
                if (
                    (step.recipe === "stop_before_generation" ||
                        step.recipe === "concurrent_edit") &&
                    (next?.action !== "send_message" || next.wait !== "started")
                )
                    issue("Gated fault requires a started message");
                if (
                    step.recipe === "stop_before_generation" &&
                    !s.steps
                        .slice(index + 2)
                        .some((s) => s.action === "stop_response")
                )
                    issue("Held message requires Stop response");
                if (
                    step.recipe === "concurrent_edit" &&
                    !s.steps
                        .slice(index + 2)
                        .some((s) => s.action === "save_framing")
                )
                    issue("Concurrent edit requires an explicit framing save");
            }
        if (new Set(s.steps.map((step) => step.id)).size !== s.steps.length)
            issue("Duplicate step identity");
        if (
            new Set(s.framing.questions.map((q) => q.id)).size !==
            s.framing.questions.length
        )
            issue("Duplicate question identity");
        if (
            m.capability === "workbench" &&
            s.steps.some((step) =>
                [
                    "start_research",
                    "pause_research",
                    "resume_research",
                ].includes(step.action),
            )
        )
            issue("Research actions require Sources capability");
        for (const key of [
            "model",
            "search",
            "acquisition",
            "costUsd",
        ] as const)
            if ((s.limits?.[key] ?? 0) > m.perLot[key])
                issue("Scenario limit exceeds lot allowance");
    }
    for (const c of m.configurations) {
        if (m.capability === "sources" && !c.models.sources)
            issue("Sources model required");
        if (
            c.controllerModel &&
            (m.capability !== "sources" || m.mode === "deterministic")
        )
            issue("Response controller requires live Sources");
        if (
            c.purpose === "quality" &&
            Object.values(c.models).some((r) => r.reasoning !== "recommended")
        )
            issue(
                "Quality qualification uses recommended reasoning; explicit efforts require harness_stress",
            );
    }
    for (const e of m.expectations)
        if (new Set(e.checks).size !== e.checks.length)
            issue("Duplicate expectations");
    for (const path of m.correctionPaths)
        if (
            path.startsWith("/") ||
            path.split("/").some((p) => p === ".." || p === "") ||
            /[\\*?]/.test(path)
        )
            issue(
                "Correction paths must be explicit repository paths or directories",
            );
});
export const analysisPricingSchema = z
    .object({
        provider: z.literal("openai"),
        model: z.string().min(1),
        api: z.literal("openai-responses"),
        contextWindow: z.number().int().positive().safe(),
        maxTokens: z.number().int().positive().safe(),
        cost: z
            .object({
                input: z.number().finite().nonnegative(),
                output: z.number().finite().nonnegative(),
                cacheRead: z.number().finite().nonnegative(),
                cacheWrite: z.number().finite().nonnegative(),
                tiers: z
                    .array(
                        z
                            .object({
                                inputTokensAbove: z
                                    .number()
                                    .int()
                                    .nonnegative()
                                    .safe(),
                                input: z
                                    .number()
                                    .finite()
                                    .nonnegative()
                                    .optional(),
                                output: z
                                    .number()
                                    .finite()
                                    .nonnegative()
                                    .optional(),
                                cacheRead: z
                                    .number()
                                    .finite()
                                    .nonnegative()
                                    .optional(),
                                cacheWrite: z
                                    .number()
                                    .finite()
                                    .nonnegative()
                                    .optional(),
                            })
                            .strict(),
                    )
                    .optional(),
            })
            .strict(),
        serviceTier: z.literal("default"),
        sourceUrl: z.url().refine((value) => {
            try {
                const url = new URL(value);
                return (
                    url.protocol === "https:" &&
                    (url.hostname === "openai.com" ||
                        url.hostname.endsWith(".openai.com"))
                );
            } catch {
                return false;
            }
        }, "Official OpenAI pricing source required"),
        verifiedAt: z.number().int().positive().safe(),
    })
    .strict();

/** Canonical pricing identity and conservative native-capacity quote; USD/million tokens equals micros/token. */
export function analysisPricingAuthority(
    input: z.infer<typeof analysisPricingSchema>,
) {
    const pricing = analysisPricingSchema.parse(input);
    let inputRate = Math.max(
        pricing.cost.input,
        pricing.cost.cacheRead,
        pricing.cost.cacheWrite,
    );
    let outputRate = pricing.cost.output;
    for (const tier of pricing.cost.tiers ?? []) {
        inputRate = Math.max(
            inputRate,
            tier.input ?? 0,
            tier.cacheRead ?? 0,
            tier.cacheWrite ?? 0,
        );
        outputRate = Math.max(outputRate, tier.output ?? 0);
    }
    const maximumCostMicros = Math.ceil(
        pricing.contextWindow * inputRate + pricing.maxTokens * outputRate,
    );
    if (!Number.isSafeInteger(maximumCostMicros) || maximumCostMicros < 0)
        throw new Error("Invalid analysis pricing capacity");
    return { identity: JSON.stringify(pricing), maximumCostMicros };
}

export const analysisReceiptSchema = z
    .object({
        input: z.number().int().nonnegative().safe(),
        output: z.number().int().nonnegative().safe(),
        accounting: z.enum(["api_cost", "native_subscription"]).optional(),
        cacheRead: z.number().int().nonnegative().safe().optional(),
        cacheWrite: z.number().int().nonnegative().safe().optional(),
        costUsd: z.number().finite().nonnegative().optional(),
        costBasis: z.enum(["provider_reported", "sdk_estimate"]).optional(),
        pricingHash: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
        costMicros: z.number().int().nonnegative().safe().optional(),
        observationHash: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
    })
    .strict()
    .superRefine((receipt, ctx) => {
        if (
            receipt.accounting === "api_cost" &&
            (receipt.costBasis !== undefined ||
                receipt.pricingHash !== undefined ||
                receipt.costUsd !== undefined ||
                receipt.cacheRead !== undefined ||
                receipt.cacheWrite !== undefined) &&
            (receipt.cacheRead === undefined ||
                receipt.cacheWrite === undefined ||
                receipt.costUsd === undefined ||
                receipt.costBasis === undefined ||
                receipt.pricingHash === undefined ||
                receipt.observationHash === undefined ||
                receipt.costMicros !== Math.ceil(receipt.costUsd * 1_000_000))
        )
            ctx.addIssue({
                code: "custom",
                message:
                    "Complete native API usage, cost provenance and pricing identity required",
            });
        if (
            receipt.accounting === "native_subscription" &&
            (receipt.costUsd !== undefined ||
                receipt.costBasis !== undefined ||
                receipt.pricingHash !== undefined)
        )
            ctx.addIssue({
                code: "custom",
                message: "Subscription receipts cannot carry API cost evidence",
            });
        if (
            receipt.accounting === "native_subscription"
                ? receipt.costMicros !== undefined
                : receipt.costMicros === undefined
        )
            ctx.addIssue({
                code: "custom",
                message: "Invalid analysis receipt accounting",
            });
    });

/** Upper bound for validated OpenAI token usage at the prices pinned in the mandate. */
export function analysisUsageChargeMicros(
    pricing: z.infer<typeof analysisPricingSchema>,
    receipt: z.infer<typeof analysisReceiptSchema>,
): number {
    const { input, output, cacheRead, cacheWrite, costMicros } = receipt;
    if (
        cacheRead === undefined ||
        cacheWrite === undefined ||
        costMicros === undefined ||
        receipt.costBasis === undefined ||
        receipt.observationHash === undefined
    )
        throw new Error("Verified analysis usage required");

    const totalInput = input + cacheRead + cacheWrite;
    if (totalInput > pricing.contextWindow || output > pricing.maxTokens)
        throw new Error("Analysis usage exceeds the authorized capacity");
    if (receipt.costBasis === "provider_reported") return costMicros;

    const { tiers, ...base } = pricing.cost;
    let rates = base;
    let threshold = -1;
    for (const tier of tiers ?? []) {
        if (
            totalInput > tier.inputTokensAbove &&
            tier.inputTokensAbove > threshold
        ) {
            threshold = tier.inputTokensAbove;
            rates = {
                input: tier.input ?? base.input,
                output: tier.output ?? base.output,
                cacheRead: tier.cacheRead ?? base.cacheRead,
                cacheWrite: tier.cacheWrite ?? base.cacheWrite,
            };
        }
    }
    const bound = Math.ceil(
        input * rates.input +
            output * rates.output +
            cacheRead * rates.cacheRead +
            cacheWrite * rates.cacheWrite,
    );
    const charged = Math.max(bound, costMicros);
    if (!Number.isSafeInteger(charged))
        throw new Error("Analysis usage cost is unrepresentable");
    return charged;
}
export type AnalysisReceipt = z.infer<typeof analysisReceiptSchema>;
const analysisAllowanceSchema = z
    .object({
        requests: z.number().int().positive().safe(),
        costMicros: z.number().int().positive().safe().optional(),
    })
    .strict();
export const analysisProviderSchema = z.enum([
    "openai",
    "openai-codex",
    "opencode-go",
]);
export type AnalysisProvider = z.infer<typeof analysisProviderSchema>;
export const analysisMandateSchema = z
    .object({
        scope: z.literal("evidence_review"),
        accounting: z.enum(["native_subscription", "api_cost"]).optional(),
        settlementPolicy: z.literal("verified_usage_v1").optional(),
        pricing: analysisPricingSchema.optional(),
        routes: z
            .array(
                z
                    .object({
                        provider: analysisProviderSchema,
                        model: z.string().min(1).max(200),
                    })
                    .strict(),
            )
            .min(1)
            .max(2),
        perLot: analysisAllowanceSchema,
        total: analysisAllowanceSchema,
        maxRequestCostMicros: z.number().int().positive().safe().optional(),
        maxInputTokens: z.number().int().positive().safe().optional(),
        maxOutputTokens: z.number().int().positive().safe().optional(),
        timeoutMs: z
            .number()
            .int()
            .positive()
            .max(MAX_REVIEW_AUTHORITY_DURATION_MS),
    })
    .strict()
    .superRefine((m, ctx) => {
        if (
            m.settlementPolicy &&
            (m.accounting !== "api_cost" ||
                m.maxRequestCostMicros === undefined)
        )
            ctx.addIssue({
                code: "custom",
                message:
                    "Verified analysis settlement requires an API request reservation",
            });
        if (m.pricing !== undefined && m.accounting !== "api_cost")
            ctx.addIssue({
                code: "custom",
                message: "Pricing metadata requires api_cost accounting",
            });
        if (
            m.routes[0]?.provider === "opencode-go" ||
            (m.routes[1] && m.routes[1].provider !== "opencode-go")
        )
            ctx.addIssue({
                code: "custom",
                message:
                    "Analysis routes must use OpenAI first and OpenCode Go only as fallback",
            });
        if (m.accounting === "native_subscription") {
            if (
                m.routes.length !== 1 ||
                m.routes[0]?.provider !== "openai-codex" ||
                m.perLot.costMicros !== undefined ||
                m.total.costMicros !== undefined ||
                m.maxRequestCostMicros !== undefined ||
                m.maxOutputTokens !== undefined
            )
                ctx.addIssue({
                    code: "custom",
                    message:
                        "Native subscription review requires Codex quota accounting without dollar or output-token ceilings",
                });
        } else if (m.accounting === "api_cost") {
            if (
                !m.pricing ||
                m.routes.length !== 1 ||
                m.routes[0]?.provider !== "openai" ||
                m.routes[0]?.model !== m.pricing.model ||
                m.perLot.costMicros === undefined ||
                m.total.costMicros === undefined ||
                m.maxInputTokens !== undefined ||
                (m.maxOutputTokens !== undefined &&
                    m.maxOutputTokens > m.pricing.maxTokens)
            )
                ctx.addIssue({
                    code: "custom",
                    message:
                        "Native API review requires one OpenAI route, verified pricing and dollar authority without a legacy input proxy",
                });
            else {
                try {
                    if (
                        (m.maxRequestCostMicros ?? m.perLot.costMicros) <
                        analysisPricingAuthority(m.pricing).maximumCostMicros
                    )
                        ctx.addIssue({
                            code: "custom",
                            message:
                                "Analysis reservation does not cover native model capacity",
                        });
                } catch {
                    ctx.addIssue({
                        code: "custom",
                        message: "Invalid analysis pricing capacity",
                    });
                }
            }
        } else if (
            m.perLot.costMicros === undefined ||
            m.total.costMicros === undefined ||
            m.maxInputTokens === undefined ||
            m.maxOutputTokens === undefined
        ) {
            ctx.addIssue({
                code: "custom",
                message:
                    "API analysis requires explicit cost and token ceilings",
            });
        }
        if (
            m.maxRequestCostMicros !== undefined &&
            m.maxRequestCostMicros > (m.perLot.costMicros ?? 0)
        )
            ctx.addIssue({
                code: "custom",
                message: "Request cost exceeds lot allowance",
            });
        if (
            m.perLot.requests > m.total.requests ||
            (m.perLot.costMicros ?? 0) > (m.total.costMicros ?? 0)
        )
            ctx.addIssue({
                code: "custom",
                message: "Per-lot analysis allowance exceeds campaign total",
            });
    });
export const automatedCampaignManifestSchema = v2
    .extend({
        version: z.literal(3),
        analysis: analysisMandateSchema,
    })
    .strict()
    .superRefine(({ analysis: _analysis, ...manifest }, ctx) => {
        const result = configurableCampaignManifestSchema.safeParse({
            ...manifest,
            version: 2,
        });
        if (!result.success)
            for (const issue of result.error.issues)
                ctx.addIssue({
                    code: "custom",
                    message: issue.message,
                    path: issue.path,
                });
    });
export const campaignManifestSchema = z.union([
    legacyCampaignManifestSchema,
    configurableCampaignManifestSchema,
    automatedCampaignManifestSchema,
]);
/** Fresh Sources authority is explicit; historical manifests remain readable and replayable. */
export const newCampaignManifestSchema = campaignManifestSchema.superRefine(
    (manifest, ctx) => {
        if (
            manifest.capability === "sources" &&
            manifest.version !== 1 &&
            manifest.researchDurationMs === undefined
        )
            ctx.addIssue({
                code: "custom",
                message:
                    "Explicit researchDurationMs required for a new configurable Sources campaign",
            });
    },
);

/** Pin the reviewer settlement rules before presenting a new campaign for authorization. */
export const campaignPreparationSchema = newCampaignManifestSchema.transform(
    (manifest) => {
        manifest = {
            ...manifest,
            costAccountingPolicy:
                ("costAccountingPolicy" in manifest
                    ? manifest.costAccountingPolicy
                    : undefined) ?? QUALIFICATION_ACCOUNTING_POLICY,
        };
        if (
            manifest.version !== 3 ||
            manifest.analysis.accounting !== "api_cost"
        )
            return manifest;
        const { analysis } = manifest;
        if (!analysis.pricing) throw new Error("Missing analysis pricing");
        return {
            ...manifest,
            analysis: {
                ...analysis,
                settlementPolicy: "verified_usage_v1" as const,
                maxRequestCostMicros:
                    analysis.maxRequestCostMicros ??
                    Math.max(
                        1,
                        analysisPricingAuthority(analysis.pricing)
                            .maximumCostMicros,
                    ),
            },
        };
    },
);
export type CampaignManifest = z.infer<typeof campaignManifestSchema>;
export type ConfigurableCampaignManifest =
    | z.infer<typeof configurableCampaignManifestSchema>
    | z.infer<typeof automatedCampaignManifestSchema>;
export type QualificationScenario = z.infer<typeof qualificationScenarioSchema>;
export type QualificationStep = z.infer<typeof qualificationStepSchema>;
export type QualificationConfiguration = z.infer<
    typeof qualificationConfigurationSchema
>;
/** Historical grants retain their original single configuration; new campaigns select a declared profile. */
export function campaignConfigurations(
    m: CampaignManifest,
): QualificationConfiguration[] {
    return m.version !== 1
        ? m.configurations
        : [
              {
                  id: "legacy",
                  purpose: "harness_stress",
                  models: m.models,
                  controllerModel: m.controllerModel,
              },
          ];
}
export function campaignConfiguration(
    m: CampaignManifest,
    id?: string,
): QualificationConfiguration {
    const configurations = campaignConfigurations(m);
    const selected = id
        ? configurations.find((c) => c.id === id)
        : configurations[0];
    if (!selected) throw new Error("Undeclared campaign configuration");
    return selected;
}
