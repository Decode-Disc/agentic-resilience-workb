import { piInputProfileKey } from "@convex/integrations/modelInput";
import { expect, test } from "vitest";

test("native profile identity changes with the configured instruction bytes", async () => {
    const common = {
        prompt: "",
        operations: {},
        definitionVersion: 2,
        nativeConversation: true,
    };
    const first = "A";
    const second = "B";
    expect(new TextEncoder().encode(first).length).toBe(
        new TextEncoder().encode(second).length,
    );
    const nativeFirst = await piInputProfileKey({
        ...common,
        instructions: first,
    });
    const nativeSecond = await piInputProfileKey({
        ...common,
        instructions: second,
    });
    const legacyFirst = await piInputProfileKey({
        ...common,
        nativeConversation: false,
        instructions: first,
    });
    const legacySecond = await piInputProfileKey({
        ...common,
        nativeConversation: false,
        instructions: second,
    });
    expect(legacyFirst).not.toBe(legacySecond);
    expect(nativeFirst).not.toBe(nativeSecond);
});
