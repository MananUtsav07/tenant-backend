import { Router } from 'express'

import { getPublicSnapshot, postPublicAnalyticsEvent, postPublicContactMessage } from '../controllers/publicController.js'

export function createPublicRouter() {
  const router = Router()

  router.get('/operations-snapshot', getPublicSnapshot)
  router.post('/contact', postPublicContactMessage)
  router.post('/analytics', postPublicAnalyticsEvent)

  return router
}
