import { RateLimiter } from "@convex-dev/rate-limiter";
import { components } from "./_generated/api";
import { RATE_LIMITS } from "./resourcePolicy";

export const rateLimiter = new RateLimiter(components.rateLimiter, RATE_LIMITS);
