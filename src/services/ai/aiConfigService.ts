import { env } from '../../config/env.js'
import { prisma } from '../../lib/db.js'
import { isAiConfigured } from './aiClient.js'
import type { AdminAiStatusSummary, OrganizationAiSettings, OrganizationAiSettingsUpdate } from './aiTypes.js'

function defaultAiSettings(organizationId: string): OrganizationAiSettings {
  const now = new Date().toISOString()
  return {
    id: 'default',
    organization_id: organizationId,
    automation_enabled: false,
    ticket_classification_enabled: false,
    reminder_generation_enabled: false,
    ticket_summarization_enabled: false,
    ai_model: env.OPENAI_MODEL,
    created_at: now,
    updated_at: now,
  }
}

export async function getOrganizationAiSettings(organizationId: string): Promise<OrganizationAiSettings> {
  const data = await prisma.organization_ai_settings.findFirst({
    where: { organization_id: organizationId },
  })
  if (!data) return defaultAiSettings(organizationId)
  return data as unknown as OrganizationAiSettings
}

export async function updateOrganizationAiSettings(
  organizationId: string,
  patch: OrganizationAiSettingsUpdate,
): Promise<OrganizationAiSettings> {
  const data = await prisma.organization_ai_settings.upsert({
    where: { organization_id: organizationId },
    create: { organization_id: organizationId, ...patch },
    update: { ...patch },
  })
  return data as unknown as OrganizationAiSettings
}

export async function getAdminAiStatusSummary(): Promise<AdminAiStatusSummary> {
  const [
    automationEnabledCount,
    ticketClassificationEnabledCount,
    reminderGenerationEnabledCount,
    ticketSummarizationEnabledCount,
  ] = await Promise.all([
    prisma.organization_ai_settings.count({ where: { automation_enabled: true } }),
    prisma.organization_ai_settings.count({ where: { ticket_classification_enabled: true } }),
    prisma.organization_ai_settings.count({ where: { reminder_generation_enabled: true } }),
    prisma.organization_ai_settings.count({ where: { ticket_summarization_enabled: true } }),
  ])

  return {
    openai_configured: isAiConfigured(),
    organizations_with_ai_enabled: automationEnabledCount,
    ticket_classification_enabled_count: ticketClassificationEnabledCount,
    reminder_generation_enabled_count: reminderGenerationEnabledCount,
    ticket_summarization_enabled_count: ticketSummarizationEnabledCount,
  }
}
