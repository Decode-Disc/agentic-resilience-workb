import { z } from "zod";
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
export const analysisReceiptSchema = z
    .object({
        input: z.number().int().nonnegative().safe(),
        output: z.number().int().nonnegative().safe(),
        accounting: z.enum(["api_cost", "native_subscription"]).optional(),
        costMicros: z.number().int().nonnegative().safe().optional(),
        observationHash: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .optional(),
    })
    .strict()
    .superRefine((receipt, ctx) => {
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
        accounting: z.literal("native_subscription").optional(),
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
