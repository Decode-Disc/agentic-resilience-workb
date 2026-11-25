import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
    env: {
        OPENROUTER_API_KEY: v.optional(v.string()),
        SOURCE_QUALIFICATION_ENABLED: v.optional(v.string()),
        SOURCE_PREPARATION_WORK_LIMIT: v.optional(v.string()),
        SOURCE_PREPARATION_INCIDENT_LIMIT: v.optional(v.string()),
        SOURCE_PREPARATION_MAX_CONCURRENCY: v.optional(v.string()),
        SOURCES_PREPARATION_WINDOW_MINUTES: v.optional(v.string()),
        SOURCE_RETRIEVAL_MODE: v.optional(
            v.union(v.literal("lexical"), v.literal("hybrid")),
        ),
        CLOUDFLARE_ACCOUNT_ID: v.optional(v.string()),
        CLOUDFLARE_AI_TOKEN: v.optional(v.string()),
        COMPANY_SEARCH_RESULT_LIMIT: v.optional(v.string()),
        SOURCE_CANDIDATE_LIMIT: v.optional(v.string()),
        SOURCE_RECOMMENDATION_CEILING: v.optional(v.string()),
        PREVIEW_CACHE_TTL_MS: v.optional(v.string()),
        E2E_FIXTURES_ENABLED: v.optional(v.string()),
    },
});
app.use(workflow);
app.use(rateLimiter);

export default app;
