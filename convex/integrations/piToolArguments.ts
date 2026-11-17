function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

type CapturedCall = {
    id?: string;
    text: string;
    observed: boolean;
    ambiguous?: boolean;
    initialInput?: Record<string, unknown>;
};

/** Captures only tool argument deltas: Pi repairs their JSON and deletes its raw buffers at completion. */
export function createPiToolArgumentsCapture(api: string) {
    const byIndex = new Map<number, CapturedCall>();
    const byId = new Map<string, CapturedCall>();

    function bind(index: unknown, id: unknown) {
        const streamIndex =
            typeof index === "number" &&
            Number.isSafeInteger(index) &&
            index >= 0
                ? index
                : undefined;
        const callId = typeof id === "string" && id.length > 0 ? id : undefined;
        if (streamIndex === undefined && callId === undefined) return;
        let call =
            streamIndex === undefined ? undefined : byIndex.get(streamIndex);
        call ??= callId === undefined ? undefined : byId.get(callId);
        call ??= { text: "", observed: false };
        if (streamIndex !== undefined) byIndex.set(streamIndex, call);
        if (callId !== undefined) {
            const previous = byId.get(callId);
            if (previous && previous !== call)
                previous.ambiguous = call.ambiguous = true;
            if (call.id !== undefined && call.id !== callId)
                call.ambiguous = true;
            call.id ??= callId;
            byId.set(callId, call);
        }
        return call;
    }

    return {
        observe(event: unknown) {
            if (!record(event)) return;
            if (api === "anthropic-messages") {
                if (
                    event.type === "content_block_start" &&
                    record(event.content_block) &&
                    event.content_block.type === "tool_use"
                ) {
                    const call = bind(event.index, event.content_block.id);
                    if (call && record(event.content_block.input))
                        call.initialInput = event.content_block.input;
                } else if (
                    event.type === "content_block_delta" &&
                    record(event.delta) &&
                    event.delta.type === "input_json_delta"
                ) {
                    const call =
                        typeof event.index === "number"
                            ? byIndex.get(event.index)
                            : undefined;
                    if (call && typeof event.delta.partial_json === "string") {
                        call.text += event.delta.partial_json;
                        call.observed = true;
                    }
                }
                return;
            }
            if (api !== "openai-completions" || !Array.isArray(event.choices))
                return;
            const choice: unknown = event.choices[0];
            if (
                !record(choice) ||
                !record(choice.delta) ||
                !Array.isArray(choice.delta.tool_calls)
            )
                return;
            for (const tool of choice.delta.tool_calls) {
                if (!record(tool)) continue;
                const call = bind(tool.index, tool.id);
                if (
                    call &&
                    record(tool.function) &&
                    typeof tool.function.arguments === "string"
                ) {
                    call.text += tool.function.arguments;
                    call.observed = true;
                }
            }
        },
        forCall(id: string): {
            rawArguments: string | null;
            rawInput?: Record<string, unknown>;
            argumentsError?: string;
        } {
            const call = byId.get(id);
            if (
                call &&
                !call.ambiguous &&
                !call.observed &&
                call.initialInput &&
                Object.keys(call.initialInput).length === 0
            )
                return { rawArguments: "", rawInput: call.initialInput };
            if (!call?.observed || call.ambiguous)
                return {
                    rawArguments: null,
                    argumentsError:
                        "Original tool arguments are unavailable or ambiguously correlated",
                };
            const raw = {
                rawArguments: call.text,
                ...(call.initialInput ? { rawInput: call.initialInput } : {}),
            };
            try {
                const parsed: unknown = JSON.parse(call.text);
                if (!record(parsed))
                    throw new Error("Tool arguments must be a JSON object");
                return raw;
            } catch (error) {
                return {
                    ...raw,
                    argumentsError:
                        error instanceof Error
                            ? error.message
                            : "Invalid tool argument JSON",
                };
            }
        },
    };
}
