import { vi } from "vitest";

/** Simulates decoded network images while retaining the real Avatar and DOM elements. */
export function mockDecodedImages() {
    vi.stubGlobal("Image", function Image() {
        const image = document.createElement("img");
        Object.defineProperties(image, {
            complete: { value: true },
            naturalWidth: { value: 64 },
        });
        return image;
    });
}
