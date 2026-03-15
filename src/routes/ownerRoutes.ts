import { Router } from 'express'

import {
  createOwnerProperty,
  createOwnerTenant,
  getOwnerNotificationList,
  getOwnerNotificationPreferencesController,
  getOwnerAutomationActivityController,
  getOwnerAutomationSettingsController,
  getOwnerRentPaymentApprovals,
  getOwnerProperties,
  getOwnerSummary,
  getOwnerTelegramDeliveryLogsController,
  getOwnerTelegramOnboarding,
  getOwnerTenantById,
  getOwnerTicketById,
  getOwnerTenants,
  getOwnerTicketList,
  markAllOwnerNotificationsRead,
  markOwnerNotificationRead,
  patchOwnerProperty,
  patchOwnerRentPaymentApproval,
  patchOwnerTenant,
  patchOwnerTicket,
  postOwnerTicketReply,
  postOwnerTelegramDisconnect,
  putOwnerNotificationPreferencesController,
  processReminders,
  putOwnerAutomationSettingsController,
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
  router.get('/tickets/:id', getOwnerTicketById)
  router.post('/tickets/:id/replies', postOwnerTicketReply)
  router.patch('/tickets/:id', patchOwnerTicket)

  router.get('/notifications', getOwnerNotificationList)
  router.get('/notifications/preferences', getOwnerNotificationPreferencesController)
  router.put('/notifications/preferences', putOwnerNotificationPreferencesController)
  router.patch('/notifications/read-all', markAllOwnerNotificationsRead)
  router.patch('/notifications/:id/read', markOwnerNotificationRead)
  router.get('/telegram/onboarding', getOwnerTelegramOnboarding)
  router.post('/telegram/disconnect', postOwnerTelegramDisconnect)
  router.get('/telegram/delivery-logs', getOwnerTelegramDeliveryLogsController)

  router.get('/dashboard-summary', getOwnerSummary)
  router.get('/rent-payment-approvals', getOwnerRentPaymentApprovals)
  router.patch('/rent-payment-approvals/:id', patchOwnerRentPaymentApproval)
  router.post('/process-reminders', processReminders)
  router.get('/automation/settings', getOwnerAutomationSettingsController)
  router.put('/automation/settings', putOwnerAutomationSettingsController)
  router.get('/automation/activity', getOwnerAutomationActivityController)

  return router
}
