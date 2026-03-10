import crypto from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

export function requestContext(request: Request, _response: Response, next: NextFunction) {
  request.requestId = crypto.randomUUID()
  next()
}