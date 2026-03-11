import { Router } from 'express'

import {
  getTenantDashboardSummary,
  getTenantOwnerContact,
  getTenantProperty,
  getTenantRentPaymentState,
  getTenantTickets,
  postTenantRentPaymentMarkPaid,
  postTenantTicket,
} from '../controllers/tenantController.js'
import { requireTenantAuth } from '../middleware/tenantAuth.js'

export function createTenantRouter() {
  const router = Router()

  router.use(requireTenantAuth)

  router.get('/dashboard-summary', getTenantDashboardSummary)
  router.get('/property', getTenantProperty)
  router.get('/tickets', getTenantTickets)
  router.post('/tickets', postTenantTicket)
  router.get('/rent-payment-state', getTenantRentPaymentState)
  router.post('/rent-payment-mark-paid', postTenantRentPaymentMarkPaid)
  router.get('/owner-contact', getTenantOwnerContact)

  return router
}
