import { convexTest } from "convex-test"
import { makeFunctionReference } from "convex/server"
import { expect, test } from "vitest"

import schema from "../../convex/schema"

const modules = import.meta.glob("../../convex/**/*.ts")

const createDraft = makeFunctionReference<"mutation", Record<string, never>, string>(
  "researchRuns:createDraft",
)
const transition = makeFunctionReference<
  "mutation",
  {
    runId: string
    lifecycleState: "discovering_sources" | "awaiting_source_review"
    executionStatus: "running" | "paused"
    stepKey: "resolve_company" | "source_review"
  },
  null
>("researchRuns:transition")
const getRun = makeFunctionReference<"query", { runId: string }, unknown>("researchRuns:get")
const listRunEvents = makeFunctionReference<"query", { runId: string }, Array<unknown>>(
  "researchRuns:listEvents",
)
const listSteps = makeFunctionReference<"query", { runId: string }, Array<unknown>>(
  "researchRuns:listSteps",
)
const appendAuditEvent = makeFunctionReference<
  "mutation",
  {
    action: "invitation_seeded" | "quota_restored"
    targetType: string
    targetId: string
    reason?: string
  },
  string
>("audit:appendSystemEvent")
const listAuditEvents = makeFunctionReference<
  "query",
  { targetType: string; targetId: string },
  Array<unknown>
>("audit:listByTarget")

test("a draft research run advances through the server transition boundary", async () => {
  const t = convexTest(schema, modules)
  const runId = await t.mutation(createDraft, {})

  await t.mutation(transition, {
    runId,
    lifecycleState: "discovering_sources",
    executionStatus: "running",
    stepKey: "resolve_company",
  })

  await expect(t.query(getRun, { runId })).resolves.toMatchObject({
    lifecycleState: "discovering_sources",
    executionStatus: "running",
  })
  await expect(t.query(listRunEvents, { runId })).resolves.toMatchObject([
    { sequence: 1, type: "run_created", lifecycleState: "draft" },
    {
      sequence: 2,
      type: "run_transitioned",
      lifecycleState: "discovering_sources",
      executionStatus: "running",
    },
  ])
})

test("a research run can pause at the source-review checkpoint", async () => {
  const t = convexTest(schema, modules)
  const runId = await t.mutation(createDraft, {})
  await t.mutation(transition, {
    runId,
    lifecycleState: "discovering_sources",
    executionStatus: "running",
    stepKey: "resolve_company",
  })

  await t.mutation(transition, {
    runId,
    lifecycleState: "awaiting_source_review",
    executionStatus: "paused",
    stepKey: "source_review",
  })

  await expect(t.query(getRun, { runId })).resolves.toMatchObject({
    lifecycleState: "awaiting_source_review",
    executionStatus: "paused",
    pauseReason: "source_review",
  })
  await expect(t.query(listSteps, { runId })).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ key: "resolve_company", state: "completed" }),
      expect.objectContaining({ key: "source_review", state: "needs_review" }),
    ]),
  )
})

test("an invalid lifecycle transition is rejected without appending progress", async () => {
  const t = convexTest(schema, modules)
  const runId = await t.mutation(createDraft, {})

  await expect(
    t.mutation(transition, {
      runId,
      lifecycleState: "awaiting_source_review",
      executionStatus: "paused",
      stepKey: "source_review",
    }),
  ).rejects.toThrow("Invalid research run transition")
  await expect(t.query(listRunEvents, { runId })).resolves.toHaveLength(1)
})

test("audit history preserves every administrative event", async () => {
  const t = convexTest(schema, modules)

  await t.mutation(appendAuditEvent, {
    action: "invitation_seeded",
    targetType: "invitation_set",
    targetId: "prototype",
  })
  await t.mutation(appendAuditEvent, {
    action: "quota_restored",
    targetType: "research_run",
    targetId: "run-1",
    reason: "Provider outage before paid work started",
  })

  await expect(
    t.query(listAuditEvents, { targetType: "research_run", targetId: "run-1" }),
  ).resolves.toMatchObject([
    {
      action: "quota_restored",
      reason: "Provider outage before paid work started",
    },
  ])
})
