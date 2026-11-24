import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

    it.each([
        { maxSize: 512, label: "512B" },
        { maxSize: 1536, label: "1.5KB" },
        { maxSize: 1572864, label: "1.5MB" },
    ])("reports the $label limit and retains an exact-limit file after rejecting one byte over", async ({
        maxSize,
        label,
    }) => {
        const onFilesDropped = vi.fn();
        render(
            <FileDropzone onFilesDropped={onFilesDropped} maxSize={maxSize} />,
        );
        const input = screen.getByLabelText("Browse files");
        const accepted = new File([new Uint8Array(maxSize)], "accepted.pdf", {
            type: "application/pdf",
        });
        const oversized = new File(
            [new Uint8Array(maxSize + 1)],
            "oversized.pdf",
            { type: "application/pdf" },
        );
        fireEvent.change(input, { target: { files: [accepted] } });
        expect(screen.getByText("accepted.pdf")).toBeTruthy();
        expect(onFilesDropped).toHaveBeenLastCalledWith([
            expect.objectContaining({ file: accepted }),
        ]);
        fireEvent.change(input, { target: { files: [oversized] } });
        expect(screen.getByRole("alert").textContent).toBe(
            `File oversized.pdf exceeds ${label} limit`,
        );
        expect(
            screen.getByRole("list", { name: "Staged files" }).children,
        ).toHaveLength(1);
        expect(screen.getByText("accepted.pdf")).toBeTruthy();
        expect(onFilesDropped).toHaveBeenCalledTimes(1);
        expect(screen.getByText(`Max ${label} per file`)).toBeTruthy();
        fireEvent.dragOver(screen.getByText("Drag & drop files here"));
        expect(await screen.findByText(`Max ${label}`)).toBeTruthy();
    });
});
