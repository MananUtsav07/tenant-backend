import { Router } from 'express'

import { getAutomationInternalHealth, postAutomationDispatch, postAutomationTick } from '../controllers/internalController.js'
import { requireInternalAutomationAuth } from '../middleware/internalAuth.js'

export function createInternalRouter() {
  const router = Router()

  router.use(requireInternalAutomationAuth)

  router.get('/automation/health', getAutomationInternalHealth)
  router.get('/automation/tick', postAutomationTick)
  router.post('/automation/tick', postAutomationTick)
  router.post('/automation/dispatch', postAutomationDispatch)

  return router
}
