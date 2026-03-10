import { Router } from 'express'

import { loginOwner, loginTenant, ownerMe, registerOwner, tenantMe } from '../controllers/authController.js'
import { requireOwnerAuth } from '../middleware/ownerAuth.js'
import { requireTenantAuth } from '../middleware/tenantAuth.js'

export function createAuthRouter() {
  const router = Router()

  router.post('/owner/register', registerOwner)
  router.post('/owner/login', loginOwner)
  router.get('/owner/me', requireOwnerAuth, ownerMe)

  router.post('/tenant/login', loginTenant)
  router.get('/tenant/me', requireTenantAuth, tenantMe)

  return router
}