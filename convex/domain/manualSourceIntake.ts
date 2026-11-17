export type ManualSourceIntakeErrorCode =
    | "invalid_url"
    | "https_required"
    | "credentials_not_allowed"
    | "custom_port_not_allowed"
    | "non_public_destination"
    | "dns_failed"
    | "redirect_limit"
    | "request_timeout"
    | "connection_failed"
    | "access_blocked"
    | "not_found"
    | "upstream_rate_limited"
    | "upstream_unavailable"
    | "unsupported_content_type"
    | "response_too_large"
    | "duplicate_source"
    | "candidate_limit"
    | "intake_rate_limited"
    | "preparation_expired"
    | "dossier_not_accepting_sources"
    | "stale_execution"
    | "not_authenticated"
    | "not_authorized"
    | "unexpected";

export type ManualSourceIntakeErrorData = {
    area: "manual_source_intake";
    code: ManualSourceIntakeErrorCode;
    retryable: boolean;
    field?: "url";
    preparationId?: string;
};

const manualSourceIntakeErrorCodes = new Set<ManualSourceIntakeErrorCode>([
    "invalid_url",
    "https_required",
    "credentials_not_allowed",
    "custom_port_not_allowed",
    "non_public_destination",
    "dns_failed",
    "redirect_limit",
    "request_timeout",
    "connection_failed",
    "access_blocked",
    "not_found",
    "upstream_rate_limited",
    "upstream_unavailable",
    "unsupported_content_type",
    "response_too_large",
    "duplicate_source",
    "candidate_limit",
    "intake_rate_limited",
    "preparation_expired",
    "dossier_not_accepting_sources",
    "stale_execution",
    "not_authenticated",
    "not_authorized",
    "unexpected",
]);

const retryableCodes = new Set<ManualSourceIntakeErrorCode>([
    "request_timeout",
    "connection_failed",
    "upstream_rate_limited",
    "upstream_unavailable",
]);

export class ManualSourceIntakeError extends Error {
    readonly data: ManualSourceIntakeErrorData;

    constructor(
        code: ManualSourceIntakeErrorCode,
        details: Pick<
            ManualSourceIntakeErrorData,
            "field" | "preparationId"
        > = {},
    ) {
        super(`Manual source intake failed (${code})`);
        this.name = "ManualSourceIntakeError";
        this.data = {
            area: "manual_source_intake",
            code,
            retryable: retryableCodes.has(code),
            ...details,
        };
    }
}

export function manualSourceIntakeError(
    code: ManualSourceIntakeErrorCode,
    details: Pick<ManualSourceIntakeErrorData, "field" | "preparationId"> = {},
): ManualSourceIntakeError {
    return new ManualSourceIntakeError(code, details);
}

export function classifyManualSourceIntakeError(
    error: unknown,
): ManualSourceIntakeError {
    if (error instanceof ManualSourceIntakeError) {
        return error;
    }
    if (typeof error === "object" && error !== null && "data" in error) {
        const data = error.data;
        if (
            typeof data === "object" &&
            data !== null &&
            "area" in data &&
            data.area === "manual_source_intake" &&
            "code" in data &&
            typeof data.code === "string" &&
            manualSourceIntakeErrorCodes.has(
                data.code as ManualSourceIntakeErrorCode,
            )
        ) {
            const field =
                "field" in data && data.field === "url" ? "url" : undefined;
            const preparationId =
                "preparationId" in data &&
                typeof data.preparationId === "string"
                    ? data.preparationId
                    : undefined;
            return manualSourceIntakeError(
                data.code as ManualSourceIntakeErrorCode,
                { field, preparationId },
            );
        }
    }
    if (error instanceof DOMException && error.name === "AbortError") {
        return manualSourceIntakeError("request_timeout");
    }
    if (error instanceof TypeError) {
        return manualSourceIntakeError("connection_failed");
    }
    return manualSourceIntakeError("unexpected");
}
