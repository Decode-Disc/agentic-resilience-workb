import {
    type CoveragePreset,
    coveragePresetOptions,
} from "@/lib/presentation/research-copy";
import { cn } from "@/lib/utils";

export type { CoveragePreset } from "@/lib/presentation/research-copy";

/** Selects discovery priorities without changing mandatory workflow stages. */
export function CoveragePresetPicker({
    value,
    onChange,
}: {
    value: CoveragePreset;
    onChange: (value: CoveragePreset) => void;
}) {
    return (
        <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Coverage preset</legend>
            <div className="grid gap-2 md:grid-cols-3">
                {coveragePresetOptions.map((option) => (
                    <label
                        key={option.value}
                        className={cn(
                            "cursor-pointer rounded-xl border border-border/60 p-3 transition-[border-color,background-color] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)]",
                            value === option.value
                                ? "border-ring bg-accent"
                                : "bg-card hover:bg-muted/60",
                        )}>
                        <span className="flex items-center gap-2">
                            <input
                                type="radio"
                                name="coverage-preset"
                                value={option.value}
                                checked={value === option.value}
                                onChange={() => onChange(option.value)}
                                className="accent-primary"
                            />
                            <span className="text-sm font-medium">
                                {option.label}
                            </span>
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                            {option.description}
                        </span>
                    </label>
                ))}
            </div>
        </fieldset>
    );
}
