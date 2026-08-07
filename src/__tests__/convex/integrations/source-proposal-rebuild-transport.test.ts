import { fetchExaSearch } from "@convex/sourceSelectionProposalActions";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

test("aborts the underlying web search before a retry can begin", async () => {
    vi.useFakeTimers();
    let activeRequests = 0;
    let maximumActiveRequests = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
        activeRequests += 1;
        maximumActiveRequests = Math.max(maximumActiveRequests, activeRequests);
        return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
                activeRequests -= 1;
                reject(new DOMException("Aborted", "AbortError"));
            });
        });
    });

    const request = fetchExaSearch("test-key", "ServiceNow sources", {
        type: "auto",
        numResults: 4,
        contents: false,
    });
    const rejection = expect(request).rejects.toMatchObject({
        name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
    expect(activeRequests).toBe(0);
    expect(maximumActiveRequests).toBe(1);
});
