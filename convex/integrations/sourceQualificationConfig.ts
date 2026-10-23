/** Provider identifiers stay in transport configuration, outside domain records and workflows. */
export const sourceQualificationRoutes = [
    { model: "deepseek/deepseek-v4-flash-0731", provider: "reka" },
    { model: "xiaomi/mimo-v2.6-flash", provider: "deepinfra/fp8" },
] as const;

export type SourceQualificationRoute =
    (typeof sourceQualificationRoutes)[number];
export const QUALIFICATION_MAX_OUTPUT_TOKENS = 6144;
export const QUALIFICATION_ATTEMPT_TIMEOUT_MS = 60_000;
export const QUALIFICATION_MAX_INPUT_PRICE_PER_MILLION = 0.15;
export const QUALIFICATION_MAX_OUTPUT_PRICE_PER_MILLION = 0.6;
