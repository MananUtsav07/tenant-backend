import type { Request, Response } from 'express'

import { asyncHandler } from '../lib/errors.js'
import { dispatchPendingAutomationJobs, ensureDailyAutomationJobs } from '../services/automationEngineService.js'
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
