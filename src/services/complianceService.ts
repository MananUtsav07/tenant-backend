import type { PostgrestError } from '@supabase/supabase-js'

import { sendOwnerComplianceAlertNotification } from '../lib/mailer.js'
import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { createOwnerNotification } from './ownerService.js'

type ComplianceThreshold = 120 | 90 | 60 | 30

const thresholds: ComplianceThreshold[] = [120, 90, 60, 30]

type ComplianceRow = {
  id: string
  organization_id: string
  owner_id: string
  ejari_expiry: string | null
  contract_end: string | null
  alert_120_sent_at: string | null
  alert_90_sent_at: string | null
  alert_60_sent_at: string | null
  alert_30_sent_at: string | null
  owners?:
    | {
        email: string
        full_name: string | null
        company_name: string | null
        support_email: string | null
      }
    | null
  properties?:
    | {
        property_name: string | null
        unit_number: string | null
      }
    | null
  tenants?:
    | {
        full_name: string | null
        tenant_access_id: string | null
      }
    | null
}

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) {
    return null
  }

  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

function daysUntil(target: Date, now: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000
  return Math.ceil((startOfUtcDay(target).getTime() - startOfUtcDay(now).getTime()) / msPerDay)
}

function thresholdColumn(threshold: ComplianceThreshold): 'alert_120_sent_at' | 'alert_90_sent_at' | 'alert_60_sent_at' | 'alert_30_sent_at' {
  if (threshold === 120) {
    return 'alert_120_sent_at'
  }
  if (threshold === 90) {
    return 'alert_90_sent_at'
  }
  if (threshold === 60) {
    return 'alert_60_sent_at'
  }
  return 'alert_30_sent_at'
}

function readAlertValue(row: ComplianceRow, threshold: ComplianceThreshold): string | null {
  if (threshold === 120) {
    return row.alert_120_sent_at
  }
  if (threshold === 90) {
    return row.alert_90_sent_at
  }
  if (threshold === 60) {
    return row.alert_60_sent_at
  }
  return row.alert_30_sent_at
}

function resolveThresholdToSend(row: ComplianceRow, now: Date): { threshold: ComplianceThreshold; daysRemaining: number } | null {
  const dateCandidates = [parseDateOnly(row.ejari_expiry), parseDateOnly(row.contract_end)].filter(
    (value): value is Date => Boolean(value),
  )

  if (dateCandidates.length === 0) {
    return null
  }

  const futureDays = dateCandidates.map((value) => daysUntil(value, now)).filter((value) => value >= 0)
  if (futureDays.length === 0) {
    return null
  }

  const nearestDays = Math.min(...futureDays)
  const eligibleThresholds = thresholds.filter((threshold) => nearestDays <= threshold && !readAlertValue(row, threshold))
  if (eligibleThresholds.length === 0) {
    return null
  }

  return {
    threshold: Math.min(...eligibleThresholds) as ComplianceThreshold,
    daysRemaining: nearestDays,
  }
}

function ownerDisplayName(owner: ComplianceRow['owners']): string {
  if (!owner) {
    return 'Owner'
  }

  return owner.full_name || owner.company_name || owner.email
}

function uniqueRecipientEmails(owner: ComplianceRow['owners']): string[] {
  if (!owner) {
    return []
  }

  return [owner.email, owner.support_email]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .filter((value, index, list) => list.indexOf(value) === index)
}

function formatDateLabel(value: string | null): string {
  const parsed = parseDateOnly(value)
  if (!parsed) {
    return 'Not set'
  }

  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(parsed)
}

async function ownerComplianceSettingsMap(ownerIds: string[]) {
  if (ownerIds.length === 0) {
    return new Map<string, boolean>()
  }

  const { data, error } = await supabaseAdmin
    .from('owner_automation_settings')
    .select('owner_id, compliance_alerts_enabled')
    .in('owner_id', ownerIds)

  throwIfError(error, 'Failed to load owner automation settings')

  const map = new Map<string, boolean>()
  for (const row of data ?? []) {
    map.set(row.owner_id as string, Boolean(row.compliance_alerts_enabled))
  }

  return map
}

export async function runComplianceAlerts(now = new Date()) {
  const { data, error } = await supabaseAdmin
    .from('legal_dates')
    .select(
      'id, organization_id, owner_id, ejari_expiry, contract_end, alert_120_sent_at, alert_90_sent_at, alert_60_sent_at, alert_30_sent_at, owners(email, full_name, company_name, support_email), properties(property_name, unit_number), tenants(full_name, tenant_access_id)',
    )

  throwIfError(error, 'Failed to load legal compliance records')

  const rows: ComplianceRow[] = (data ?? []).map((row) => {
    const normalized = row as Record<string, unknown>

    const ownersValue = normalized.owners
    const propertiesValue = normalized.properties
    const tenantsValue = normalized.tenants

    const owner = Array.isArray(ownersValue)
      ? ((ownersValue[0] as ComplianceRow['owners']) ?? null)
      : ((ownersValue as ComplianceRow['owners']) ?? null)
    const property = Array.isArray(propertiesValue)
      ? ((propertiesValue[0] as ComplianceRow['properties']) ?? null)
      : ((propertiesValue as ComplianceRow['properties']) ?? null)
    const tenant = Array.isArray(tenantsValue)
      ? ((tenantsValue[0] as ComplianceRow['tenants']) ?? null)
      : ((tenantsValue as ComplianceRow['tenants']) ?? null)

    return {
      id: String(normalized.id),
      organization_id: String(normalized.organization_id),
      owner_id: String(normalized.owner_id),
      ejari_expiry: (normalized.ejari_expiry as string | null | undefined) ?? null,
      contract_end: (normalized.contract_end as string | null | undefined) ?? null,
      alert_120_sent_at: (normalized.alert_120_sent_at as string | null | undefined) ?? null,
      alert_90_sent_at: (normalized.alert_90_sent_at as string | null | undefined) ?? null,
      alert_60_sent_at: (normalized.alert_60_sent_at as string | null | undefined) ?? null,
      alert_30_sent_at: (normalized.alert_30_sent_at as string | null | undefined) ?? null,
      owners: owner,
      properties: property,
      tenants: tenant,
    }
  })
  const settingsMap = await ownerComplianceSettingsMap(Array.from(new Set(rows.map((row) => row.owner_id))))

  let alertsSent = 0
  let skippedDisabled = 0

  for (const row of rows) {
    const complianceEnabled = settingsMap.get(row.owner_id) ?? true
    if (!complianceEnabled) {
      skippedDisabled += 1
      continue
    }

    const thresholdResult = resolveThresholdToSend(row, now)
    if (!thresholdResult) {
      continue
    }

    const { threshold, daysRemaining } = thresholdResult
    const alertColumn = thresholdColumn(threshold)

    await createOwnerNotification({
      organization_id: row.organization_id,
      owner_id: row.owner_id,
      notification_type: `legal_compliance_${threshold}_days`,
      title: `Compliance action in ${daysRemaining} days`,
      message: `Ejari/contract milestone is within ${threshold} days for ${row.properties?.property_name ?? 'your property'}.`,
    })

    const recipients = uniqueRecipientEmails(row.owners)
    if (recipients.length > 0) {
      try {
        await sendOwnerComplianceAlertNotification({
          to: recipients.join(', '),
          ownerName: ownerDisplayName(row.owners),
          propertyName: row.properties?.property_name ?? null,
          unitNumber: row.properties?.unit_number ?? null,
          tenantName: row.tenants?.full_name ?? null,
          tenantAccessId: row.tenants?.tenant_access_id ?? null,
          daysRemaining,
          threshold,
          ejariExpiryLabel: formatDateLabel(row.ejari_expiry),
          contractEndLabel: formatDateLabel(row.contract_end),
        })
      } catch (mailError) {
        console.error('[runComplianceAlerts] email failed', {
          legalDateId: row.id,
          ownerId: row.owner_id,
          error: mailError,
        })
      }
    }

    const { error: patchError } = await supabaseAdmin
      .from('legal_dates')
      .update({
        [alertColumn]: now.toISOString(),
      })
      .eq('id', row.id)
      .eq('organization_id', row.organization_id)

    throwIfError(patchError, 'Failed to update legal compliance alert marker')
    alertsSent += 1
  }

  return {
    records_scanned: rows.length,
    alerts_sent: alertsSent,
    skipped_disabled: skippedDisabled,
  }
}
