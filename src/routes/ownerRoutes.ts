import { Router } from 'express'

import {
  createOwnerProperty,
  createOwnerTenant,
  getOwnerNotificationList,
  getOwnerRentPaymentApprovals,
  getOwnerProperties,
  getOwnerSummary,
  getOwnerTelegramOnboarding,
  getOwnerTenantById,
  getOwnerTenants,
  getOwnerTicketList,
  markOwnerNotificationRead,
  patchOwnerProperty,
  patchOwnerRentPaymentApproval,
  patchOwnerTenant,
  patchOwnerTicket,
  postOwnerTelegramDisconnect,
  processReminders,
  removeOwnerProperty,
  removeOwnerTenant,
} from '../controllers/ownerController.js'
import { requireOwnerAuth } from '../middleware/ownerAuth.js'

export function createOwnerRouter() {
  const router = Router()

  router.use(requireOwnerAuth)

  router.post('/properties', createOwnerProperty)
  router.get('/properties', getOwnerProperties)
  router.patch('/properties/:id', patchOwnerProperty)
  router.delete('/properties/:id', removeOwnerProperty)

  router.post('/tenants', createOwnerTenant)
  router.get('/tenants', getOwnerTenants)
  router.get('/tenants/:id', getOwnerTenantById)
  router.patch('/tenants/:id', patchOwnerTenant)
  router.delete('/tenants/:id', removeOwnerTenant)

  router.get('/tickets', getOwnerTicketList)
  router.patch('/tickets/:id', patchOwnerTicket)

  router.get('/notifications', getOwnerNotificationList)
  router.patch('/notifications/:id/read', markOwnerNotificationRead)
  router.get('/telegram/onboarding', getOwnerTelegramOnboarding)
  router.post('/telegram/disconnect', postOwnerTelegramDisconnect)

  router.get('/dashboard-summary', getOwnerSummary)
  router.get('/rent-payment-approvals', getOwnerRentPaymentApprovals)
  router.patch('/rent-payment-approvals/:id', patchOwnerRentPaymentApproval)
  router.post('/process-reminders', processReminders)

  return router
}
