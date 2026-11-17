export const PAID_WORK_DISABLED_CODE = "paid_work_disabled" as const;

export function paidWorkDisabledErrorData() {
    return {
        code: PAID_WORK_DISABLED_CODE,
        message: "Paid provider work is disabled",
    };
}

export function isPaidWorkDisabledError(error: unknown): boolean {
    if (!error || typeof error !== "object" || !("data" in error)) {
        return false;
    }
    const data = error.data;
    if (!data || typeof data !== "object" || !("code" in data)) {
        return false;
    }
    return data.code === PAID_WORK_DISABLED_CODE;
}
