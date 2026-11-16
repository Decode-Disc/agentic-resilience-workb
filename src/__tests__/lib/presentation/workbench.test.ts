import { expect, test } from "vitest";

test("a full conversation journal explains preservation without inviting a futile new request", async () => {
    const { workbenchFailureCopy } = await import(
        "@/lib/presentation/workbench"
    );
    const copy = workbenchFailureCopy("pi_storage_capacity");
    expect(copy).toContain("conversation");
    expect(copy).toContain("remain available");
    expect(copy).not.toMatch(/send.*message|narrower request/i);
    expect(copy).not.toContain("pi_storage_capacity");
});

test("an unresolved conversation closure explains the retained work without promising another send can recover it", async () => {
    const { workbenchFailureCopy } = await import(
        "@/lib/presentation/workbench"
    );
    const copy = workbenchFailureCopy("native_settlement_incomplete");
    expect(copy).toContain("requires recovery");
    expect(copy).toContain("recorded work remain available");
    expect(copy).not.toMatch(
        /native_settlement|Send another message|writer|session/,
    );
});

test("a conversation from an earlier Workbench version points to a new dossier instead of a futile resend", async () => {
    const { workbenchFailureCopy } = await import(
        "@/lib/presentation/workbench"
    );
    const copy = workbenchFailureCopy("definition_version_conflict");
    expect(copy).toContain("earlier version");
    expect(copy).toContain("new dossier");
    expect(copy).not.toMatch(
        /Send another message|definition_version|conflict/,
    );
});
