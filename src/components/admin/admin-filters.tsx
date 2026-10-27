"use client";

import type { api } from "@convex/_generated/api";
import {
    Calendar03Icon,
    FilterIcon,
    GlobalIcon,
    TicketIcon,
} from "@hugeicons/core-free-icons";
import type { FunctionReturnType } from "convex/server";
import type { ComponentPropsWithoutRef } from "react";

import Icon from "@/components/icon";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { executionLabel } from "@/lib/presentation/research-copy";

type ExecutionStatus = Parameters<typeof executionLabel>[0];

const ALL = "all";
const DAY_MS = 24 * 60 * 60 * 1000;
const periodDurations: Record<string, number> = {
    "24h": DAY_MS,
    "7d": 7 * DAY_MS,
    "30d": 30 * DAY_MS,
};

const periodOptions = [
    { value: ALL, label: "All time" },
    { value: "24h", label: "Last 24 hours" },
    { value: "7d", label: "Last 7 days" },
    { value: "30d", label: "Last 30 days" },
] as const;

/** One owner for the "N of M loaded" wording used by every filtered list. */
export function filterSummary(
    shown: number,
    total: number,
    noun: string,
): string {
    return `${shown} of ${total} loaded ${noun} shown. Filters apply to loaded ${noun}.`;
}

function withinPeriod(createdAt: number, period: string, now: number): boolean {
    const duration = periodDurations[period];
    return duration === undefined || createdAt >= now - duration;
}

type FilterOption = { value: string; label: string };

function FilterMenu({
    iconNode,
    label,
    current,
    options,
    onSelect,
}: {
    iconNode: ComponentPropsWithoutRef<typeof Icon>["iconNode"];
    label: string;
    current: string;
    options: ReadonlyArray<FilterOption>;
    onSelect: (value: string) => void;
}) {
    const currentLabel =
        options.find((option) => option.value === current)?.label ?? "All";
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={<Button type="button" variant="outline" size="sm" />}>
                <Icon iconNode={iconNode} data-icon="inline-start" />
                {label}: {currentLabel}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                    value={current}
                    onValueChange={(next) => onSelect(String(next))}>
                    {options.map((option) => (
                        <DropdownMenuRadioItem
                            key={option.value}
                            value={option.value}>
                            {option.label}
                        </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

type ProviderCall = FunctionReturnType<
    typeof api.adminOperations.get
>["providerCalls"][number];

export type ProviderAttemptFilters = {
    status: string;
    service: string;
    period: string;
};

export const attemptFilterDefaults: ProviderAttemptFilters = {
    status: ALL,
    service: ALL,
    period: ALL,
};

const attemptStatusOptions: ReadonlyArray<FilterOption> = [
    { value: ALL, label: "All" },
    { value: "started", label: "Started" },
    { value: "succeeded", label: "Succeeded" },
    { value: "partial", label: "Partial" },
    { value: "failed", label: "Failed" },
];

const serviceOptions: ReadonlyArray<FilterOption> = [
    { value: ALL, label: "All" },
    { value: "model", label: "Model" },
    { value: "sec", label: "SEC public filings" },
    { value: "exa", label: "Independent web discovery" },
    { value: "url_metadata", label: "Public URL inspection" },
    { value: "pdf", label: "PDF processing" },
];

/** Applies the shared status, service and period rule to one provider call. */
export function attemptMatchesFilters(
    call: ProviderCall,
    filters: ProviderAttemptFilters,
    now: number,
): boolean {
    const statusMatches =
        filters.status === ALL || call.status === filters.status;
    const serviceMatches =
        filters.service === ALL || call.service === filters.service;
    return (
        statusMatches &&
        serviceMatches &&
        withinPeriod(call.createdAt, filters.period, now)
    );
}

/** Filter bar for provider attempt lists: status, service and period. */
export function AdminAttemptFilters({
    filters,
    onChange,
    className,
}: {
    filters: ProviderAttemptFilters;
    onChange: (filters: ProviderAttemptFilters) => void;
    className?: string;
}) {
    return (
        <div className={className}>
            <FilterMenu
                iconNode={FilterIcon}
                label="Status"
                current={filters.status}
                options={attemptStatusOptions}
                onSelect={(status) => onChange({ ...filters, status })}
            />
            <FilterMenu
                iconNode={GlobalIcon}
                label="Service"
                current={filters.service}
                options={serviceOptions}
                onSelect={(service) => onChange({ ...filters, service })}
            />
            <FilterMenu
                iconNode={Calendar03Icon}
                label="Period"
                current={filters.period}
                options={periodOptions}
                onSelect={(period) => onChange({ ...filters, period })}
            />
        </div>
    );
}

type DossierRun = FunctionReturnType<
    typeof api.adminOperations.listRunsPage
>["page"][number];

export type DossierRunFilters = {
    status: string;
    period: string;
};

export const dossierFilterDefaults: DossierRunFilters = {
    status: ALL,
    period: ALL,
};

const dossierStatusOptions: ReadonlyArray<FilterOption> = [
    { value: ALL, label: "All" },
    ...(
        [
            "idle",
            "running",
            "paused",
            "failed",
            "cancelled",
            "completed",
        ] as const satisfies ReadonlyArray<ExecutionStatus>
    ).map((status) => ({ value: status, label: executionLabel(status) })),
];

/** Applies the shared execution-status and period rule to one dossier. */
export function dossierMatchesFilters(
    run: DossierRun,
    filters: DossierRunFilters,
    now: number,
): boolean {
    const statusMatches =
        filters.status === ALL || run.executionStatus === filters.status;
    return statusMatches && withinPeriod(run.createdAt, filters.period, now);
}

/** Filter bar for dossier lists: execution status and period. */
export function AdminDossierFilters({
    filters,
    onChange,
    className,
}: {
    filters: DossierRunFilters;
    onChange: (filters: DossierRunFilters) => void;
    className?: string;
}) {
    return (
        <div className={className}>
            <FilterMenu
                iconNode={FilterIcon}
                label="Status"
                current={filters.status}
                options={dossierStatusOptions}
                onSelect={(status) => onChange({ ...filters, status })}
            />
            <FilterMenu
                iconNode={Calendar03Icon}
                label="Period"
                current={filters.period}
                options={periodOptions}
                onSelect={(period) => onChange({ ...filters, period })}
            />
        </div>
    );
}

type Reservation = FunctionReturnType<
    typeof api.adminOperations.get
>["reservations"][number];

export type ReservationFilters = {
    quota: string;
    period: string;
};

export const reservationFilterDefaults: ReservationFilters = {
    quota: ALL,
    period: ALL,
};

const quotaOptions: ReadonlyArray<FilterOption> = [
    { value: ALL, label: "All" },
    { value: "remaining", label: "With remaining" },
    { value: "exhausted", label: "Exhausted" },
    { value: "validation", label: "Reserved for validation" },
];

/** Applies the shared quota and period rule to one reservation. */
export function reservationMatchesFilters(
    reservation: Reservation,
    filters: ReservationFilters,
    now: number,
): boolean {
    let quotaMatches = true;
    if (filters.quota !== ALL) {
        if (reservation.reservedForTesting) {
            quotaMatches = filters.quota === "validation";
        } else if (filters.quota === "remaining") {
            quotaMatches = reservation.remaining > 0;
        } else {
            quotaMatches = reservation.remaining === 0;
        }
    }
    return (
        quotaMatches &&
        withinPeriod(reservation.admittedAt, filters.period, now)
    );
}

/** Filter bar for reservation lists: remaining quota and period. */
export function AdminReservationFilters({
    filters,
    onChange,
    className,
}: {
    filters: ReservationFilters;
    onChange: (filters: ReservationFilters) => void;
    className?: string;
}) {
    return (
        <div className={className}>
            <FilterMenu
                iconNode={TicketIcon}
                label="Quota"
                current={filters.quota}
                options={quotaOptions}
                onSelect={(quota) => onChange({ ...filters, quota })}
            />
            <FilterMenu
                iconNode={Calendar03Icon}
                label="Period"
                current={filters.period}
                options={periodOptions}
                onSelect={(period) => onChange({ ...filters, period })}
            />
        </div>
    );
}
