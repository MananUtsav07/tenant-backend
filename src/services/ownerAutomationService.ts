import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'

export type OwnerAutomationSettings = {
  id: string
  organization_id: string
  owner_id: string
  compliance_alerts_enabled: boolean
  rent_chasing_enabled: boolean
  portfolio_visibility_enabled: boolean
  cash_flow_reporting_enabled: boolean
  daily_digest_enabled: boolean
  weekly_digest_enabled: boolean
  monthly_digest_enabled: boolean
  status_command_enabled: boolean
  yield_alert_threshold_percent: number | null
  yield_alert_cooldown_days: number
  quiet_hours_start: string | null
  quiet_hours_end: string | null
  created_at: string
  updated_at: string
}

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

function defaultSettings(ownerId: string, organizationId: string): OwnerAutomationSettings {
  const now = new Date().toISOString()

  return {
    id: 'default',
    organization_id: organizationId,
    owner_id: ownerId,
    compliance_alerts_enabled: true,
    rent_chasing_enabled: true,
    portfolio_visibility_enabled: true,
    cash_flow_reporting_enabled: true,
    daily_digest_enabled: true,
    weekly_digest_enabled: false,
    monthly_digest_enabled: false,
    status_command_enabled: true,
    yield_alert_threshold_percent: null,
    yield_alert_cooldown_days: 7,
    quiet_hours_start: null,
    quiet_hours_end: null,
    created_at: now,
    updated_at: now,
  }
}

export async function getOwnerAutomationSettings(ownerId: string, organizationId: string): Promise<OwnerAutomationSettings> {
  const { data, error } = await supabaseAdmin
    .from('owner_automation_settings')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  throwIfError(error, 'Failed to load owner automation settings')

  if (!data) {
    return defaultSettings(ownerId, organizationId)
  }

  return data as OwnerAutomationSettings
}

export async function updateOwnerAutomationSettings(
  ownerId: string,
  organizationId: string,
  patch: Partial<
    Pick<
      OwnerAutomationSettings,
      | 'compliance_alerts_enabled'
      | 'rent_chasing_enabled'
      | 'portfolio_visibility_enabled'
      | 'cash_flow_reporting_enabled'
      | 'daily_digest_enabled'
      | 'weekly_digest_enabled'
      | 'monthly_digest_enabled'
      | 'status_command_enabled'
      | 'yield_alert_threshold_percent'
      | 'yield_alert_cooldown_days'
      | 'quiet_hours_start'
      | 'quiet_hours_end'
    >
  >,
): Promise<OwnerAutomationSettings> {
  const { data, error } = await supabaseAdmin
    .from('owner_automation_settings')
    .upsert(
      {
        owner_id: ownerId,
        organization_id: organizationId,
        ...patch,
      },
      {
        onConflict: 'organization_id,owner_id',
      },
    )
    .select('*')
    .single()

  throwIfError(error, 'Failed to update owner automation settings')
  return data as OwnerAutomationSettings
}

export async function listOwnerAutomationActivity(input: {
  ownerId: string
  organizationId: string
  page: number
  page_size: number
}) {
  const from = (input.page - 1) * input.page_size
  const to = from + input.page_size - 1

  const { data, error, count } = await supabaseAdmin
    .from('automation_runs')
    .select('id, job_id, organization_id, owner_id, flow_name, status, started_at, completed_at, processed_count, metadata', {
      count: 'exact',
    })
    .eq('organization_id', input.organizationId)
    .order('started_at', { ascending: false })
    .range(from, to)

  throwIfError(error, 'Failed to load automation activity')

  return {
    items: data ?? [],
    total: count ?? 0,
  }
}
