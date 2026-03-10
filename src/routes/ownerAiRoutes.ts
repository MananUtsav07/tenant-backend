import { Router } from 'express'

import { getOwnerAiSettings, putOwnerAiSettings } from '../controllers/ownerAiController.js'
import { requireOwnerAuth } from '../middleware/ownerAuth.js'

export function createOwnerAiRouter() {
  const router = Router()

  router.use(requireOwnerAuth)
  router.get('/ai-settings', getOwnerAiSettings)
  router.put('/ai-settings', putOwnerAiSettings)

  return router
}

