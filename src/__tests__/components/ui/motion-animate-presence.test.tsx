import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
    MOTION_PRESETS,
    MotionAnimatePresence,
    registerMotionPreset,
} from "@/components/ui/motion-animate-presence";

describe("MotionAnimatePresence", () => {
    it("renders children with default preset and mode", () => {
        render(
            <MotionAnimatePresence>
                <div data-testid="child">Test Content</div>
            </MotionAnimatePresence>,
        );

        expect(screen.getByTestId("child")).toBeTruthy();
        expect(screen.getByText("Test Content")).toBeTruthy();
    });

    it("supports custom presets like fade, slide-up, slide-down, blur, flip-x", () => {
        const { rerender } = render(
            <MotionAnimatePresence preset="fade">
                <div data-testid="fade-child">Fade Content</div>
            </MotionAnimatePresence>,
        );

        expect(screen.getByTestId("fade-child")).toBeTruthy();

        rerender(
            <MotionAnimatePresence preset="slide-up">
                <div data-testid="slide-child">Slide Content</div>
            </MotionAnimatePresence>,
        );

        expect(screen.getByTestId("slide-child")).toBeTruthy();

        rerender(
            <MotionAnimatePresence preset="blur">
                <div data-testid="blur-child">Blur Content</div>
            </MotionAnimatePresence>,
        );

        expect(screen.getByTestId("blur-child")).toBeTruthy();
    });

    it("supports show prop to conditionally show/hide children", () => {
        const { rerender } = render(
            <MotionAnimatePresence show={true}>
                <div data-testid="visible-child">Visible</div>
            </MotionAnimatePresence>,
        );

        expect(screen.getByTestId("visible-child")).toBeTruthy();

        rerender(
            <MotionAnimatePresence show={false}>
                <div data-testid="visible-child">Visible</div>
            </MotionAnimatePresence>,
        );
    });

    it("exports MOTION_PRESETS map and registerMotionPreset utility", () => {
        expect(MOTION_PRESETS.fade).toBeDefined();
        expect(MOTION_PRESETS["slide-up"]).toBeDefined();
        expect(MOTION_PRESETS["slide-down"]).toBeDefined();
        expect(MOTION_PRESETS["slide-left"]).toBeDefined();
        expect(MOTION_PRESETS["slide-right"]).toBeDefined();
        expect(MOTION_PRESETS.blur).toBeDefined();
        expect(MOTION_PRESETS["flip-x"]).toBeDefined();
        expect(MOTION_PRESETS["flip-y"]).toBeDefined();

        registerMotionPreset("custom-bounce", {
            initial: { opacity: 0, y: -50 },
            animate: { opacity: 1, y: 0 },
            exit: { opacity: 0, y: 50 },
        });

        expect(MOTION_PRESETS["custom-bounce"]).toBeDefined();
    });

    it("supports duration and delay props", () => {
        render(
            <MotionAnimatePresence duration={0.5} delay={0.2} preset="fade">
                <div data-testid="timed-child">Timed Content</div>
            </MotionAnimatePresence>,
        );

        expect(screen.getByTestId("timed-child")).toBeTruthy();
    });

    it("supports infinite viewport trigger mode", () => {
        render(
            <MotionAnimatePresence infinite preset="slide-up">
                <div data-testid="infinite-child">Infinite Scroll Content</div>
            </MotionAnimatePresence>,
        );

        expect(screen.getByTestId("infinite-child")).toBeTruthy();
    });
});
