import { Router } from 'express'

import {
  getOwnerAiSettings,
  putOwnerAiSettings,
  getOwnerIntegrations,
  postOwnerTicketClassify,
  postOwnerTicketSummarize,
  postOwnerDraftTicketReply,
  postOwnerDraftBroadcast,
  postOwnerDraftWhatsapp,
  postOwnerLeaseDigest,
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
  router.post('/ai/draft-reply', postOwnerDraftTicketReply)
  router.post('/ai/draft-broadcast', postOwnerDraftBroadcast)
  router.post('/ai/draft-whatsapp', postOwnerDraftWhatsapp)
  router.post('/ai/lease-digest', postOwnerLeaseDigest)
  router.get('/whatsapp/connect-url', getOwnerWhatsAppConnectUrl)

  return router
}

