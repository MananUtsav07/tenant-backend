import type { Request, Response } from 'express'

import { AppError, asyncHandler } from '../lib/errors.js'
import { createAuditLog } from '../services/auditLogService.js'
import { getOrganizationAiSettings, updateOrganizationAiSettings } from '../services/ai/aiConfigService.js'
import { isAiConfigured } from '../services/ai/aiClient.js'
import { updateOrganizationAiSettingsSchema } from '../validations/aiSchemas.js'

function requireOwnerContext(request: Request): { ownerId: string; organizationId: string } {
  const ownerId = request.owner?.ownerId
  const organizationId = request.owner?.organizationId ?? request.auth?.organizationId ?? null
  if (!ownerId || !organizationId) {
    throw new AppError('Owner authentication required', 401)
  }

  return { ownerId, organizationId }
}

export const getOwnerAiSettings = asyncHandler(async (request: Request, response: Response) => {
  const { organizationId } = requireOwnerContext(request)
  const settings = await getOrganizationAiSettings(organizationId)

  response.json({
    ok: true,
    ai_configured: isAiConfigured(),
    settings,
  })
})

export const putOwnerAiSettings = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const patch = updateOrganizationAiSettingsSchema.parse(request.body)

  const settings = await updateOrganizationAiSettings(organizationId, patch)
  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'organization.ai_settings_updated',
    entity_type: 'organization_ai_settings',
    entity_id: settings.id,
    metadata: patch,
  })

  response.json({
    ok: true,
    ai_configured: isAiConfigured(),
    settings,
  })
})

