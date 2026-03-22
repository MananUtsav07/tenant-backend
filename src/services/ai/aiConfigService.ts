import type { PostgrestError } from '@supabase/supabase-js'

import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors.js'
import { supabaseAdmin } from '../../lib/supabase.js'
import { isAiConfigured } from './aiClient.js'
import type { AdminAiStatusSummary, OrganizationAiSettings, OrganizationAiSettingsUpdate } from './aiTypes.js'

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

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
  const { data, error } = await supabaseAdmin
    .from('organization_ai_settings')
    .select('*')
    .eq('organization_id', organizationId)
    .maybeSingle()

  throwIfError(error, 'Failed to fetch organization AI settings')

  if (!data) {
    return defaultAiSettings(organizationId)
  }

  return data as OrganizationAiSettings
}

export async function updateOrganizationAiSettings(
  organizationId: string,
  patch: OrganizationAiSettingsUpdate,
): Promise<OrganizationAiSettings> {
  const { data, error } = await supabaseAdmin
    .from('organization_ai_settings')
    .upsert(
      {
        organization_id: organizationId,
        ...patch,
      },
      {
        onConflict: 'organization_id',
      },
    )
    .select('*')
    .single()

  throwIfError(error, 'Failed to update organization AI settings')
  return data as OrganizationAiSettings
}

export async function getAdminAiStatusSummary(): Promise<AdminAiStatusSummary> {
  const [
    automationEnabledCountResult,
    ticketClassificationEnabledCountResult,
    reminderGenerationEnabledCountResult,
    ticketSummarizationEnabledCountResult,
  ] = await Promise.all([
    supabaseAdmin.from('organization_ai_settings').select('id', { count: 'exact', head: true }).eq('automation_enabled', true),
    supabaseAdmin
      .from('organization_ai_settings')
      .select('id', { count: 'exact', head: true })
      .eq('ticket_classification_enabled', true),
    supabaseAdmin
      .from('organization_ai_settings')
      .select('id', { count: 'exact', head: true })
      .eq('reminder_generation_enabled', true),
    supabaseAdmin
      .from('organization_ai_settings')
      .select('id', { count: 'exact', head: true })
      .eq('ticket_summarization_enabled', true),
  ])

  throwIfError(automationEnabledCountResult.error, 'Failed to count AI-enabled organizations')
  throwIfError(ticketClassificationEnabledCountResult.error, 'Failed to count ticket-classification organizations')
  throwIfError(reminderGenerationEnabledCountResult.error, 'Failed to count reminder-generation organizations')
  throwIfError(ticketSummarizationEnabledCountResult.error, 'Failed to count ticket-summarization organizations')

  return {
    openai_configured: isAiConfigured(),
    organizations_with_ai_enabled: automationEnabledCountResult.count ?? 0,
    ticket_classification_enabled_count: ticketClassificationEnabledCountResult.count ?? 0,
    reminder_generation_enabled_count: reminderGenerationEnabledCountResult.count ?? 0,
    ticket_summarization_enabled_count: ticketSummarizationEnabledCountResult.count ?? 0,
  }
}
