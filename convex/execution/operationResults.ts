import type { QueryCtx } from "@convex/_generated/server";
import { sha256Hex, stableStringify } from "@convex/domain/sourcePassages";
import type { Validator } from "convex/values";
import { convexToZod } from "convex-helpers/server/zod4";
import { validate } from "convex-helpers/validators";
import { z } from "zod";
import type { OperationOutcome } from "./agentDefinition";
import { executionError } from "./errors";
import type { OperationObservationOutcome } from "./executionProtocol";

/** Decodes retained RPC transport at the execution boundary; operation callbacks use objects. */
export function observeOperationOutcome(
    outcome: Exclude<OperationOutcome, { kind: "waiting" }>,
): Exclude<OperationObservationOutcome, { kind: "waiting" }>;
export function observeOperationOutcome(
    outcome: OperationOutcome,
): OperationObservationOutcome;
export function observeOperationOutcome(
    outcome: OperationOutcome,
): OperationObservationOutcome {
    if (outcome.kind !== "success") return outcome;
    const { valueJson, ...metadata } = outcome;
    return { ...metadata, value: JSON.parse(valueJson) };
}

/** Domain producers submit a schema-typed value; serialization belongs to the shared journal boundary. */
export function operationSuccess<S extends z.ZodType>(
    schema: S,
    value: NoInfer<z.output<S>>,
    progress: {
        captureId?: import("@convex/_generated/dataModel").Id<"sourceCaptures">;
        progressKey?: string;
        progressKeys?: string[];
    } = {},
): Extract<OperationOutcome, { kind: "success" }> {
    return {
        kind: "success",
        valueJson: JSON.stringify(validateOperationValue(schema, value)),
        ...progress,
    };
}

const schemas = new WeakMap<z.ZodType, object>();
/** Prepared identities include result contracts without leaking runtime validators into model metadata. */
export function operationResultSchema(validator: z.ZodType) {
    let schema = schemas.get(validator);
    if (!schema) {
        schema = z.toJSONSchema(validator, {
            target: "draft-7",
            unrepresentable: "any",
            override: ({ zodSchema, jsonSchema }) => {
                if (zodSchema instanceof z.ZodCustom)
                    jsonSchema.type = "string";
            },
        });
        const canonical = canonicalValidators.get(validator);
        if (canonical)
            schema = {
                ...schema,
                convexValidator: JSON.parse(JSON.stringify(canonical)),
            };
        schemas.set(validator, schema);
    }
    return schema;
}

/** Reject stripping or coercion: the retained observation must be the value that satisfied its contract. */
export function validateOperationValue<S extends z.ZodType>(
    schema: S,
    value: unknown,
    db?: QueryCtx["db"],
): z.output<S> {
    const canonical = canonicalValidators.get(schema);
    if (canonical) validate(canonical, value, { db, throw: true });
    const parsed = schema.parse(value);
    if (stableStringify(parsed) !== stableStringify(value))
        throw executionError("operation_contract_invalid");
    return parsed;
}

type CanonicalResultValidator = Validator<unknown, "required", string>;
const canonicalValidators = new WeakMap<z.ZodType, CanonicalResultValidator>();
/** Keep the Convex schema authoritative for closed fields, table IDs, static types and preparation identity. */
export function operationResultValidator<V extends CanonicalResultValidator>(
    validator: V,
) {
    const schema = convexToZod(validator);
    canonicalValidators.set(schema, validator);
    return schema;
}

const resultKeys = new WeakMap<z.ZodType, string>();
/** Preparation carries only the stable contract identity, not a copy of backend validator metadata. */
export function operationResultKey(validator: z.ZodType) {
    let key = resultKeys.get(validator);
    if (!key) {
        key = sha256Hex(stableStringify(operationResultSchema(validator)));
        resultKeys.set(validator, key);
    }
    return key;
}
