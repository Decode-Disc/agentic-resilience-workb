import { useSyncExternalStore } from "react";

const MOBILE_MAX_WIDTH = 48;
const TABLET_MAX_WIDTH = 64;
const LARGE_SCREEN_MIN_WIDTH = 100;

const MOBILE_QUERY = `(max-width: ${MOBILE_MAX_WIDTH}rem)`;
const TABLET_QUERY = `(min-width: ${MOBILE_MAX_WIDTH + 1}rem) and (max-width: ${TABLET_MAX_WIDTH}rem)`;
const TABLET_OR_BELOW_QUERY = `(max-width: ${TABLET_MAX_WIDTH}rem)`;
const LARGE_SCREEN_QUERY = `(min-width: ${LARGE_SCREEN_MIN_WIDTH}rem)`;

/**
 * Subscribes to a media query change event in a browser-safe way.
 */
function subscribeToMediaQuery(
    query: string,
    callback: () => void,
): () => void {
    if (typeof window === "undefined") {
        return () => {};
    }

    const mediaQueryList = window.matchMedia(query);
    mediaQueryList.addEventListener("change", callback);

    return () => {
        mediaQueryList.removeEventListener("change", callback);
    };
}

/**
 * Returns whether a media query currently matches.
 */
function getMediaQuerySnapshot(query: string): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    return window.matchMedia(query).matches;
}

/**
 * Generic media query hook that supports SSR-safe snapshots.
 */
export function useMediaQuery(query: string): boolean {
    return useSyncExternalStore(
        (callback) => subscribeToMediaQuery(query, callback),
        () => getMediaQuerySnapshot(query),
        () => false,
    );
}

export function useResponsive() {
    const isMobile = useMediaQuery(MOBILE_QUERY);
    const isTablet = useMediaQuery(TABLET_QUERY);
    const isTabletOrBelow = useMediaQuery(TABLET_OR_BELOW_QUERY);
    const isLargeScreen = useMediaQuery(LARGE_SCREEN_QUERY);

    return {
        isMobile,
        isTablet,
        isTabletOrBelow,
        isDesktop: !isTabletOrBelow,
        isLargeScreen,
    } as const;
}
