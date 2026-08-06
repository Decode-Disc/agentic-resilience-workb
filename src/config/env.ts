import { parseClientEnv } from "./env-schema";

export const clientEnv = parseClientEnv(import.meta.env);
