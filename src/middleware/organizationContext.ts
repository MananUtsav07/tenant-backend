import type { Request } from 'express'

import { AppError } from '../lib/errors.js'

export function requireOrganizationContext(request: Request): string {
  const organizationId = request.auth?.organizationId ?? request.owner?.organizationId ?? request.tenant?.organizationId ?? null
  if (!organizationId) {
    throw new AppError('Organization context is required for this route', 401)
  }

  return organizationId
}

export function assertOrganizationAccess(input: {
  expectedOrganizationId: string
  entityOrganizationId: string | null | undefined
  entityLabel: string
}) {
  if (!input.entityOrganizationId || input.entityOrganizationId !== input.expectedOrganizationId) {
    throw new AppError(`Cross-organization access denied for ${input.entityLabel}`, 403, {
      expected_organization_id: input.expectedOrganizationId,
      entity_organization_id: input.entityOrganizationId ?? null,
    })
  }
}
