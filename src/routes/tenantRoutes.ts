import { Router } from 'express'

import {
  getTenantConditionReportDetailController,
  getTenantConditionReportsController,
  getTenantDashboardSummary,
  getTenantLeaseRenewalIntentStateController,
  getTenantOwnerContact,
  getTenantProperty,
  getTenantRentPaymentState,
  getTenantTelegramOnboarding,
  getTenantTicketById,
  getTenantTicketMaintenanceWorkflow,
  getTenantTickets,
  postTenantConditionReportConfirmController,
  postTenantConditionReportMediaController,
  postTenantLeaseRenewalIntentController,
  postTenantMaintenanceCompletion,
  postTenantRentPaymentMarkPaid,
  postTenantTicketReply,
  postTenantTelegramDisconnect,
  postTenantTicket,
} from '../controllers/tenantController.js'
import { requireTenantAuth } from '../middleware/tenantAuth.js'

export function createTenantRouter() {
  const router = Router()

  router.use(requireTenantAuth)

  router.get('/dashboard-summary', getTenantDashboardSummary)
  router.get('/lease-renewal-intent-state', getTenantLeaseRenewalIntentStateController)
  router.post('/lease-renewal-intent', postTenantLeaseRenewalIntentController)
  router.get('/property', getTenantProperty)
  router.get('/condition-reports', getTenantConditionReportsController)
  router.get('/condition-reports/:reportId', getTenantConditionReportDetailController)
  router.post('/condition-reports/:reportId/media', postTenantConditionReportMediaController)
  router.post('/condition-reports/:reportId/confirm', postTenantConditionReportConfirmController)
  router.get('/tickets', getTenantTickets)
  router.post('/tickets', postTenantTicket)
  router.get('/tickets/:id', getTenantTicketById)
  router.post('/tickets/:id/replies', postTenantTicketReply)
  router.get('/tickets/:id/maintenance-workflow', getTenantTicketMaintenanceWorkflow)
  router.post('/tickets/:id/maintenance-workflow/completion', postTenantMaintenanceCompletion)
  router.get('/rent-payment-state', getTenantRentPaymentState)
  router.post('/rent-payment-mark-paid', postTenantRentPaymentMarkPaid)
  router.get('/owner-contact', getTenantOwnerContact)
  router.get('/telegram/onboarding', getTenantTelegramOnboarding)
  router.post('/telegram/disconnect', postTenantTelegramDisconnect)

  return router
}
