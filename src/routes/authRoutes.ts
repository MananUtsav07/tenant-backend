import { Router } from 'express'

import {
  deleteOwnerMe,
  loginOwner,
  loginTenant,
  ownerMe,
  patchOwnerMe,
  postOwnerForgotPassword,
  postOwnerResetPassword,
  postTenantForgotPassword,
  postTenantResetPassword,
  registerOwner,
  resendOwnerEmailVerification,
  tenantMe,
  verifyOwnerEmail,
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
  router.patch('/owner/me', requireOwnerAuth, patchOwnerMe)
  router.delete('/owner/me', requireOwnerAuth, deleteOwnerMe)
  router.get('/owner/verify-email', verifyOwnerEmail)
  router.post('/owner/resend-verification', requireOwnerAuth, resendOwnerEmailVerification)

  router.post('/tenant/login', loginTenant)
  router.post('/tenant/forgot-password', postTenantForgotPassword)
  router.post('/tenant/reset-password', postTenantResetPassword)
  router.get('/tenant/me', requireTenantAuth, tenantMe)

  return router
}
