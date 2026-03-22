import type { Request, Response } from 'express'

import { asyncHandler } from '../lib/errors.js'
import { dispatchPendingAutomationJobs, ensureDailyAutomationJobs, getAutomationHealth } from '../services/automationEngineService.js'
import { listAutomationRegistryEntries } from '../services/automation/core/registry.js'
import { internalAutomationDispatchSchema, internalAutomationTickSchema } from '../validations/automationSchemas.js'

export const postAutomationTick = asyncHandler(async (request: Request, response: Response) => {
  const parsed = internalAutomationTickSchema.parse(request.body ?? {})
  const now = parsed.now ? new Date(parsed.now) : new Date()

  const enqueueResult = await ensureDailyAutomationJobs(now)

  if (parsed.enqueue_only) {
    response.json({
      ok: true,
      enqueue: enqueueResult,
      dispatched: null,
    })
    return
  }

  const dispatchResult = await dispatchPendingAutomationJobs({
    limit: parsed.dispatch_limit,
    now,
  })

  response.json({
    ok: true,
    enqueue: enqueueResult,
    dispatched: dispatchResult,
  })
})

export const postAutomationDispatch = asyncHandler(async (request: Request, response: Response) => {
  const parsed = internalAutomationDispatchSchema.parse(request.body ?? {})
  const now = parsed.now ? new Date(parsed.now) : new Date()

  const result = await dispatchPendingAutomationJobs({
    limit: parsed.limit,
    now,
  })

  response.json({
    ok: true,
    result,
  })
})

export const getAutomationInternalHealth = asyncHandler(async (_request: Request, response: Response) => {
  const [health] = await Promise.all([getAutomationHealth()])

  response.json({
    ok: true,
    health,
    registry: listAutomationRegistryEntries(),
  })
})
