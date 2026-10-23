export type SourceQualificationRoute = Readonly<{
    model: string;
    provider: string;
}>;

/** Provider identifiers stay in transport configuration, outside domain records and workflows. */
export const sourceQualificationRoutes = [
    { model: "deepseek/deepseek-v4.1-flash", provider: "relace" },
    { model: "deepseek/deepseek-v4.1-flash-1017", provider: "relace" },
] as const satisfies ReadonlyArray<SourceQualificationRoute>;
export const QUALIFICATION_MAX_OUTPUT_TOKENS = 6144;
export const QUALIFICATION_ATTEMPT_TIMEOUT_MS = 60_000;
export const QUALIFICATION_MAX_INPUT_PRICE_PER_MILLION = 0.15;
export const QUALIFICATION_MAX_OUTPUT_PRICE_PER_MILLION = 0.6;
