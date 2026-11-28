import { z } from "zod";
import {
    SOURCE_RETRIEVAL_RANKING_POLICY,
    SOURCE_RETRIEVAL_VERSION,
} from "./sourceRetrievalPolicy";
export const retrievalMetadataSchema = z
    .object({
        version: z.literal(SOURCE_RETRIEVAL_VERSION),
        rankingPolicy: z.literal(SOURCE_RETRIEVAL_RANKING_POLICY).optional(),
        requestedMode: z.enum(["lexical", "hybrid"]),
        effectiveMode: z.enum(["lexical", "hybrid"]),
        degradationReason: z.string().optional(),
        selectedPassageKeys: z.array(z.string()),
        omittedCandidateCount: z.number().int().nonnegative(),
    })
    .strict();
