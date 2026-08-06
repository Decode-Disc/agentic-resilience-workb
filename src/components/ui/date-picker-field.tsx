import { format } from "date-fns";
import { enUS } from "date-fns/locale";
import { CalendarIcon, X } from "lucide-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type DatePickerGranularity = "date" | "datetime";

export type DatePickerFieldProps = {
    id?: string;
    value: string;
    onChange: (nextValue: string) => void;
    granularity?: DatePickerGranularity;
    placeholder?: string;
    disabled?: boolean;
    allowClear?: boolean;
    className?: string;
};

/**
 * Reusable shadcn date picker field for Inertia forms.
 *
 * - `granularity="date"` serializes as `YYYY-MM-DD`
 * - `granularity="datetime"` serializes as `YYYY-MM-DDTHH:mm` (same as `<input type="datetime-local">`)
 */
export default function DatePickerField({
    id,
    value,
    onChange,
    granularity = "date",
    placeholder = "Choisir une date",
    disabled = false,
    allowClear = true,
    className,
}: DatePickerFieldProps) {
    const selectedDate = useMemo(() => {
        if (!value) {
            return undefined;
        }

        return granularity === "datetime"
            ? parseLocalDateTime(value)
            : parseLocalDate(value);
    }, [granularity, value]);

    const timeValue = useMemo(() => {
        if (granularity !== "datetime") {
            return "";
        }

        const parsed = parseLocalDateTime(value);

        if (!parsed) {
            return "";
        }

        return `${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}`;
    }, [granularity, value]);

    const displayValue = useMemo(() => {
        if (!selectedDate) {
            return "";
        }

        return granularity === "datetime"
            ? format(selectedDate, "PPP p", { locale: enUS })
            : format(selectedDate, "PPP", { locale: enUS });
    }, [granularity, selectedDate]);

    const handleSelectDate = (date: Date | undefined) => {
        if (!date) {
            return;
        }

        if (granularity === "date") {
            onChange(formatLocalDate(date));
            return;
        }

        const existing = parseLocalDateTime(value);
        const hours = existing ? existing.getHours() : 0;
        const minutes = existing ? existing.getMinutes() : 0;

        const next = new Date(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
            hours,
            minutes,
            0,
            0,
        );

        onChange(formatLocalDateTime(next));
    };

    const handleTimeChange = (nextTime: string) => {
        if (granularity !== "datetime") {
            return;
        }

        const datePart = selectedDate ?? new Date();
        const [hoursRaw, minutesRaw] = nextTime.split(":");
        const hours = Number(hoursRaw);
        const minutes = Number(minutesRaw);

        if (Number.isNaN(hours) || Number.isNaN(minutes)) {
            return;
        }

        const next = new Date(
            datePart.getFullYear(),
            datePart.getMonth(),
            datePart.getDate(),
            hours,
            minutes,
            0,
            0,
        );

        onChange(formatLocalDateTime(next));
    };

    const handleClear = () => {
        onChange("");
    };

    return (
        <Popover>
            <PopoverTrigger
                render={
                    <Button
                        id={id}
                        variant="outline"
                        type="button"
                        disabled={disabled}
                        className={cn(
                            "w-full justify-start text-left font-normal",
                            !value && "text-muted-foreground",
                            className,
                        )}
                        data-slot="date-trigger">
                        <CalendarIcon className="mr-2 size-4" />
                        {displayValue || placeholder}
                    </Button>
                }></PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
                <div className="p-3">
                    <Calendar
                        mode="single"
                        selected={selectedDate}
                        onSelect={handleSelectDate}
                        disabled={disabled}
                        locale={enUS}
                        autoFocus
                    />

                    {granularity === "datetime" ? (
                        <div className="mt-3 flex items-center gap-2">
                            <Input
                                type="time"
                                value={timeValue}
                                onChange={(event) =>
                                    handleTimeChange(event.target.value)
                                }
                                disabled={disabled}
                            />
                            {allowClear ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={handleClear}
                                    disabled={disabled || !value}
                                    aria-label="Effacer la date">
                                    <X className="size-4" />
                                </Button>
                            ) : null}
                        </div>
                    ) : allowClear ? (
                        <div className="mt-3 flex justify-end">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={handleClear}
                                disabled={disabled || !value}
                                aria-label="Effacer la date">
                                Effacer
                            </Button>
                        </div>
                    ) : null}
                </div>
            </PopoverContent>
        </Popover>
    );
}

function pad2(value: number): string {
    return String(value).padStart(2, "0");
}

function parseLocalDate(value: string): Date | undefined {
    const trimmed = value.trim();

    if (!trimmed) {
        return undefined;
    }

    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) {
        return undefined;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);

    if (
        Number.isNaN(year) ||
        Number.isNaN(month) ||
        Number.isNaN(day) ||
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31
    ) {
        return undefined;
    }

    return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function parseLocalDateTime(value: string): Date | undefined {
    const trimmed = value.trim();

    if (!trimmed) {
        return undefined;
    }

    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);

    if (!match) {
        return undefined;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const hours = Number(match[4]);
    const minutes = Number(match[5]);

    if (
        Number.isNaN(year) ||
        Number.isNaN(month) ||
        Number.isNaN(day) ||
        Number.isNaN(hours) ||
        Number.isNaN(minutes)
    ) {
        return undefined;
    }

    return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function formatLocalDate(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(
        date.getDate(),
    )}`;
}

function formatLocalDateTime(date: Date): string {
    return `${formatLocalDate(date)}T${pad2(date.getHours())}:${pad2(
        date.getMinutes(),
    )}`;
}
