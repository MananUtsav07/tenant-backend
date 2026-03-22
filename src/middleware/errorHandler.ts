import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'

import { AppError } from '../lib/errors.js'

export function notFoundHandler(_request: Request, response: Response) {
  response.status(404).json({
    ok: false,
    error: 'Route not found',
  })
}

export function errorHandler(error: unknown, _request: Request, response: Response, _next: NextFunction) {
  const requestId = _request.requestId ?? null

  if (error instanceof ZodError) {
    response.status(400).json({
      ok: false,
      error: 'Validation failed',
      issues: error.issues,
      requestId,
    })
    return
  }

  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      ok: false,
      error: error.message,
      details: error.details ?? null,
      requestId,
    })
    return
  }

  console.error('[unhandled-error]', { requestId, error })
  response.status(500).json({
    ok: false,
    error: 'Internal server error',
    requestId,
  })
}
