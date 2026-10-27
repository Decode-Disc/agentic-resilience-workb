import type { Doc, Id } from "../_generated/dataModel";

/** A withdrawable dossier is an owned research run whose consumed seat can be administratively released once. */
export function withdrawableRun(
    run: Doc<"researchRuns">,
): run is Doc<"researchRuns"> & { ownerVisitorId: Id<"visitors"> } {
    return (
        run.purpose === "research" &&
        run.ownerVisitorId !== undefined &&
        run.reservationStatus === "consumed" &&
        run.withdrawnAt === undefined
    );
}
