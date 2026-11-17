import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
    Message,
    MessageBody,
    MessageContent,
    MessageCopy,
} from "@/components/chat/message";
import { StartRequestMessage } from "@/components/workspace/start/start-screens";

const originalClipboard = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
);
afterEach(() => {
    if (originalClipboard)
        Object.defineProperty(navigator, "clipboard", originalClipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
});

it("copies the initial request without its metadata and renders the supplied creation time", async () => {
    let clipboard = "";
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
            writeText: async (text: string) => {
                clipboard = text;
            },
        },
    });
    render(
        <StartRequestMessage createdAt="2026-10-28T18:16:00.000Z">
            Inspect who sets the carrier rules.
        </StartRequestMessage>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    await waitFor(() =>
        expect(clipboard).toBe("Inspect who sets the carrier rules."),
    );
    expect(screen.getByText("Copied to clipboard")).toBeTruthy();
    const time = screen.getByRole("time");
    expect(time.getAttribute("datetime")).toBe("2026-10-28T18:16:00.000Z");
    expect(time.getAttribute("title")).toContain("2026");
});

it.each([
    "denied",
    "unavailable",
] as const)("makes a %s clipboard failure actionable without claiming success", async (failure) => {
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value:
            failure === "unavailable"
                ? undefined
                : {
                      writeText: vi
                          .fn()
                          .mockRejectedValue(
                              new Error("NotAllowedError: private diagnostic"),
                          ),
                  },
    });
    render(
        <Message from="user">
            <MessageBody>
                <MessageContent>Inspect switching costs.</MessageContent>
                <MessageCopy />
            </MessageBody>
        </Message>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
        "Select the message text to copy it manually.",
    );
    expect(alert.textContent).not.toMatch(/NotAllowedError|diagnostic/);
    expect(screen.queryByText("Copied to clipboard")).toBeNull();
    let clipboard = "";
    Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
            writeText: async (text: string) => {
                clipboard = text;
            },
        },
    });
    fireEvent.click(screen.getByRole("button", { name: "Copy message" }));
    await waitFor(() =>
        expect(screen.getByText("Copied to clipboard")).toBeTruthy(),
    );
    expect(clipboard).toBe("Inspect switching costs.");
    expect(screen.queryByRole("alert")).toBeNull();
});
