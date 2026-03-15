import { Router } from 'express'

import { getPublicSnapshot, postPublicAnalyticsEvent, postPublicContactMessage } from '../controllers/publicController.js'
import { postTelegramWebhook } from '../controllers/telegramController.js'
import { getWhatsAppWebhook, postWhatsAppWebhook } from '../controllers/whatsappController.js'

export function createPublicRouter() {
  const router = Router()

  router.get('/operations-snapshot', getPublicSnapshot)
  router.post('/contact', postPublicContactMessage)
  router.post('/analytics', postPublicAnalyticsEvent)
  router.post('/telegram/webhook', postTelegramWebhook)
  router.get('/whatsapp/webhook', getWhatsAppWebhook)
  router.post('/whatsapp/webhook', postWhatsAppWebhook)

  return router
}
