import { render } from "@testing-library/react";
import { afterAll, expect, test, vi } from "vitest";
import { InputOTP } from "@/components/ui/input-otp";

let observedDrain = false;

test("a same-task OTP mount and unmount still keeps jsdom alive for its timers", () => {
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
        callback: (...args: unknown[]) => void,
        delay?: number,
        ...args: unknown[]
    ) => {
        if (delay === 60) observedDrain = true;
        return realSetTimeout(callback, delay, ...args);
    }) as typeof setTimeout);

    const { unmount } = render(
        <InputOTP
            maxLength={4}
            render={() => <div data-slot="input-otp-slot" />}
        />,
    );
    unmount();
    expect(document.body.querySelector('[data-slot="input-otp"]')).toBeNull();
});

afterAll(() => {
    expect(observedDrain).toBe(true);
    vi.restoreAllMocks();
});
