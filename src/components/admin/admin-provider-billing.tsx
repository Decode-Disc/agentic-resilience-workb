"use client";

import { api } from "@convex/_generated/api";
import { useMutation } from "convex/react";
import type { Doc } from "@convex/_generated/dataModel";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type ProviderCall = Pick<
    Doc<"providerCalls">,
    "_id" | "billing" | "providerObservation" | "reportedCost" | "status"
>;

/** Accounting can become known while the original response remains incomplete. */
export function AdminProviderBilling({ call }: { call: ProviderCall }) {
    const retry = useMutation(api.providerCalls.retryBilling);
    const [pending, setPending] = useState(false);
    const [now, setNow] = useState(Date.now);
    const retryAt = call.billing?.retryAt;
    useEffect(() => {
        if (!retryAt) return;
        const timer = setTimeout(
            () => setNow(Date.now()),
            Math.max(0, retryAt - Date.now()),
        );
        return () => clearTimeout(timer);
    }, [retryAt]);
    const label =
        call.billing?.state === "conflict"
            ? "Conflicting cost reports — inspect provider records"
            : call.reportedCost !== undefined
              ? `Cost confirmed: $${call.reportedCost}`
              : call.billing?.state === "unavailable"
                ? "Cost unavailable"
                : call.billing
                  ? "Checking cost…"
                  : "Cost not recorded";
    const retryReady = retryAt !== undefined && now >= retryAt;
    const recoverable =
        call.providerObservation &&
        call.billing &&
        (call.billing.state === "unavailable" ||
            (["checking", "pending"].includes(call.billing.state) &&
                retryReady));
    return (
        <div className="space-y-1 text-xs text-muted-foreground">
            {call.billing && call.status === "started" ? (
                <p>Response incomplete</p>
            ) : null}
            <p role="status">{label}</p>
            {recoverable ? (
                <Button
                    size="sm"
                    variant="outline"
                    disabled={pending || !retryReady}
                    onClick={async () => {
                        setPending(true);
                        try {
                            const result = await retry({
                                providerCallId: call._id,
                            });
                            if (result.scheduled)
                                toast.success("Cost check requested.");
                            else
                                toast.warning(
                                    "The cost check is already running or is not yet available.",
                                );
                        } catch {
                            toast.error(
                                "We couldn’t request the cost check. Try again.",
                            );
                        } finally {
                            setPending(false);
                        }
                    }}>
                    Check cost again
                </Button>
            ) : null}
        </div>
    );
}
