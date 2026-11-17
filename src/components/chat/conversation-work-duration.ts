/** Computes elapsed work once for live mission timers and retained response summaries. Invalid or missing timestamps have no displayed duration. */
export function conversationWorkDuration(
    startedAt: string | undefined,
    endedAt: string | number | undefined,
) {
    if (!startedAt || endedAt === undefined) return undefined;
    const start = Date.parse(startedAt);
    const end = typeof endedAt === "number" ? endedAt : Date.parse(endedAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
    const seconds = Math.max(0, Math.round((end - start) / 1000));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    const padded = (value: number) => String(value).padStart(2, "0");
    return {
        seconds,
        label: hours
            ? `${hours}h ${padded(minutes)}m ${padded(remainder)}s`
            : minutes
              ? `${minutes}m ${padded(remainder)}s`
              : `${seconds}s`,
    };
}
