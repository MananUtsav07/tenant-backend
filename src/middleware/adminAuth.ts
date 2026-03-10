import type { NextFunction, Request, Response } from 'express'

import { verifyAdminToken } from '../lib/jwt.js'

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

export function requireAdminAuth(request: Request, response: Response, next: NextFunction) {
  const token = readBearerToken(request)
  if (!token) {
    response.status(401).json({ ok: false, error: 'Admin authentication required' })
    return
  }

  const payload = verifyAdminToken(token)
  if (!payload) {
    response.status(401).json({ ok: false, error: 'Invalid admin token' })
    return
  }

  request.admin = {
    adminId: payload.sub,
    email: payload.email,
  }
  request.auth = {
    userId: payload.sub,
    role: 'admin',
    organizationId: null,
  }
  request.authPayload = payload

  next()
}
