import type { NextFunction, Request, Response } from 'express'

import { env } from '../config/env.js'

function readInternalKey(request: Request): string | null {
  const headerKey = request.header('x-internal-automation-key')
  if (headerKey && headerKey.trim().length > 0) {
    return headerKey.trim()
  }

  const authHeader = request.header('authorization')
  if (!authHeader) {
    return null
  }

  const [scheme, token] = authHeader.split(' ')
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    return null
  }

  return token.trim()
}

export function requireInternalAutomationAuth(request: Request, response: Response, next: NextFunction) {
  if (!env.INTERNAL_AUTOMATION_KEY) {
    response.status(503).json({
      ok: false,
      error: 'Internal automation key is not configured',
    })
    return
  }

  const providedKey = readInternalKey(request)
  if (!providedKey || providedKey !== env.INTERNAL_AUTOMATION_KEY) {
    response.status(401).json({
      ok: false,
      error: 'Internal automation authentication required',
    })
    return
  }

  next()
}
