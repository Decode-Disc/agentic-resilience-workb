import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

vi.mock("@paper-design/shaders", () => ({
    liquidMetalFragmentShader: "",
    ShaderMount: class ShaderMountMock {
        destroy() {}
        setSpeed() {}
    },
}));

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

if (typeof HTMLCanvasElement !== "undefined") {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
        configurable: true,
        value: vi.fn(() => null),
    });
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

if (typeof window !== "undefined") {
    // Motion restores scroll after measuring height: auto. jsdom has no scrolling layout.
    window.scrollTo = vi.fn();
}

if (
    typeof HTMLElement !== "undefined" &&
    typeof HTMLElement.prototype.getAnimations !== "function"
) {
    Object.defineProperty(HTMLElement.prototype, "getAnimations", {
        configurable: true,
        value: () => [],
    });
}

const INPUT_OTP_SELECTOR = '[data-slot="input-otp"]';
let inputOtpMounted = false;
let inputOtpObserver: MutationObserver | undefined;

function isInputOtpNode(node: Node): boolean {
    return (
        node instanceof Element &&
        (node.matches(INPUT_OTP_SELECTOR) ||
            node.querySelector(INPUT_OTP_SELECTOR) !== null)
    );
}

/** Added nodes are checked before a live query: a same-task unmount leaves no live element. */
function hasInputOtp(records: Iterable<MutationRecord>): boolean {
    for (const record of records) {
        for (const node of record.addedNodes)
            if (isInputOtpNode(node)) return true;
    }
    return false;
}

function latchInputOtp(): void {
    inputOtpMounted = true;
    inputOtpObserver?.disconnect();
    inputOtpObserver = undefined;
}

beforeEach(() => {
    inputOtpMounted = false;
    if (typeof document === "undefined" || !document.body) return;
    if (document.body.querySelector(INPUT_OTP_SELECTOR)) {
        inputOtpMounted = true;
        return;
    }
    inputOtpObserver = new MutationObserver((records) => {
        if (
            hasInputOtp(records) ||
            document.body.querySelector(INPUT_OTP_SELECTOR)
        )
            latchInputOtp();
    });
    inputOtpObserver.observe(document.body, { childList: true, subtree: true });
});

afterEach(async () => {
    if (
        inputOtpObserver &&
        (hasInputOtp(inputOtpObserver.takeRecords()) ||
            document.body.querySelector(INPUT_OTP_SELECTOR))
    )
        inputOtpMounted = true;
    inputOtpObserver?.disconnect();
    inputOtpObserver = undefined;
    const shouldDrainInputOtp = inputOtpMounted;
    inputOtpMounted = false;
    cleanup();
    if (shouldDrainInputOtp) {
        // input-otp schedules 0/10/50 ms synchronization callbacks without a
        // cleanup handle. Keep jsdom alive until those callbacks have drained.
        await new Promise((resolve) => setTimeout(resolve, 60));
    }
});
