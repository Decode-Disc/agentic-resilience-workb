import { z } from "zod";

const clientEnvSchema = z.object({
    VITE_CONVEX_URL: z
        .url()
        .refine(
            (value) => ["http:", "https:"].includes(new URL(value).protocol),
            {
                message: "VITE_CONVEX_URL must use http or https",
            },
        ),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

export function parseClientEnv(input: Record<string, unknown>): ClientEnv {
    return clientEnvSchema.parse(input);
}
