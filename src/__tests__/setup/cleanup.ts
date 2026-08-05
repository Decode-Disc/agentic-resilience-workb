import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
}

class IntersectionObserverMock implements IntersectionObserver {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = "";
    readonly scrollMargin: string = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
        return [];
    }
}

if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = ResizeObserverMock;
}

if (!globalThis.IntersectionObserver) {
    globalThis.IntersectionObserver = IntersectionObserverMock;
}

if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addListener: () => undefined,
            removeListener: () => undefined,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
            dispatchEvent: () => false,
        }),
    });
}

afterEach(() => {
    cleanup();
});
