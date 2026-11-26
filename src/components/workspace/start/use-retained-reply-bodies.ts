import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useConvex } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useEffect, useRef, useState } from "react";

type Delivery = FunctionReturnType<
    typeof api.workbench.history
>["page"][number];
type BodyDelivery = Pick<Delivery, "_id" | "body">;
type ReadProgress = {
    parts: string[];
    offset: number;
    index: number;
    totalCharacters?: number;
};
type BodyResult =
    | { kind: "ready"; text: string }
    | { kind: "failed"; progress: ReadProgress };

function bodyKey(delivery: BodyDelivery) {
    return `${delivery._id}:${delivery.body?.contentHash ?? ""}`;
}

/** Loads immutable reply bodies independently of delivery pagination and retains completed chunks for retry. */
export function useRetainedReplyBodies(
    runId: Id<"researchRuns">,
    deliveries: readonly BodyDelivery[],
) {
    const convex = useConvex();
    const [bodies, setBodies] = useState(new Map<string, BodyResult>());
    const pending = useRef(new Map<string, AbortController>());

    const load = useCallback(
        async (delivery: BodyDelivery, previous?: ReadProgress) => {
            if (!delivery.body) return;
            const key = bodyKey(delivery);
            if (pending.current.has(key)) return;
            const controller = new AbortController();
            pending.current.set(key, controller);
            const progress: ReadProgress = previous
                ? { ...previous, parts: [...previous.parts] }
                : { parts: [], offset: 0, index: 0 };
            const save = (body: BodyResult) => {
                if (controller.signal.aborted) return;
                setBodies((current) => new Map(current).set(key, body));
            };
            try {
                while (!controller.signal.aborted) {
                    const chunk = await convex.query(
                        api.execution.conversations.readMessageBody,
                        {
                            runId,
                            messageId: delivery._id,
                            contentHash: delivery.body.contentHash,
                            index: progress.index,
                        },
                    );
                    if (controller.signal.aborted) return;
                    const end = progress.offset + chunk.content.length;
                    if (
                        chunk.offset !== progress.offset ||
                        (progress.totalCharacters !== undefined &&
                            progress.totalCharacters !==
                                chunk.totalCharacters) ||
                        end > chunk.totalCharacters ||
                        (chunk.nextIndex === null
                            ? end !== chunk.totalCharacters
                            : end === progress.offset ||
                              end === chunk.totalCharacters ||
                              chunk.nextIndex !== progress.index + 1)
                    )
                        throw new Error("Invalid reply body page");
                    progress.parts.push(chunk.content);
                    progress.offset = end;
                    progress.totalCharacters = chunk.totalCharacters;
                    if (chunk.nextIndex === null) {
                        save({ kind: "ready", text: progress.parts.join("") });
                        return;
                    }
                    progress.index = chunk.nextIndex;
                }
            } catch {
                save({ kind: "failed", progress });
            } finally {
                if (pending.current.get(key) === controller)
                    pending.current.delete(key);
            }
        },
        [convex, runId],
    );

    useEffect(() => {
        const visible = new Set(
            deliveries.filter((delivery) => delivery.body).map(bodyKey),
        );
        for (const [key, controller] of pending.current) {
            if (!visible.has(key)) {
                controller.abort();
                pending.current.delete(key);
            }
        }
        if ([...bodies.keys()].some((key) => !visible.has(key)))
            setBodies(
                (current) =>
                    new Map([...current].filter(([key]) => visible.has(key))),
            );
        for (const delivery of deliveries)
            if (delivery.body && !bodies.has(bodyKey(delivery)))
                void load(delivery);
    }, [deliveries, bodies, load]);

    useEffect(() => {
        const requests = pending.current;
        return () => {
            for (const controller of requests.values()) controller.abort();
            requests.clear();
        };
    }, []);

    return {
        get: (delivery: BodyDelivery) => bodies.get(bodyKey(delivery)),
        retry(delivery: BodyDelivery) {
            const key = bodyKey(delivery);
            const result = bodies.get(key);
            if (result?.kind !== "failed") return;
            setBodies((current) => {
                const next = new Map(current);
                next.delete(key);
                return next;
            });
            void load(delivery, result.progress);
        },
    };
}
