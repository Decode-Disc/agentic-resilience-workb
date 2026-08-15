import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import workflow from "@convex-dev/workflow/convex.config";
import { defineApp } from "convex/server";
import { v } from "convex/values";

const app = defineApp({
    env: {
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
