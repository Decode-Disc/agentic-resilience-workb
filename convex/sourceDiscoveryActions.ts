import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import type { SourceCoverageRole } from "./domain/sourceSelectionPolicy";

import { isExaConfigured } from "./integrations/exaConfiguration";

type SecFiling = {
    accessionNumber: string;
    form?: string;
    filingDate?: string;
    primaryDocument?: string;
};

const ANNUAL_FORMS = new Set(["10-K", "20-F", "40-F"]);
const INTERIM_FORMS = new Set(["10-Q"]);
const MATERIAL_FORMS = new Set(["8-K", "6-K"]);
const GOVERNANCE_FORMS = new Set(["DEF 14A", "3", "4", "5", "144"]);
const FINANCING_FORMS = new Set(["S-1", "S-3", "S-8"]);

function normalizedBaseForm(form: string | undefined): string {
    return (form ?? "").trim().toUpperCase().replace(/\/A$/, "");
}

function newestFirst(left: SecFiling, right: SecFiling): number {
    return (right.filingDate ?? "").localeCompare(left.filingDate ?? "", "en");
}

/** Keeps SEC document identity and provenance identical across initial and targeted discovery. */
export function secFilingCandidate(
    cik: string,
    filing: SecFiling,
    providerResultPosition: number,
) {
    const accession = filing.accessionNumber.replaceAll("-", "");
    const publishedAt = filing.filingDate
        ? Date.parse(filing.filingDate)
        : undefined;
    return {
        canonicalUrl: `https://www.sec.gov/Archives/edgar/data/${cik}/${accession}/${filing.primaryDocument ?? ""}`,
        title: `${filing.form ?? "SEC filing"} · ${filing.filingDate ?? filing.accessionNumber}`,
        origin: "sec" as const,
        category: "regulatory",
        publishedAt: Number.isFinite(publishedAt) ? publishedAt : undefined,
        providerReference: filing.accessionNumber,
        secForm: filing.form,
        secAccessionNumber: filing.accessionNumber,
        providerResultPosition,
        discoveryQueryIndex: -1,
    };
}

export function selectSecFilingsForDiscovery(
    filings: ReadonlyArray<SecFiling>,
    limit: number,
    researchAngle?: string,
    role?: SourceCoverageRole,
): Array<SecFiling> {
    const sorted = [...filings].sort(newestFirst);
    const forms =
        role === "regulatory_annual"
            ? ANNUAL_FORMS
            : role === "regulatory_interim"
              ? INTERIM_FORMS
              : role === "regulatory_material_event"
                ? MATERIAL_FORMS
                : undefined;
    if (forms)
        return sorted
            .filter((filing) => forms.has(normalizedBaseForm(filing.form)))
            .slice(0, limit);
    const selected: Array<SecFiling> = [];
    const addFirst = (forms: ReadonlySet<string>) => {
        const filing = sorted.find((candidate) =>
            forms.has(normalizedBaseForm(candidate.form)),
        );
        if (filing && !selected.includes(filing)) {
            selected.push(filing);
        }
    };

    addFirst(ANNUAL_FORMS);
    addFirst(INTERIM_FORMS);
    for (const filing of sorted) {
        if (
            selected.length >= limit ||
            !MATERIAL_FORMS.has(normalizedBaseForm(filing.form)) ||
            selected.includes(filing)
        ) {
            continue;
        }
        if (
            selected.filter((candidate) =>
                MATERIAL_FORMS.has(normalizedBaseForm(candidate.form)),
            ).length >= 3
        ) {
            break;
        }
        selected.push(filing);
    }
    const normalizedAngle = (researchAngle ?? "").toLocaleLowerCase("en");
    const includeGovernance = [
        "governance",
        "compensation",
        "remuneration",
        "ownership",
    ].some((term) => normalizedAngle.includes(term));
    const includeFinancing = ["financing", "funding", "capital raise"].some(
        (term) => normalizedAngle.includes(term),
    );
    for (const filing of sorted) {
        if (selected.length >= limit || selected.includes(filing)) {
            continue;
        }
        const form = normalizedBaseForm(filing.form);
        if (
            (includeGovernance && GOVERNANCE_FORMS.has(form)) ||
            (includeFinancing && FINANCING_FORMS.has(form))
        ) {
            selected.push(filing);
        }
    }
    return selected.slice(0, limit);
}

export const discoverForRun = internalAction({
    args: {
        runId: v.id("researchRuns"),
        skipWeb: v.optional(v.boolean()),
        cik: v.string(),
        filings: v.array(
            v.object({
                accessionNumber: v.string(),
                form: v.optional(v.string()),
                filingDate: v.optional(v.string()),
                primaryDocument: v.optional(v.string()),
            }),
        ),
    },
    returns: v.object({ total: v.number() }),
    handler: async (ctx, args): Promise<{ total: number }> => {
        const context = await ctx.runQuery(
            internal.researchPlanning.getDiscoveryContext,
            { runId: args.runId },
        );
        const initialCapacity = await ctx.runQuery(
            internal.sourceDiscovery.getCandidateCapacity,
            {
                runId: args.runId,
                executionGeneration: context.executionGeneration,
            },
        );
        const candidates = selectSecFilingsForDiscovery(
            args.filings,
            Math.min(8, initialCapacity.remaining),
            context.researchAngle,
        ).map((filing, index) => secFilingCandidate(args.cik, filing, index));
        const result = await ctx.runMutation(
            internal.sourceDiscovery.persistCandidates,
            {
                runId: args.runId,
                corpusRevisionId: context.corpusRevisionId,
                executionGeneration: context.executionGeneration,
                operationKey: `run:${args.runId}:workflow:2:generation:${context.executionGeneration}:corpus:${context.corpusRevisionId}:step:discover_sources:sec`,
                candidates,
            },
        );
        if (result.total >= initialCapacity.limit) {
            return { total: result.total };
        }
        if (args.skipWeb) return { total: result.total };
        if (isExaConfigured()) {
            return ctx.runAction(internal.exaDiscoveryActions.discoverForRun, {
                runId: args.runId,
            });
        }
        await ctx.runMutation(
            internal.providerCalls.recordConfigurationFailure,
            {
                runId: args.runId,
                executionGeneration: context.executionGeneration,
                service: "exa",
                operation: "search",
                operationKey: `run:${args.runId}:generation:${context.executionGeneration}:exa:configuration`,
                errorCode: "exa_not_configured",
            },
        );
        return { total: result.total };
    },
});
