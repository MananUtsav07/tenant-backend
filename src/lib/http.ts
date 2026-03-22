import type { Response } from 'express'
import type { ZodError } from 'zod'

export function respondValidationError(error: ZodError, response: Response) {
  return response.status(400).json({
    ok: false,
    error: 'Validation failed',
    issues: error.issues,
  })
}
