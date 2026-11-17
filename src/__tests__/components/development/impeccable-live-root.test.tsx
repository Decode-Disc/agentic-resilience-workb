import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ImpeccableLiveRoot from "@/components/development/impeccable-live-root";

const selector = "script[data-impeccable-live-tanstack]";

beforeEach(() => {
    window.history.replaceState(null, "", "/");
    vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
            new Response(
                JSON.stringify({
                    src: "http://localhost:8400/live.js?token=local-test-credential",
                }),
            ),
        ),
    );
});

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.querySelectorAll(selector).forEach((script) => {
        script.remove();
    });
});

test("keeps the live helper disabled on ordinary development pages", () => {
    vi.stubEnv("DEV", true);
    render(<ImpeccableLiveRoot />);
    expect(document.querySelector(selector)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
});

test("loads the authenticated local helper only after explicit URL opt-in and removes its script on unmount", async () => {
    vi.stubEnv("DEV", true);
    window.history.replaceState(null, "", "/?impeccable=1");
    const view = render(<ImpeccableLiveRoot />);
    await waitFor(() =>
        expect(document.querySelector<HTMLScriptElement>(selector)?.src).toBe(
            "http://localhost:8400/live.js?token=local-test-credential",
        ),
    );
    expect(fetch).toHaveBeenCalledWith("/__impeccable/live-connection", {
        cache: "no-store",
    });
    expect(document.querySelectorAll(selector)).toHaveLength(1);
    view.unmount();
    expect(document.querySelector(selector)).toBeNull();
});

test("never loads the helper in production, including with the activation URL", () => {
    vi.stubEnv("DEV", false);
    window.history.replaceState(null, "", "/?impeccable=1");
    render(<ImpeccableLiveRoot />);
    expect(document.querySelector(selector)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
});

test("explains an unavailable local helper without inserting an unauthenticated script", async () => {
    vi.stubEnv("DEV", true);
    window.history.replaceState(null, "", "/?impeccable=1");
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 503 }));
    const warning = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
    render(<ImpeccableLiveRoot />);
    await waitFor(() =>
        expect(warning).toHaveBeenCalledWith(
            "Design tools are unavailable. Start the local Impeccable helper and reload.",
        ),
    );
    expect(document.querySelector(selector)).toBeNull();
});
