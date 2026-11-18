import { fetchExaSearch } from "@convex/integrations/exaSearchClient";
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

test("sends a metadata-only search using the HTTP request contract", async () => {
    const fetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(Response.json({ results: [] }));
    await fetchExaSearch("fixture-key", "ServiceNow pricing", {
        type: "auto",
        numResults: 4,
        contents: false,
        includeDomains: ["servicenow.com"],
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({
        query: "ServiceNow pricing",
        type: "auto",
        numResults: 4,
        includeDomains: ["servicenow.com"],
    });
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

test("rejects an oversized search response before reading its body", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), {
        headers: { "content-length": String(16 * 1024 * 1024 + 1) },
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(response);
    await expect(
        fetchExaSearch("fixture-key", "bounded search", {
            type: "auto",
            numResults: 4,
            contents: false,
        }),
    ).rejects.toMatchObject({ errorCode: "response_too_large" });
    expect(cancel).toHaveBeenCalledOnce();
});

test("a preparation deadline cancels an in-flight search without another request", async () => {
    const deadline = new AbortController();
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(
        (_url, init) =>
            new Promise((_resolve, reject) => {
                init?.signal?.addEventListener("abort", () =>
                    reject(new DOMException("Aborted", "AbortError")),
                );
            }),
    );
    const pending = fetchExaSearch(
        "fixture-key",
        "bounded search",
        { type: "auto", numResults: 4, contents: false },
        deadline.signal,
    );
    const rejection = expect(pending).rejects.toMatchObject({
        name: "AbortError",
    });
    deadline.abort();
    await rejection;
    expect(fetch).toHaveBeenCalledOnce();
});

test("candidate validation releases a stalled DNS lookup when preparation is cancelled", async () => {
    const { validateExaCandidates } = await import(
        "@convex/integrations/exaCandidateValidation"
    );
    const cancellation = new AbortController();
    const resolve = vi.fn<() => Promise<string[]>>(() => new Promise(() => {}));
    const pending = validateExaCandidates(
        [{ canonicalUrl: "https://example.com/source" }],
        resolve,
        cancellation.signal,
    );
    const rejection = expect(pending).rejects.toMatchObject({
        name: "AbortError",
    });
    cancellation.abort();
    await rejection;
    expect(resolve).toHaveBeenCalledOnce();
});
