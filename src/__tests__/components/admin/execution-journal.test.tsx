import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

vi.mock("convex/react", async () => {
    const { convexReactHarness } = await import(
        "@/__tests__/helpers/convex-react-harness"
    );
    return convexReactHarness.module;
});

import { convexReactHarness } from "@/__tests__/helpers/convex-react-harness";
import { AdminExecutionJournal } from "@/components/admin/admin-execution-journal";

const runId = "journal-run" as Id<"researchRuns">;
const event = {
    _id: "event-1",
    runId,
    invocationId: "invocation-1",
    kind: "invocation_reply_recorded",
    cause: "inspect-material",
    occurredAt: 1,
};
const loadMore = vi.fn();
const payloadRead = vi.fn(() => ({
    kind: "recorded",
    payload: {
        state: "complete",
        json: '{"text":"<script>bad()</script>"}',
        sizeBytes: 40,
        contentHash: "journal-hash",
    },
}));
beforeEach(() => {
    convexReactHarness.reset();
    payloadRead.mockClear();
    loadMore.mockClear();
    convexReactHarness
        .paginatedQuery(api.adminOperations.listRunJournalEventsPage)
        .returns({ results: [event], status: "CanLoadMore", loadMore });
    convexReactHarness.query(api.adminOperations.inspectJournalEvent).returns({
        event,
        invocation: {
            journalVersion: 1,
            provenance: "simulation",
            status: "returned",
            taskKey: "inspect-material",
            generation: 1,
        },
        request: null,
        providerCall: null,
    });
    convexReactHarness
        .query(api.adminOperations.readInvocationJournalPayload)
        .returnsFrom(payloadRead);
});

test("loads snapshots only on disclosure and renders their contents as escaped text", () => {
    render(<AdminExecutionJournal runId={runId} />);
    expect(
        screen.getByRole("heading", { name: "Execution journal" }),
    ).toBeTruthy();
    expect(payloadRead).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Reply recorded/ }));
    expect(screen.getByText("Simulation · Not live")).toBeTruthy();
    expect(payloadRead).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Request snapshot" }));
    expect(payloadRead).toHaveBeenCalledWith({
        args: { runId, invocationId: "invocation-1", part: "request" },
    });
    expect(screen.getByText('{"text":"<script>bad()</script>"}')).toBeTruthy();
    expect(document.querySelector("pre script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Load more events" }));
    expect(loadMore).toHaveBeenCalledWith(20);
});

test("distinguishes incomplete and historical snapshots and resets selection when the dossier changes", () => {
    convexReactHarness
        .query(api.adminOperations.readInvocationJournalPayload)
        .returns({
            kind: "recorded",
            payload: {
                state: "incomplete",
                code: "attempt_outcome_unknown",
                sizeBytes: 0,
            },
        });
    const view = render(<AdminExecutionJournal runId={runId} />);
    fireEvent.click(screen.getByRole("button", { name: /Reply recorded/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reply snapshot" }));
    expect(screen.getByText("Incomplete snapshot")).toBeTruthy();
    expect(screen.getByText("Interrupted · outcome unknown")).toBeTruthy();
    view.rerender(
        <AdminExecutionJournal runId={"other-run" as Id<"researchRuns">} />,
    );
    expect(screen.queryByText("Incomplete snapshot")).toBeNull();
    convexReactHarness
        .query(api.adminOperations.readInvocationJournalPayload)
        .returns({ kind: "unavailable", code: "historical_trace" });
    fireEvent.click(screen.getByRole("button", { name: /Reply recorded/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reply snapshot" }));
    expect(screen.getByText("Historical trace · partial journal")).toBeTruthy();
});

test("recovers a failed payload query without collapsing the selected event", () => {
    const logging = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
    const payload = convexReactHarness.query(
        api.adminOperations.readInvocationJournalPayload,
    );
    payload.throws(new Error("backend offline"));
    render(<AdminExecutionJournal runId={runId} />);
    fireEvent.click(screen.getByRole("button", { name: /Reply recorded/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reply snapshot" }));
    expect(screen.getByText("Snapshot unavailable")).toBeTruthy();
    payload.returns({ kind: "unavailable", code: "reply_not_recorded" });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Outcome not recorded · unknown")).toBeTruthy();
    expect(screen.getByText("Simulation · Not live")).toBeTruthy();
    logging.mockRestore();
});

test("a retained structured result remains inspectable before business adoption", () => {
    convexReactHarness.query(api.adminOperations.inspectJournalEvent).returns({
        event,
        invocation: {
            journalVersion: 1,
            provenance: "live",
            status: "started",
            generation: 1,
            receivedOutputJson: '{"kind":"blocked","code":"retained_result"}',
        },
        request: null,
        providerCall: null,
    });
    render(<AdminExecutionJournal runId={runId} />);
    fireEvent.click(screen.getByRole("button", { name: /Reply recorded/ }));
    fireEvent.click(screen.getByRole("button", { name: "Structured result" }));
    expect(
        screen.getByText('{"kind":"blocked","code":"retained_result"}'),
    ).toBeTruthy();
    expect(
        screen.getByText("Response retained · awaiting adoption"),
    ).toBeTruthy();
    expect(screen.queryByText("Outcome not recorded · unknown")).toBeNull();
});

test.each([
    "recorded",
    "unavailable",
])("a known non-dispatch is not shown as unknown when its payload is %s", (kind) => {
    convexReactHarness
        .query(api.adminOperations.readInvocationJournalPayload)
        .returns(
            kind === "recorded"
                ? {
                      kind,
                      payload: {
                          state: "incomplete",
                          code: "not_dispatched",
                          sizeBytes: 0,
                      },
                  }
                : { kind, code: "not_dispatched" },
        );
    render(<AdminExecutionJournal runId={runId} />);
    fireEvent.click(screen.getByRole("button", { name: /Reply recorded/ }));
    fireEvent.click(screen.getByRole("button", { name: "Reply snapshot" }));
    expect(screen.getByText("Not dispatched")).toBeTruthy();
    expect(screen.queryByText("Outcome not recorded · unknown")).toBeNull();
});

test("a late response retained without authority is shown as ineligible for adoption", () => {
    convexReactHarness.query(api.adminOperations.inspectJournalEvent).returns({
        event,
        invocation: {
            journalVersion: 1,
            provenance: "live",
            status: "started",
            generation: 1,
            receivedOutputJson: '{"kind":"complete","captureIds":[]}',
            receivedWhileAuthorized: false,
        },
        request: null,
        providerCall: { dispatchOutcome: "response_received" },
    });
    render(<AdminExecutionJournal runId={runId} />);
    fireEvent.click(screen.getByRole("button", { name: /Reply recorded/ }));
    expect(
        screen.getByText("Response retained · adoption refused"),
    ).toBeTruthy();
    expect(
        screen.queryByText("Response retained · awaiting adoption"),
    ).toBeNull();
});
