import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("motion/react", () => ({
    AnimatePresence: ({ children }: { children: React.ReactNode }) => (
        <>{children}</>
    ),
    motion: new Proxy(
        {},
        {
            get: () => (props: React.ComponentProps<"div">) => (
                <div {...props} />
            ),
        },
    ),
    useReducedMotion: () => false,
}));

import { type DroppedFile, FileDropzone } from "@/components/ui/file-dropzone";

describe("FileDropzone", () => {
    it("surfaces staged files with an accessible list and per-file removal", () => {
        const onFilesDropped = vi.fn();
        const initialFiles: DroppedFile[] = [
            {
                id: "demo-1",
                file: new File([""], "evidence.pdf", {
                    type: "application/pdf",
                }),
            },
        ];

        render(
            <FileDropzone
                onFilesDropped={onFilesDropped}
                initialFiles={initialFiles}
            />,
        );

        expect(
            screen.getByRole("list", { name: /staged files/i }),
        ).toBeTruthy();
        expect(screen.getByText(/evidence\.pdf/i)).toBeTruthy();
        expect(
            screen.getByRole("button", { name: /Remove evidence\.pdf/i }),
        ).toBeTruthy();

        fireEvent.click(
            screen.getByRole("button", { name: /Remove evidence\.pdf/i }),
        );
        expect(onFilesDropped).toHaveBeenLastCalledWith([]);
    });

    it("reports a per-file size error without dropping valid files already staged", () => {
        const onFilesDropped = vi.fn();
        const { container } = render(
            <FileDropzone
                onFilesDropped={onFilesDropped}
                maxSize={1024} // 1KB ceiling
            />,
        );

        const oversized = new File([new Uint8Array(2048)], "big.pdf", {
            type: "application/pdf",
        });
        const input = container.querySelector(
            'input[type="file"]',
        ) as HTMLInputElement;
        expect(input).toBeTruthy();
        fireEvent.change(input, { target: { files: [oversized] } });

        expect(screen.getByRole("alert").textContent).toMatch(
            /big\.pdf exceeds 0MB limit/,
        );
        expect(onFilesDropped).not.toHaveBeenCalled();
    });
});
