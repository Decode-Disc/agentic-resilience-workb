/**
 * Motion values shared by the library's JS-driven transitions. The arrival
 * curve's CSS twin is `--wb-ease-arrive` in the workbench foundation, so CSS
 * and Motion transitions decelerate alike.
 */
export const arriveEase = [0.16, 1, 0.3, 1] as const;

/** A selection marker gliding to its new item; no overshoot. */
export const markerTransition = {
    type: "spring",
    bounce: 0,
    duration: 0.34,
} as const;

/** Items entering, leaving or settling in a filtered list. */
export const listTransition = { duration: 0.24, ease: arriveEase } as const;
export const listExitTransition = { duration: 0.12, ease: "easeIn" } as const;
/** Upper bound for staggered entrances, so long lists never keep the reader waiting. */
export const maxStagger = 0.12;
