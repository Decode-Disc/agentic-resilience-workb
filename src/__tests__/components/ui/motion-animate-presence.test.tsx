import { act } from "@testing-library/react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import MotionAnimatePresence from "@/components/ui/motion-animate-presence";

const preference = vi.hoisted(() => ({ reduced: false }));
vi.mock("motion/react", async (importOriginal) => ({
    ...(await importOriginal<typeof import("motion/react")>()),
    useReducedMotion: () => preference.reduced,
}));
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

test("hydrates an initially visible transition without a server/client motion preference mismatch", async () => {
    preference.reduced = false;
    vi.stubGlobal("matchMedia", () => ({
        matches: preference.reduced,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));
    const example = (
        <MotionAnimatePresence initial={false} preset="slide-right">
            <p>Source details</p>
        </MotionAnimatePresence>
    );
    const container = document.createElement("div");
    container.innerHTML = renderToString(example);
    document.body.append(container);
    preference.reduced = true;
    const consoleError = vi.spyOn(console, "error");
    const onRecoverableError = vi.fn();
    let root: ReturnType<typeof hydrateRoot> | undefined;
    try {
        await act(async () => {
            root = hydrateRoot(container, example, { onRecoverableError });
        });
        expect(onRecoverableError).not.toHaveBeenCalled();
        expect(consoleError).not.toHaveBeenCalled();
        expect(container.textContent).toBe("Source details");
    } finally {
        await act(async () => root?.unmount());
        container.remove();
    }
});
