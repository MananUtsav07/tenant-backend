import { prisma } from '../lib/db.js'

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
  const data = await prisma.owner_automation_settings.findFirst({
    where: { owner_id: ownerId, organization_id: organizationId },
  })
  if (!data) return defaultSettings(ownerId, organizationId)
  return data as unknown as OwnerAutomationSettings
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
  const data = await prisma.owner_automation_settings.upsert({
    where: { organization_id_owner_id: { organization_id: organizationId, owner_id: ownerId } },
    create: { owner_id: ownerId, organization_id: organizationId, ...patch },
    update: { ...patch },
  })
  return data as unknown as OwnerAutomationSettings
}

export async function listOwnerAutomationActivity(input: {
  ownerId: string
  organizationId: string
  page: number
  page_size: number
}) {
  const skip = (input.page - 1) * input.page_size

  const [items, total] = await prisma.$transaction([
    prisma.automation_runs.findMany({
      select: { id: true, job_id: true, organization_id: true, owner_id: true, flow_name: true, status: true, started_at: true, completed_at: true, processed_count: true, metadata: true },
      where: { organization_id: input.organizationId },
      orderBy: { started_at: 'desc' },
      skip,
      take: input.page_size,
    }),
    prisma.automation_runs.count({ where: { organization_id: input.organizationId } }),
  ])

  return { items, total }
}
