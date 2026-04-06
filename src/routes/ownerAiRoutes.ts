import { Router } from 'express'

import {
  getOwnerAiSettings,
  putOwnerAiSettings,
  getOwnerIntegrations,
  postOwnerTicketClassify,
  postOwnerTicketSummarize,
} from '../controllers/ownerAiController.js'
import { getOwnerWhatsAppConnectUrl } from '../controllers/ownerController.js'
import { requireOwnerAuth } from '../middleware/ownerAuth.js'

export function createOwnerAiRouter() {
  const router = Router()

  router.use(requireOwnerAuth)
  router.get('/ai-settings', getOwnerAiSettings)
  router.put('/ai-settings', putOwnerAiSettings)
  router.get('/integrations', getOwnerIntegrations)
  router.post('/ai/classify', postOwnerTicketClassify)
  router.post('/ai/summarize', postOwnerTicketSummarize)
  router.get('/whatsapp/connect-url', getOwnerWhatsAppConnectUrl)

  return router
}

