import assert from "node:assert/strict";
import { internal } from "@convex/_generated/api";
import { shortRetrievalQuery } from "@convex/domain/sourceRetrievalPolicy";
import { ConvexHttpClient } from "convex/browser";
import {
    type FunctionArgs,
    type FunctionReference,
    type FunctionReturnType,
    getFunctionName,
    makeFunctionReference,
} from "convex/server";

// The SDK exposes public-reference types even when its admin-authenticated client calls internal fixtures.
function adminReference<
    T extends FunctionReference<"mutation" | "action", "internal">,
>(reference: T) {
    return makeFunctionReference<
        T["_type"],
        FunctionArgs<T>,
        FunctionReturnType<T>
    >(getFunctionName(reference));
}

import type {
    SourcesCaptureSearch,
    SourcesPreparation,
} from "./sources-approach-study.ts";

export type NativeInspectionOptions = {
    origin: string;
    deploymentName: string;
    adminKey: string;
    slotKey: string;
    fixtureKey: string;
    preparation: SourcesPreparation;
    signal?: AbortSignal;
    fetch?: typeof fetch;
};

/** Owns the local-only retrieval fixture and maps native identities to frozen dossier references. */
export async function openNativeSourcesInspection(
    options: NativeInspectionOptions,
): Promise<{ search: SourcesCaptureSearch; close: () => Promise<void> }> {
    const origin = new URL(options.origin);
    assert(
        origin.protocol === "http:" &&
            ["127.0.0.1", "localhost"].includes(origin.hostname) &&
            origin.pathname === "/" &&
            !origin.username &&
            !origin.password &&
            !origin.search &&
            !origin.hash,
        "Local loopback retrieval required",
    );
    assert(
        options.adminKey &&
            options.slotKey &&
            /^inspection-[a-f0-9]{12,64}$/.test(options.fixtureKey),
        "Local fixture configuration unavailable",
    );
    const identity = await (options.fetch ?? fetch)(
        `${origin.origin}/instance_name`,
        {
            redirect: "error",
            signal: AbortSignal.any([
                AbortSignal.timeout(5000),
                ...(options.signal ? [options.signal] : []),
            ]),
        },
    );
    assert(
        identity.ok && (await identity.text()) === options.deploymentName,
        "Running backend does not match the project's local deployment",
    );
    let closing = false;
    let activeSignal = options.signal;
    const client = new ConvexHttpClient(origin.origin, {
        logger: false,
        fetch: async (url, init) =>
            (options.fetch ?? fetch)(url, {
                ...init,
                redirect: "error",
                signal: AbortSignal.any([
                    AbortSignal.timeout(180_000),
                    ...(!closing && activeSignal ? [activeSignal] : []),
                ]),
            }),
    });
    (
        client as ConvexHttpClient & { setAdminAuth(key: string): void }
    ).setAdminAuth(options.adminKey);
    const fixture = await client.mutation(
        adminReference(internal.retrievalEvaluation.seed),
        {
            slotKey: options.slotKey,
            fixtureKey: options.fixtureKey,
            company: {
                cik: options.preparation.scenario.company.cik,
                legalName: options.preparation.scenario.company.legalName,
                ticker: options.preparation.scenario.company.ticker,
            },
        },
    );
    let closed = false;
    const close = async () => {
        if (closed) return;
        closing = true;
        await client.mutation(
            adminReference(internal.retrievalEvaluation.finish),
            { preparationId: fixture.preparationId },
        );
        closed = true;
    };
    const captures = new Map<
        string,
        FunctionReturnType<typeof internal.retrievalEvaluation.addDocument>
    >();
    try {
        for (const source of options.preparation.scenario.sources) {
            const input = options.preparation.prepared.get(
                source.candidate.sourceId,
            );
            assert(input, "Frozen input missing");
            const indexed = await client.action(
                adminReference(internal.retrievalEvaluation.addDocument),
                {
                    preparationId: fixture.preparationId,
                    documentKey: source.candidate.sourceId,
                    url: source.candidate.canonicalUrl,
                    title: source.candidate.title,
                    text: input.normalizedText,
                    contentHash: input.request.document.contentHash,
                },
            );
            captures.set(source.candidate.sourceId, indexed);
        }
    } catch (error) {
        await close();
        throw error;
    }
    const search: SourcesCaptureSearch = async (
        query,
        sourceIds,
        offset = 0,
        signal,
    ) => {
        activeSignal = signal ?? options.signal;
        activeSignal?.throwIfAborted();
        assert(
            !closed &&
                sourceIds.length > 0 &&
                sourceIds.length <= 5 &&
                new Set(sourceIds).size === sourceIds.length &&
                sourceIds.every((id) => captures.has(id)),
            "Search source outside frozen corpus",
        );
        assert(
            query.length <= 512 &&
                Number.isSafeInteger(offset) &&
                offset >= 0 &&
                offset < 64,
            "Invalid capture search",
        );
        const normalizedQuery = shortRetrievalQuery(query);
        if (!normalizedQuery)
            return { status: "available", hits: [], nextOffset: null };
        const result = await client.action(
            adminReference(internal.sourceRetrievalActions.retrieve),
            {
                preparationId: fixture.preparationId,
                captureIds: sourceIds.map((id) => {
                    const c = captures.get(id);
                    assert(c);
                    return c.captureId;
                }),
                queries: [normalizedQuery],
                mode: "lexical",
                allowProviderCalls: false,
            },
        );
        const sourceByCapture = new Map(
            [...captures].map(([id, capture]) => [capture.captureId, id]),
        );
        const page = result.passages.slice(offset, offset + 8).map((p) => {
            const sourceId = sourceByCapture.get(p.captureId);
            assert(sourceId, "Foreign native retrieval result");
            const input = options.preparation.prepared.get(sourceId);
            assert(
                input &&
                    input.normalizedText.slice(p.startOffset, p.endOffset) ===
                        p.quotation,
                "Native passage differs from frozen capture",
            );
            return {
                sourceId,
                passageKey: `p${p.order}`,
                excerpt: p.quotation.slice(0, 320),
            };
        });
        return {
            status: "available",
            hits: page,
            nextOffset: offset + 8 < result.passages.length ? offset + 8 : null,
        };
    };
    return { search, close };
}
