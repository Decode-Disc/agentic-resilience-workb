import { act, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { Handoff } from "@/components/workbench-ui/handoff";

afterEach(() => vi.useRealTimers());

test("a handoff continues once after its countdown, including under StrictMode", () => {
    vi.useFakeTimers();
    const onContinue = vi.fn();
    render(
        <StrictMode>
            <Handoff summary="4 captured" onContinue={onContinue} />
        </StrictMode>,
    );
    act(() => vi.advanceTimersByTime(3000));
    expect(onContinue).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(3000));
    expect(onContinue).toHaveBeenCalledTimes(1);
});

test("staying cancels the countdown and unmount cannot continue later", () => {
    vi.useFakeTimers();
    const onContinue = vi.fn();
    const onStay = vi.fn();
    const view = render(
        <Handoff
            summary="4 captured"
            onContinue={onContinue}
            onStay={onStay}
        />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Stay here" }));
    act(() => vi.advanceTimersByTime(6000));
    expect(onContinue).not.toHaveBeenCalled();
    expect(onStay).toHaveBeenCalledTimes(1);
    view.unmount();
    act(() => vi.advanceTimersByTime(6000));
    expect(onContinue).not.toHaveBeenCalled();
});

test("manual continuation remains available after cancelling automatic continuation", () => {
    vi.useFakeTimers();
    const onContinue = vi.fn();
    render(<Handoff summary="4 captured" onContinue={onContinue} />);
    fireEvent.click(screen.getByRole("button", { name: "Stay here" }));
    fireEvent.click(screen.getByRole("button", { name: "Go now" }));
    fireEvent.click(screen.getByRole("button", { name: "Go now" }));
    act(() => vi.advanceTimersByTime(6000));
    expect(onContinue).toHaveBeenCalledTimes(1);
});

test("unmounting an active countdown releases its timer without continuing", () => {
    vi.useFakeTimers();
    const onContinue = vi.fn();
    const view = render(
        <Handoff summary="4 captured" onContinue={onContinue} />,
    );
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(6000));
    expect(onContinue).not.toHaveBeenCalled();
});
