"use client";

import type { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";

import { Badge, type Color } from "@/components/ui/badge";
import {
    executionLabel,
    providerStatusLabel,
} from "@/lib/presentation/research-copy";

type ExecutionStatus = Parameters<typeof executionLabel>[0];
type ProviderStatus = FunctionReturnType<
    typeof api.adminOperations.get
>["providerCalls"][number]["status"];

// One owner for the admin status → tone mapping, so a status never shows two
// different colours across the dossier, receipt and inspection surfaces.
const executionColors = {
    idle: "primary",
    running: "sky",
    paused: "amber",
    failed: "red",
    cancelled: "primary",
    completed: "emerald",
} satisfies Record<ExecutionStatus, Color>;

const providerColors = {
    started: "sky",
    succeeded: "emerald",
    partial: "amber",
    failed: "red",
} satisfies Record<ProviderStatus, Color>;

/** Dossier execution state with its analyst label and semantic tone. */
export function ExecutionStatusBadge({ status }: { status: ExecutionStatus }) {
    return (
        <Badge variant="regular" color={executionColors[status]}>
            {executionLabel(status)}
        </Badge>
    );
}

/** Provider attempt outcome with its analyst label and semantic tone. */
export function ProviderStatusBadge({ status }: { status: ProviderStatus }) {
    return (
        <Badge variant="regular" color={providerColors[status]}>
            {providerStatusLabel(status)}
        </Badge>
    );
}
