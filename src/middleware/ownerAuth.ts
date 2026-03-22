import type { NextFunction, Request, Response } from 'express'

import { verifyOwnerToken } from '../lib/jwt.js'

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

export function requireOwnerAuth(request: Request, response: Response, next: NextFunction) {
  const token = readBearerToken(request)
  if (!token) {
    response.status(401).json({ ok: false, error: 'Owner authentication required' })
    return
  }

  const payload = verifyOwnerToken(token)
  if (!payload) {
    response.status(401).json({ ok: false, error: 'Invalid owner token' })
    return
  }

  request.owner = {
    ownerId: payload.sub,
    email: payload.email,
    organizationId: payload.organization_id,
  }
  request.auth = {
    userId: payload.sub,
    role: 'owner',
    organizationId: payload.organization_id,
  }
  request.authPayload = payload

  next()
}
