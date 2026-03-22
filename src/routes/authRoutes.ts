import { Router } from 'express'

import {
  loginOwner,
  loginTenant,
  ownerMe,
  postOwnerForgotPassword,
  postOwnerResetPassword,
  postTenantForgotPassword,
  postTenantResetPassword,
  registerOwner,
  tenantMe,
} from '../controllers/authController.js'
import { requireOwnerAuth } from '../middleware/ownerAuth.js'
import { requireTenantAuth } from '../middleware/tenantAuth.js'

export function createAuthRouter() {
  const router = Router()

  router.post('/owner/register', registerOwner)
  router.post('/owner/login', loginOwner)
  router.post('/owner/forgot-password', postOwnerForgotPassword)
  router.post('/owner/reset-password', postOwnerResetPassword)
  router.get('/owner/me', requireOwnerAuth, ownerMe)

  router.post('/tenant/login', loginTenant)
  router.post('/tenant/forgot-password', postTenantForgotPassword)
  router.post('/tenant/reset-password', postTenantResetPassword)
  router.get('/tenant/me', requireTenantAuth, tenantMe)

  return router
}
