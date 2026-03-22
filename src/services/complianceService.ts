import type { PostgrestError } from '@supabase/supabase-js'

import { env } from '../config/env.js'
import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { recordAutomationError } from './automation/core/runLogger.js'
import { resolveAutomationMessageTemplate } from './automation/messageTemplateService.js'
import { deliverOwnerAutomationMessage } from './automation/providers/messageProvider.js'
import { createOwnerNotification } from './ownerService.js'

type ComplianceThreshold = 120 | 90 | 60 | 30
type ComplianceDateType = 'ejari_expiry' | 'contract_end' | 'rera_notice_date'

const thresholds: ComplianceThreshold[] = [120, 90, 60, 30]
const complianceDateTypes: ComplianceDateType[] = ['ejari_expiry', 'contract_end', 'rera_notice_date']

type ComplianceRow = {
  id: string
  organization_id: string
  owner_id: string
  property_id: string
  tenant_id: string | null
  ejari_expiry: string | null
  contract_end: string | null
  rera_notice_date: string | null
  form12_sent: boolean
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
        support_whatsapp?: string | null
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

type ComplianceAlertEventRow = {
  id: string
  legal_date_id: string
  organization_id: string
  owner_id: string
  property_id: string
  tenant_id: string | null
  trigger_date_type: ComplianceDateType
  threshold_days: ComplianceThreshold
  relevant_date: string
  days_remaining: number
  notification_type: 'compliance_alert' | 'compliance_alert_urgent'
  message_subject: string | null
  message_preview: string | null
  delivery_channels: Array<{ channel: string; status: string; reason?: string }>
  next_action: string | null
  legal_action_recommended: boolean
  legal_action_initiated: boolean
  draft_title: string | null
  draft_body: string | null
  sent_at: string
  created_at: string
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

export type ComplianceUpcomingItem = {
  legal_date_id: string
  organization_id: string
  owner_id: string
  property_id: string
  tenant_id: string | null
  trigger_date_type: ComplianceDateType
  trigger_label: string
  property_name: string
  unit_number: string | null
  tenant_name: string | null
  tenant_access_id: string | null
  relevant_date: string
  relevant_date_label: string
  days_remaining: number
  next_threshold: ComplianceThreshold | null
  last_sent_at: string | null
  last_sent_threshold: ComplianceThreshold | null
  next_action: string
  legal_action_initiated: boolean
  draft_title: string | null
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

function ownerDashboardUrl() {
  return new URL('/owner/automation', `${env.FRONTEND_URL.replace(/\/$/, '')}/`).toString()
}

function ownerDisplayName(owner: ComplianceRow['owners']): string {
  if (!owner) {
    return 'Owner'
  }

  return owner.full_name || owner.company_name || owner.email
}

function formatDateLabel(value: string | null): string {
  const parsed = parseDateOnly(value)
  if (!parsed) {
    return 'Not set'
  }

  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(parsed)
}

function unitLabel(value: string | null | undefined) {
  return value?.trim() ? `Unit ${value.trim()}` : 'Unit not provided'
}

function triggerLabel(dateType: ComplianceDateType) {
  if (dateType === 'ejari_expiry') {
    return 'Ejari expiry'
  }
  if (dateType === 'contract_end') {
    return 'Contract end'
  }
  return 'RERA notice date'
}

function relevantDateForType(row: ComplianceRow, dateType: ComplianceDateType) {
  return row[dateType]
}

function nextThresholdForDays(daysRemaining: number, sentThresholds: Set<ComplianceThreshold>) {
  const eligibleThresholds = thresholds.filter((threshold) => daysRemaining <= threshold && !sentThresholds.has(threshold))
  if (eligibleThresholds.length === 0) {
    return null
  }

  return Math.min(...eligibleThresholds) as ComplianceThreshold
}

function buildDraftScaffold(input: {
  row: ComplianceRow
  dateType: ComplianceDateType
  threshold: ComplianceThreshold
  daysRemaining: number
}) {
  if (input.threshold !== 30) {
    return {
      nextAction: input.dateType === 'ejari_expiry'
        ? 'Review renewal preparation and confirm whether tenant renewal is proceeding.'
        : 'Review renewal or notice planning with the property team.',
      legalActionRecommended: false,
      draftTitle: null,
      draftBody: null,
      notificationType: 'compliance_alert' as const,
    }
  }

  const propertyName = input.row.properties?.property_name ?? 'your property'
  const unit = unitLabel(input.row.properties?.unit_number)
  const tenantName = input.row.tenants?.full_name ?? 'the current tenant'
  const trigger = triggerLabel(input.dateType)

  if (input.dateType === 'ejari_expiry') {
    return {
      nextAction: 'Escalate Ejari renewal immediately and prepare fallback legal review if renewal is not progressing.',
      legalActionRecommended: true,
      draftTitle: `Renewal escalation note for ${propertyName}`,
      draftBody: `Review ${trigger.toLowerCase()} for ${propertyName} ${unit}. ${tenantName} is ${input.daysRemaining} days away from the milestone. Confirm renewal status, chase missing documents, and prepare legal escalation if renewal will not complete in time.`,
      notificationType: 'compliance_alert_urgent' as const,
    }
  }

  return {
    nextAction: 'Prepare the Form 12 / legal action review package for owner approval.',
    legalActionRecommended: true,
    draftTitle: `Form 12 preparation note for ${propertyName}`,
    draftBody: `Prepare a Form 12 review package for ${propertyName} ${unit}. ${tenantName} is ${input.daysRemaining} days away from ${trigger.toLowerCase()}. Verify notice grounds, supporting facts, and owner approval steps before initiating any legal action.`,
    notificationType: 'compliance_alert_urgent' as const,
  }
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

async function loadComplianceRows(filter?: { organizationId?: string; ownerId?: string }) {
  let query = supabaseAdmin
    .from('legal_dates')
    .select(
      'id, organization_id, owner_id, property_id, tenant_id, ejari_expiry, contract_end, rera_notice_date, form12_sent, alert_120_sent_at, alert_90_sent_at, alert_60_sent_at, alert_30_sent_at, owners(email, full_name, company_name, support_email, support_whatsapp), properties(property_name, unit_number), tenants(full_name, tenant_access_id)',
    )

  if (filter?.organizationId) {
    query = query.eq('organization_id', filter.organizationId)
  }

  if (filter?.ownerId) {
    query = query.eq('owner_id', filter.ownerId)
  }

  const { data, error } = await query
  throwIfError(error, 'Failed to load legal compliance records')

  return (data ?? []).map((row) => {
    const normalized = row as Record<string, unknown>

    const ownersValue = normalized.owners
    const propertiesValue = normalized.properties
    const tenantsValue = normalized.tenants

    return {
      id: String(normalized.id),
      organization_id: String(normalized.organization_id),
      owner_id: String(normalized.owner_id),
      property_id: String(normalized.property_id),
      tenant_id: (normalized.tenant_id as string | null | undefined) ?? null,
      ejari_expiry: (normalized.ejari_expiry as string | null | undefined) ?? null,
      contract_end: (normalized.contract_end as string | null | undefined) ?? null,
      rera_notice_date: (normalized.rera_notice_date as string | null | undefined) ?? null,
      form12_sent: Boolean(normalized.form12_sent),
      alert_120_sent_at: (normalized.alert_120_sent_at as string | null | undefined) ?? null,
      alert_90_sent_at: (normalized.alert_90_sent_at as string | null | undefined) ?? null,
      alert_60_sent_at: (normalized.alert_60_sent_at as string | null | undefined) ?? null,
      alert_30_sent_at: (normalized.alert_30_sent_at as string | null | undefined) ?? null,
      owners: Array.isArray(ownersValue) ? ((ownersValue[0] as ComplianceRow['owners']) ?? null) : ((ownersValue as ComplianceRow['owners']) ?? null),
      properties: Array.isArray(propertiesValue)
        ? ((propertiesValue[0] as ComplianceRow['properties']) ?? null)
        : ((propertiesValue as ComplianceRow['properties']) ?? null),
      tenants: Array.isArray(tenantsValue) ? ((tenantsValue[0] as ComplianceRow['tenants']) ?? null) : ((tenantsValue as ComplianceRow['tenants']) ?? null),
    } satisfies ComplianceRow
  })
}

async function loadComplianceAlertEvents(filter?: { organizationId?: string; ownerId?: string }) {
  let query = supabaseAdmin
    .from('compliance_alert_events')
    .select(
      'id, legal_date_id, organization_id, owner_id, property_id, tenant_id, trigger_date_type, threshold_days, relevant_date, days_remaining, notification_type, message_subject, message_preview, delivery_channels, next_action, legal_action_recommended, legal_action_initiated, draft_title, draft_body, sent_at, created_at, properties(property_name, unit_number), tenants(full_name, tenant_access_id)',
    )
    .order('sent_at', { ascending: false })

  if (filter?.organizationId) {
    query = query.eq('organization_id', filter.organizationId)
  }

  if (filter?.ownerId) {
    query = query.eq('owner_id', filter.ownerId)
  }

  const { data, error } = await query
  throwIfError(error, 'Failed to load compliance alert events')

  return (data ?? []).map((row) => {
    const normalized = row as Record<string, unknown>
    const propertiesValue = normalized.properties
    const tenantsValue = normalized.tenants

    return {
      id: String(normalized.id),
      legal_date_id: String(normalized.legal_date_id),
      organization_id: String(normalized.organization_id),
      owner_id: String(normalized.owner_id),
      property_id: String(normalized.property_id),
      tenant_id: (normalized.tenant_id as string | null | undefined) ?? null,
      trigger_date_type: normalized.trigger_date_type as ComplianceDateType,
      threshold_days: normalized.threshold_days as ComplianceThreshold,
      relevant_date: String(normalized.relevant_date),
      days_remaining: Number(normalized.days_remaining),
      notification_type: normalized.notification_type as 'compliance_alert' | 'compliance_alert_urgent',
      message_subject: (normalized.message_subject as string | null | undefined) ?? null,
      message_preview: (normalized.message_preview as string | null | undefined) ?? null,
      delivery_channels: Array.isArray(normalized.delivery_channels)
        ? (normalized.delivery_channels as ComplianceAlertEventRow['delivery_channels'])
        : [],
      next_action: (normalized.next_action as string | null | undefined) ?? null,
      legal_action_recommended: Boolean(normalized.legal_action_recommended),
      legal_action_initiated: Boolean(normalized.legal_action_initiated),
      draft_title: (normalized.draft_title as string | null | undefined) ?? null,
      draft_body: (normalized.draft_body as string | null | undefined) ?? null,
      sent_at: String(normalized.sent_at),
      created_at: String(normalized.created_at),
      properties: Array.isArray(propertiesValue)
        ? ((propertiesValue[0] as ComplianceAlertEventRow['properties']) ?? null)
        : ((propertiesValue as ComplianceAlertEventRow['properties']) ?? null),
      tenants: Array.isArray(tenantsValue)
        ? ((tenantsValue[0] as ComplianceAlertEventRow['tenants']) ?? null)
        : ((tenantsValue as ComplianceAlertEventRow['tenants']) ?? null),
    } satisfies ComplianceAlertEventRow
  })
}

function buildSentThresholdMap(events: ComplianceAlertEventRow[]) {
  const sentMap = new Map<string, Set<ComplianceThreshold>>()
  for (const event of events) {
    const key = `${event.legal_date_id}:${event.trigger_date_type}`
    const thresholdSet = sentMap.get(key) ?? new Set<ComplianceThreshold>()
    thresholdSet.add(event.threshold_days)
    sentMap.set(key, thresholdSet)
  }
  return sentMap
}

function buildTemplateVariables(input: {
  row: ComplianceRow
  dateType: ComplianceDateType
  threshold: ComplianceThreshold
  daysRemaining: number
  draftTitle: string | null
  recommendedAction: string
}) {
  const relevantDate = relevantDateForType(input.row, input.dateType)
  return {
    ownerName: ownerDisplayName(input.row.owners),
    propertyName: input.row.properties?.property_name ?? 'Property not provided',
    unitNumber: input.row.properties?.unit_number ?? 'Not provided',
    unitLabel: unitLabel(input.row.properties?.unit_number),
    tenantName: input.row.tenants?.full_name ?? 'Not provided',
    tenantAccessId: input.row.tenants?.tenant_access_id ?? 'Not provided',
    triggerType: input.dateType,
    triggerLabel: triggerLabel(input.dateType),
    threshold: input.threshold,
    daysRemaining: input.daysRemaining,
    relevantDate,
    relevantDateLabel: formatDateLabel(relevantDate),
    ejariExpiry: formatDateLabel(input.row.ejari_expiry),
    contractEnd: formatDateLabel(input.row.contract_end),
    reraNoticeDate: formatDateLabel(input.row.rera_notice_date),
    recommendedAction: input.recommendedAction,
    draftTitle: input.draftTitle ?? 'No draft prepared',
  }
}

async function createComplianceOwnerNotification(input: {
  row: ComplianceRow
  dateType: ComplianceDateType
  threshold: ComplianceThreshold
  daysRemaining: number
  recommendedAction: string
  notificationType: 'compliance_alert' | 'compliance_alert_urgent'
  templateVariables: Record<string, unknown>
}) {
  const fallbackTitle =
    input.threshold === 30
      ? `Urgent ${triggerLabel(input.dateType)} action in ${input.daysRemaining} days`
      : `${triggerLabel(input.dateType)} in ${input.daysRemaining} days`

  const fallbackBody = `${input.row.properties?.property_name ?? 'Property'} ${unitLabel(input.row.properties?.unit_number)} requires attention. ${triggerLabel(input.dateType)} is due on ${formatDateLabel(relevantDateForType(input.row, input.dateType))}. Next action: ${input.recommendedAction}`

  const rendered = await resolveAutomationMessageTemplate({
    organizationId: input.row.organization_id,
    templateKey: input.notificationType,
    channel: 'in_app',
    fallbackSubject: fallbackTitle,
    fallbackBody,
    variables: input.templateVariables,
  })

  await createOwnerNotification({
    organization_id: input.row.organization_id,
    owner_id: input.row.owner_id,
    tenant_id: input.row.tenant_id,
    notification_type: input.notificationType,
    title: rendered.subject ?? fallbackTitle,
    message: rendered.body,
  })

  return {
    title: rendered.subject ?? fallbackTitle,
    message: rendered.body,
  }
}

async function recordComplianceAlertEvent(input: {
  row: ComplianceRow
  dateType: ComplianceDateType
  threshold: ComplianceThreshold
  daysRemaining: number
  notificationType: 'compliance_alert' | 'compliance_alert_urgent'
  title: string
  preview: string
  nextAction: string
  legalActionRecommended: boolean
  legalActionInitiated: boolean
  draftTitle: string | null
  draftBody: string | null
  draftPayload: Record<string, unknown>
  automationJobId?: string | null
  deliveryChannels: Array<{ channel: string; status: string; reason?: string }>
  sentAt: string
}) {
  const { data, error } = await supabaseAdmin
    .from('compliance_alert_events')
    .insert({
      legal_date_id: input.row.id,
      organization_id: input.row.organization_id,
      owner_id: input.row.owner_id,
      property_id: input.row.property_id,
      tenant_id: input.row.tenant_id,
      automation_job_id: input.automationJobId ?? null,
      trigger_date_type: input.dateType,
      threshold_days: input.threshold,
      relevant_date: relevantDateForType(input.row, input.dateType),
      days_remaining: input.daysRemaining,
      notification_type: input.notificationType,
      message_subject: input.title,
      message_preview: input.preview,
      delivery_channels: input.deliveryChannels,
      next_action: input.nextAction,
      legal_action_recommended: input.legalActionRecommended,
      legal_action_initiated: input.legalActionInitiated,
      draft_title: input.draftTitle,
      draft_body: input.draftBody,
      draft_payload: input.draftPayload,
      sent_at: input.sentAt,
    })
    .select('id')
    .single()

  throwIfError(error, 'Failed to record compliance alert event')
  return String(data?.id)
}

async function markLegacyThresholdSent(row: ComplianceRow, threshold: ComplianceThreshold, sentAt: string) {
  const { error } = await supabaseAdmin
    .from('legal_dates')
    .update({
      [thresholdColumn(threshold)]: sentAt,
    })
    .eq('id', row.id)
    .eq('organization_id', row.organization_id)

  throwIfError(error, 'Failed to update legacy compliance threshold marker')
}

async function logComplianceRowFailure(input: {
  jobId?: string | null
  row: ComplianceRow
  dateType: ComplianceDateType
  threshold: ComplianceThreshold
  daysRemaining: number
  errorMessage: string
}) {
  if (!input.jobId) {
    return
  }

  await recordAutomationError({
    jobId: input.jobId,
    organizationId: input.row.organization_id,
    ownerId: input.row.owner_id,
    flowName: 'compliance_scan',
    errorMessage: input.errorMessage,
    context: {
      legal_date_id: input.row.id,
      trigger_date_type: input.dateType,
      threshold: input.threshold,
      days_remaining: input.daysRemaining,
    },
  })
}

export async function attachComplianceAlertEventsToRun(eventIds: string[], runId: string) {
  if (eventIds.length === 0) {
    return
  }

  const { error } = await supabaseAdmin
    .from('compliance_alert_events')
    .update({
      automation_run_id: runId,
    })
    .in('id', eventIds)

  throwIfError(error, 'Failed to attach compliance alert events to automation run')
}

export async function runComplianceAlerts(now = new Date(), options?: { jobId?: string | null }) {
  const rows = await loadComplianceRows()
  const settingsMap = await ownerComplianceSettingsMap(Array.from(new Set(rows.map((row) => row.owner_id))))
  const existingEvents = await loadComplianceAlertEvents()
  const sentMap = buildSentThresholdMap(existingEvents)

  let alertsSent = 0
  let skippedDisabled = 0
  let candidatesConsidered = 0
  let failures = 0
  const complianceAlertEventIds: string[] = []

  for (const row of rows) {
    const complianceEnabled = settingsMap.get(row.owner_id) ?? true
    if (!complianceEnabled) {
      skippedDisabled += complianceDateTypes.length
      continue
    }

    for (const dateType of complianceDateTypes) {
      const relevantDateValue = relevantDateForType(row, dateType)
      const parsedDate = parseDateOnly(relevantDateValue)
      if (!parsedDate) {
        continue
      }

      const daysRemaining = daysUntil(parsedDate, now)
      if (daysRemaining < 0 || daysRemaining > 120) {
        continue
      }

      const sentThresholds = sentMap.get(`${row.id}:${dateType}`) ?? new Set<ComplianceThreshold>()
      const threshold = nextThresholdForDays(daysRemaining, sentThresholds)
      if (!threshold) {
        continue
      }

      candidatesConsidered += 1

      try {
        const draft = buildDraftScaffold({
          row,
          dateType,
          threshold,
          daysRemaining,
        })

        const templateVariables = buildTemplateVariables({
          row,
          dateType,
          threshold,
          daysRemaining,
          draftTitle: draft.draftTitle,
          recommendedAction: draft.nextAction,
        })

        const notification = await createComplianceOwnerNotification({
          row,
          dateType,
          threshold,
          daysRemaining,
          recommendedAction: draft.nextAction,
          notificationType: draft.notificationType,
          templateVariables,
        })

        const deliveryResult = await deliverOwnerAutomationMessage({
          organizationId: row.organization_id,
          ownerId: row.owner_id,
          templateKey: draft.notificationType,
          templateVariables,
          email: {
            subject: notification.title,
            preheader: `${row.properties?.property_name ?? 'Property'} requires compliance action in ${daysRemaining} days.`,
            eyebrow: threshold === 30 ? 'Urgent Compliance Window' : 'Compliance Alert',
            title: notification.title,
            intro: [
              `Hello ${ownerDisplayName(row.owners)},`,
              threshold === 30
                ? 'A legal milestone has reached the 30-day action window and needs immediate review.'
                : 'A legal milestone is approaching and has entered the scheduled reminder window.',
            ],
            details: [
              { label: 'Property', value: row.properties?.property_name ?? 'Not provided', emphasize: true, tone: 'accent' },
              { label: 'Unit', value: row.properties?.unit_number ?? 'Not provided' },
              { label: 'Tenant', value: row.tenants?.full_name ?? 'Not provided' },
              { label: 'Tenant Access ID', value: row.tenants?.tenant_access_id ?? 'Not provided' },
              { label: 'Trigger', value: triggerLabel(dateType), emphasize: true, tone: threshold === 30 ? 'security' : 'accent' },
              { label: 'Relevant Date', value: formatDateLabel(relevantDateValue), emphasize: true },
              { label: 'Days Remaining', value: String(daysRemaining), emphasize: true, tone: threshold === 30 ? 'security' : 'default' },
              { label: 'Next Action', value: draft.nextAction },
            ],
            body: draft.draftBody ? [draft.draftBody] : [notification.message],
            note: {
              title: threshold === 30 ? 'Action window note' : 'Reminder note',
              body:
                threshold === 30
                  ? 'This alert includes a draft preparation note so your team can review legal steps without fabricating any final legal document.'
                  : 'This reminder is sent once per threshold and remains organization-scoped inside Prophives.',
              tone: threshold === 30 ? 'warning' : 'info',
            },
            cta: {
              label: 'Open automation center',
              url: ownerDashboardUrl(),
            },
            footer: [
              `Ejari expiry: ${formatDateLabel(row.ejari_expiry)}`,
              `Contract end: ${formatDateLabel(row.contract_end)}`,
              `RERA notice date: ${formatDateLabel(row.rera_notice_date)}`,
            ],
          },
          telegram: {
            fallbackText: [
              threshold === 30 ? 'Urgent compliance alert' : 'Compliance alert',
              `Property: ${row.properties?.property_name ?? 'Not provided'} (${unitLabel(row.properties?.unit_number)})`,
              `Trigger: ${triggerLabel(dateType)}`,
              `Relevant date: ${formatDateLabel(relevantDateValue)}`,
              `Days remaining: ${daysRemaining}`,
              `Next action: ${draft.nextAction}`,
            ].join('\n'),
          },
          whatsapp: {
            fallbackText: `${triggerLabel(dateType)} for ${row.properties?.property_name ?? 'your property'} is due in ${daysRemaining} days. ${draft.nextAction}`,
          },
        })

        const sentAt = new Date().toISOString()
        const eventId = await recordComplianceAlertEvent({
          row,
          dateType,
          threshold,
          daysRemaining,
          notificationType: draft.notificationType,
          title: notification.title,
          preview: notification.message,
          nextAction: draft.nextAction,
          legalActionRecommended: draft.legalActionRecommended,
          legalActionInitiated: row.form12_sent,
          draftTitle: draft.draftTitle,
          draftBody: draft.draftBody,
          draftPayload: {
            trigger_date_type: dateType,
            threshold,
            recommended_action: draft.nextAction,
            tenant_access_id: row.tenants?.tenant_access_id ?? null,
          },
          automationJobId: options?.jobId ?? null,
          deliveryChannels: [
            { channel: 'in_app', status: 'sent' },
            ...deliveryResult.deliveries.map((delivery) => ({
              channel: delivery.channel,
              status: delivery.status,
              ...(delivery.reason ? { reason: delivery.reason } : {}),
            })),
          ],
          sentAt,
        })

        complianceAlertEventIds.push(eventId)
        await markLegacyThresholdSent(row, threshold, sentAt)

        const mapKey = `${row.id}:${dateType}`
        const thresholdSet = sentMap.get(mapKey) ?? new Set<ComplianceThreshold>()
        thresholdSet.add(threshold)
        sentMap.set(mapKey, thresholdSet)
        alertsSent += 1
      } catch (error) {
        failures += 1
        await logComplianceRowFailure({
          jobId: options?.jobId,
          row,
          dateType,
          threshold,
          daysRemaining,
          errorMessage: error instanceof Error ? error.message : 'Unknown compliance alert failure',
        })
      }
    }
  }

  return {
    records_scanned: rows.length,
    candidates_considered: candidatesConsidered,
    alerts_sent: alertsSent,
    skipped_disabled: skippedDisabled,
    failures,
    compliance_alert_event_ids: complianceAlertEventIds,
  }
}

function deriveUpcomingItems(rows: ComplianceRow[], events: ComplianceAlertEventRow[], now: Date): ComplianceUpcomingItem[] {
  const sentMap = buildSentThresholdMap(events)
  const latestEventMap = new Map<string, ComplianceAlertEventRow>()

  for (const event of events) {
    const key = `${event.legal_date_id}:${event.trigger_date_type}`
    if (!latestEventMap.has(key)) {
      latestEventMap.set(key, event)
    }
  }

  const items: ComplianceUpcomingItem[] = []

  for (const row of rows) {
    for (const dateType of complianceDateTypes) {
      const relevantDateValue = relevantDateForType(row, dateType)
      const parsedDate = parseDateOnly(relevantDateValue)
      if (!parsedDate) {
        continue
      }

      const daysRemaining = daysUntil(parsedDate, now)
      if (daysRemaining < 0 || daysRemaining > 120) {
        continue
      }

      const mapKey = `${row.id}:${dateType}`
      const sentThresholds = sentMap.get(mapKey) ?? new Set<ComplianceThreshold>()
      const latestEvent = latestEventMap.get(mapKey) ?? null
      const threshold = nextThresholdForDays(daysRemaining, sentThresholds)
      const draft = buildDraftScaffold({
        row,
        dateType,
        threshold: threshold ?? 30,
        daysRemaining,
      })

      items.push({
        legal_date_id: row.id,
        organization_id: row.organization_id,
        owner_id: row.owner_id,
        property_id: row.property_id,
        tenant_id: row.tenant_id,
        trigger_date_type: dateType,
        trigger_label: triggerLabel(dateType),
        property_name: row.properties?.property_name ?? 'Not provided',
        unit_number: row.properties?.unit_number ?? null,
        tenant_name: row.tenants?.full_name ?? null,
        tenant_access_id: row.tenants?.tenant_access_id ?? null,
        relevant_date: relevantDateValue ?? '',
        relevant_date_label: formatDateLabel(relevantDateValue),
        days_remaining: daysRemaining,
        next_threshold: threshold,
        last_sent_at: latestEvent?.sent_at ?? null,
        last_sent_threshold: latestEvent?.threshold_days ?? null,
        next_action: latestEvent?.next_action ?? draft.nextAction,
        legal_action_initiated: latestEvent?.legal_action_initiated ?? row.form12_sent,
        draft_title: latestEvent?.draft_title ?? draft.draftTitle,
      })
    }
  }

  return items.sort((left, right) => left.days_remaining - right.days_remaining)
}

async function loadRecentComplianceFailures(filter: { organizationId?: string; ownerId?: string }) {
  let query = supabaseAdmin
    .from('automation_errors')
    .select('id, job_id, organization_id, owner_id, flow_name, error_message, context, created_at')
    .eq('flow_name', 'compliance_scan')
    .order('created_at', { ascending: false })
    .limit(10)

  if (filter.organizationId) {
    query = query.eq('organization_id', filter.organizationId)
  }

  if (filter.ownerId) {
    query = query.eq('owner_id', filter.ownerId)
  }

  const { data, error } = await query
  throwIfError(error, 'Failed to load compliance failures')
  return data ?? []
}

export async function getOwnerComplianceOverview(ownerId: string, organizationId: string, now = new Date()) {
  const [rows, events, failures] = await Promise.all([
    loadComplianceRows({ organizationId, ownerId }),
    loadComplianceAlertEvents({ organizationId, ownerId }),
    loadRecentComplianceFailures({ organizationId, ownerId }),
  ])

  return {
    upcoming_items: deriveUpcomingItems(rows, events, now).slice(0, 12),
    sent_reminders: events.slice(0, 12),
    failures,
  }
}

export async function getAdminComplianceOverview(input: { organizationId?: string; now?: Date }) {
  const now = input.now ?? new Date()
  const [rows, events, failures] = await Promise.all([
    loadComplianceRows({ organizationId: input.organizationId }),
    loadComplianceAlertEvents({ organizationId: input.organizationId }),
    loadRecentComplianceFailures({ organizationId: input.organizationId }),
  ])

  return {
    upcoming_items: deriveUpcomingItems(rows, events, now).slice(0, 16),
    sent_reminders: events.slice(0, 16),
    failures,
  }
}
