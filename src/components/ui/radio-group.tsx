import { Radio } from "@base-ui/react/radio";
import { RadioGroup as Group } from "@base-ui/react/radio-group";
import { cn } from "@/lib/utils";

function RadioGroup({ className, ...props }: Group.Props) {
    return (
        <Group
            data-slot="radio-group"
            className={cn("grid gap-3", className)}
            {...props}
        />
    );
}
function RadioGroupItem({ className, ...props }: Radio.Root.Props) {
    return (
        <Radio.Root
            data-slot="radio-group-item"
            className={cn(
                "grid size-4 shrink-0 place-items-center rounded-full border border-input-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-checked:border-primary",
                className,
            )}
            {...props}>
            <Radio.Indicator className="size-2 rounded-full bg-current" />
        </Radio.Root>
    );
}

export { RadioGroup, RadioGroupItem };
