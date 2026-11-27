"use node";

import { internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ActionCtx } from "@convex/_generated/server";
import { sha256Hex } from "@convex/domain/sourcePassages";
import { documentarySubmissionResult } from "@convex/domain/sourcesContracts";
import { documentaryQuotationMatches } from "@convex/domain/sourceUsage";
import { sourcesDocumentaryMethod } from "@convex/execution/agentSkillContracts";
import type { operationOutcomeValidator } from "@convex/execution/executionProtocol";
import { operationSuccess } from "@convex/execution/operationResults";
import {
    type DocumentaryControlAttempt,
    examineDocumentaryContributions,
} from "@convex/integrations/documentaryControl";
import { isOpenRouterConfigured } from "@convex/integrations/openRouterConfiguration";
import { simulatedDocumentaryControl } from "@convex/sourcesSimulation";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import type { Infer } from "convex/values";
import { executePreparationModel } from "./preparationModel";

type Reservation = FunctionReturnType<typeof internal.sourcesMission.reserve>;

/** Reuses a retained control or examines contributions against their exact retained passages. */
export async function examineContributions(
    ctx: ActionCtx,
    args: FunctionArgs<typeof internal.sourcesMission.reserve>,
    {
        preparation,
        contributions,
        inputHash,
        sourceId,
        needContext,
        scheduledRecovery,
        originalExaminationJson,
    }: Reservation,
    simulation: boolean,
    executionDeadlineAt: number,
): Promise<Infer<typeof operationOutcomeValidator>> {
    if (!sourceId) return { kind: "refused", code: "source_not_owned" };
    const cached = await ctx.runQuery(internal.sourcesMission.cachedControl, {
        ...args,
        inputHash,
    });
    if (
        cached?.output.kind === "documentary_control" &&
        cached.output.examination.state === "examined" &&
        cached.providerCallId
    ) {
        const result = await ctx.runMutation(
            internal.sourcesMission.retainControl,
            {
                ...args,
                inputHash,
                contributions,
                control: cached.output.examination.control,
                providerCallId: cached.providerCallId,
            },
        );
        return operationSuccess(documentarySubmissionResult, result, {
            progressKeys: [sha256Hex(`control:${inputHash}`)],
        });
    }
    if (!simulation && !isOpenRouterConfigured())
        return { kind: "unavailable", code: "missing_configuration" };
    const evidence = [];
    const grouped = new Map<
        Id<"sourceCaptures">,
        Map<number, (typeof contributions)[number]["evidence"][number]>
    >();
    for (const reference of contributions.flatMap((c) => c.evidence)) {
        const passages = grouped.get(reference.captureId) ?? new Map();
        passages.set(reference.passageOrder, reference);
        grouped.set(reference.captureId, passages);
    }
    for (const [captureId, references] of grouped) {
        const capture = await ctx.runQuery(
            internal.sourceRetrieval.captureIdentityForPreparation,
            {
                preparationId: preparation._id,
                captureId,
            },
        );
        const batch = await ctx.runAction(
            internal.sourceRetrievalActions.readApprovedMaterialForMission,
            {
                runId: preparation.runId,
                expectedGeneration: args.expectedGeneration,
                sourceId: capture.sourceId,
                exactCapture: {
                    preparationId: preparation._id,
                    captureId,
                    contentHash: capture.contentHash,
                },
                request: {
                    kind: "contexts",
                    passageOrders: [...references.keys()],
                },
            },
        );
        if (batch.status !== "ready" || batch.kind !== "contexts")
            return {
                kind: "unavailable",
                code:
                    batch.status === "unavailable"
                        ? batch.reason
                        : "documentary_quote_invalid",
            };
        for (const reference of references.values()) {
            const reading = batch.contexts.find(
                (r) => r.passage.order === reference.passageOrder,
            );
            if (
                reading?.captureId !== reference.captureId ||
                !documentaryQuotationMatches(
                    {
                        ...reading.passage,
                        contentHash: reading.contentHash,
                    },
                    capture.contentHash,
                    reference.quotation,
                )
            )
                return {
                    kind: "unavailable",
                    code: "documentary_quote_invalid",
                };
            evidence.push(reading);
            if (
                new TextEncoder().encode(
                    JSON.stringify({
                        contributions,
                        evidence,
                        needs: needContext,
                    }),
                ).length >
                128 * 1024
            )
                return {
                    kind: "unavailable",
                    code: "model_input_capacity",
                };
        }
    }
    const examination = { contributions, evidence, needs: needContext };
    // A successor must use the same method as the request it is recovering.
    const retained: unknown =
        originalExaminationJson === undefined
            ? undefined
            : JSON.parse(originalExaminationJson);
    const method =
        retained === undefined
            ? sourcesDocumentaryMethod.packageId
            : retained !== null &&
                typeof retained === "object" &&
                "method" in retained &&
                typeof retained.method === "string"
              ? retained.method
              : null;
    const examinationJson = JSON.stringify(
        method ? { ...examination, method } : examination,
    );
    if (
        originalExaminationJson !== undefined &&
        originalExaminationJson !== examinationJson
    )
        return { kind: "refused", code: "version_conflict" };
    const outcome = simulation
        ? {
              result: {
                  status: "succeeded" as const,
                  output: simulatedDocumentaryControl(contributions),
              },
              providerCallId: undefined,
          }
        : await executePreparationModel<DocumentaryControlAttempt>(ctx, {
              preparation,
              executionDeadlineAt,
              operationRequestId: args.requestId,
              operationEpoch: args.epoch,
              scheduledRecovery,
              sourceId,
              operation: "source_documentary_control",
              inputHash,
              invocationInputJson: originalExaminationJson ?? examinationJson,
              validate: async () => {
                  await ctx.runQuery(
                      internal.sourcesMission.assertActive,
                      args,
                  );
              },
              execute: (route, dependencies) =>
                  examineDocumentaryContributions(
                      examination,
                      route,
                      dependencies,
                      method,
                  ),
          });
    if ("reasonCode" in outcome && outcome.pendingProviderCallId)
        return { kind: "waiting", reference: `operation:${args.requestId}` };
    if ("reasonCode" in outcome)
        return {
            kind: "unavailable",
            code:
                outcome.reasonCode === "invalid_output"
                    ? "documentary_control_unfinished"
                    : outcome.reasonCode,
            ...(outcome.reasonCode === "invalid_output" ||
            outcome.diagnosticReason
                ? {
                      validation: {
                          path: "documentaryControl",
                          expected: `A complete documentary examination matching the submitted contribution identities (${outcome.diagnosticReason ?? "invalid_output"}).`,
                      },
                  }
                : {}),
        };
    if (outcome.result.status !== "succeeded")
        return {
            kind: "unavailable",
            code: "documentary_control_unfinished",
        };
    const result = await ctx.runMutation(
        internal.sourcesMission.retainControl,
        {
            ...args,
            inputHash,
            contributions,
            control: outcome.result.output,
            providerCallId: outcome.providerCallId,
        },
    );
    return operationSuccess(documentarySubmissionResult, result, {
        progressKeys: [sha256Hex(`control:${inputHash}`)],
    });
}
