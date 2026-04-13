import { Router } from 'express'
import { requireOwnerAuth } from '../middleware/ownerAuth.js'
import {
  getBillingStateController,
  initiateSubscriptionController,
  confirmSubscriptionController,
  razorpayWebhookController,
} from '../controllers/billingController.js'

export function createBillingRouter() {
  const router = Router()

  // Protected owner billing routes
  router.get('/state', requireOwnerAuth, getBillingStateController)
  router.post('/initiate', requireOwnerAuth, initiateSubscriptionController)
  router.post('/confirm', requireOwnerAuth, confirmSubscriptionController)

  return router
}

export function createWebhookRouter() {
  const router = Router()
  // Public — Razorpay calls this directly, no auth
  router.post('/razorpay', razorpayWebhookController)
  return router
}
