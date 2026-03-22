import type { NextFunction, Request, Response } from 'express'

import { verifyTenantToken } from '../lib/jwt.js'

function readBearerToken(request: Request): string | null {
  const authHeader = request.header('authorization')
  if (!authHeader) {
    return null
  }

  const [scheme, token] = authHeader.split(' ')
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    return null
  }

  return token
}

export function requireTenantAuth(request: Request, response: Response, next: NextFunction) {
  const token = readBearerToken(request)
  if (!token) {
    response.status(401).json({ ok: false, error: 'Tenant authentication required' })
    return
  }

  const payload = verifyTenantToken(token)
  if (!payload) {
    response.status(401).json({ ok: false, error: 'Invalid tenant token' })
    return
  }

  request.tenant = {
    tenantId: payload.sub,
    ownerId: payload.owner_id,
    tenantAccessId: payload.tenant_access_id,
    organizationId: payload.organization_id,
  }
  request.auth = {
    userId: payload.sub,
    role: 'tenant',
    organizationId: payload.organization_id,
  }
  request.authPayload = payload

  next()
}
