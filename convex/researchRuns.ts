import { getAuthUserId } from "@convex-dev/auth/server"
import { v } from "convex/values"

import { internalMutation, internalQuery, mutation, query } from "./_generated/server"
import { assertLifecycleTransition } from "./domain/transitions"
import {
  executionStatusValidator,
  researchRunLifecycleValidator,
  workflowStepKeyValidator,
} from "./domain/validators"

const MAX_ANALYSES_PER_VISITOR = 3

export const reserve = mutation({
  args: { idempotencyKey: v.string() },
  returns: v.object({ runId: v.id("researchRuns"), remainingAnalyses: v.number() }),
  handler: async (ctx, args) => {
    const idempotencyKey = args.idempotencyKey.trim()
    if (idempotencyKey.length === 0 || idempotencyKey.length > 128) {
      throw new Error("Invalid idempotency key")
    }
    const authUserId = await getAuthUserId(ctx)
    if (!authUserId) {
      throw new Error("Not authenticated")
    }
    const visitor = await ctx.db
      .query("visitors")
      .withIndex("by_auth_user_id", (query) => query.eq("authUserId", authUserId))
      .unique()
    if (visitor?.status !== "active") {
      throw new Error("Unauthorized")
    }

    const existing = await ctx.db
      .query("researchRuns")
      .withIndex("by_owner_and_reservation_key", (query) =>
        query.eq("ownerVisitorId", visitor._id).eq("reservationKey", idempotencyKey),
      )
      .unique()
    if (existing) {
      return {
        runId: existing._id,
        remainingAnalyses: MAX_ANALYSES_PER_VISITOR - visitor.analysesReserved,
      }
    }
    if (visitor.analysesReserved >= MAX_ANALYSES_PER_VISITOR) {
      throw new Error("Analysis limit reached")
    }

    const now = Date.now()
    const runId = await ctx.db.insert("researchRuns", {
      ownerVisitorId: visitor._id,
      reservationKey: idempotencyKey,
      reservationStatus: "consumed",
      retryCount: 0,
      lifecycleState: "draft",
      executionStatus: "idle",
      nextEventSequence: 1,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.patch(visitor._id, { analysesReserved: visitor.analysesReserved + 1 })
    await ctx.db.insert("runEvents", {
      runId,
      sequence: 1,
      type: "run_created",
      lifecycleState: "draft",
      executionStatus: "idle",
      occurredAt: now,
    })
    await ctx.db.insert("auditEvents", {
      actor: { type: "visitor", visitorId: visitor._id },
      action: "analysis_reserved",
      targetType: "research_run",
      targetId: runId,
      occurredAt: now,
    })
    return {
      runId,
      remainingAnalyses: MAX_ANALYSES_PER_VISITOR - (visitor.analysesReserved + 1),
    }
  },
})

export const createDraft = internalMutation({
  args: {},
  returns: v.id("researchRuns"),
  handler: async (ctx) => {
    const now = Date.now()
    const runId = await ctx.db.insert("researchRuns", {
      lifecycleState: "draft",
      executionStatus: "idle",
      nextEventSequence: 1,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert("runEvents", {
      runId,
      sequence: 1,
      type: "run_created",
      lifecycleState: "draft",
      executionStatus: "idle",
      occurredAt: now,
    })
    return runId
  },
})

export const transition = internalMutation({
  args: {
    runId: v.id("researchRuns"),
    lifecycleState: researchRunLifecycleValidator,
    executionStatus: executionStatusValidator,
    stepKey: workflowStepKeyValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run) {
      throw new Error("Research run not found")
    }
    assertLifecycleTransition(run.lifecycleState, args.lifecycleState, args.executionStatus)

    const now = Date.now()
    const pauseReason =
      args.lifecycleState === "awaiting_source_review"
        ? ("source_review" as const)
        : args.lifecycleState === "awaiting_assessment_review"
          ? ("assessment_review" as const)
          : undefined
    await ctx.db.patch(args.runId, {
      lifecycleState: args.lifecycleState,
      executionStatus: args.executionStatus,
      pauseReason,
      nextEventSequence: run.nextEventSequence + 1,
      updatedAt: now,
    })
    const previousSteps = await ctx.db
      .query("workflowSteps")
      .withIndex("by_run_and_key", (query) => query.eq("runId", args.runId))
      .collect()
    for (const step of previousSteps) {
      if (step.state === "running") {
        await ctx.db.patch(step._id, { state: "completed", completedAt: now, updatedAt: now })
      }
    }
    await ctx.db.insert("workflowSteps", {
      runId: args.runId,
      key: args.stepKey,
      state:
        args.executionStatus === "paused"
          ? "needs_review"
          : args.executionStatus === "completed"
            ? "completed"
            : "running",
      attempt: 1,
      startedAt: now,
      completedAt: args.executionStatus === "completed" ? now : undefined,
      updatedAt: now,
    })
    await ctx.db.insert("runEvents", {
      runId: args.runId,
      sequence: run.nextEventSequence + 1,
      type: "run_transitioned",
      lifecycleState: args.lifecycleState,
      executionStatus: args.executionStatus,
      stepKey: args.stepKey,
      occurredAt: now,
    })
    return null
  },
})

export const get = internalQuery({
  args: { runId: v.id("researchRuns") },
  handler: async (ctx, args) => ctx.db.get(args.runId),
})

export const listEvents = internalQuery({
  args: { runId: v.id("researchRuns") },
  handler: async (ctx, args) =>
    ctx.db
      .query("runEvents")
      .withIndex("by_run_and_sequence", (query) => query.eq("runId", args.runId))
      .collect(),
})

export const listSteps = internalQuery({
  args: { runId: v.id("researchRuns") },
  handler: async (ctx, args) =>
    ctx.db
      .query("workflowSteps")
      .withIndex("by_run_and_key", (builder) => builder.eq("runId", args.runId))
      .collect(),
})

export const listMyEvents = query({
  args: { runId: v.id("researchRuns") },
  handler: async (ctx, args) => {
    const authUserId = await getAuthUserId(ctx)
    if (!authUserId) {
      throw new Error("Not authenticated")
    }
    const visitor = await ctx.db
      .query("visitors")
      .withIndex("by_auth_user_id", (builder) => builder.eq("authUserId", authUserId))
      .unique()
    const run = await ctx.db.get(args.runId)
    if (visitor?.status !== "active" || run?.ownerVisitorId !== visitor._id) {
      throw new Error("Unauthorized")
    }
    return ctx.db
      .query("runEvents")
      .withIndex("by_run_and_sequence", (builder) => builder.eq("runId", run._id))
      .collect()
  },
})
