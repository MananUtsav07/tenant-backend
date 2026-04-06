import { env } from '../config/env.js'
import { prisma } from '../lib/db.js'
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
  owners?: { email: string; full_name: string | null; company_name: string | null; support_email: string | null; support_whatsapp?: string | null } | null
  properties?: { property_name: string | null; unit_number: string | null } | null
  tenants?: { full_name: string | null; tenant_access_id: string | null } | null
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
  properties?: { property_name: string | null; unit_number: string | null } | null
  tenants?: { full_name: string | null; tenant_access_id: string | null } | null
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

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return null
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
  if (threshold === 120) return 'alert_120_sent_at'
  if (threshold === 90) return 'alert_90_sent_at'
  if (threshold === 60) return 'alert_60_sent_at'
  return 'alert_30_sent_at'
}

function ownerDashboardUrl() {
  return new URL('/owner/automation', `${env.FRONTEND_URL.replace(/\/$/, '')}/`).toString()
}

function ownerDisplayName(owner: ComplianceRow['owners']): string {
  if (!owner) return 'Owner'
  return owner.full_name || owner.company_name || owner.email
}

function formatDateLabel(value: string | null): string {
  const parsed = parseDateOnly(value)
  if (!parsed) return 'Not set'
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(parsed)
}

function unitLabel(value: string | null | undefined) {
  return value?.trim() ? `Unit ${value.trim()}` : 'Unit not provided'
}

function triggerLabel(dateType: ComplianceDateType) {
  if (dateType === 'ejari_expiry') return 'Ejari expiry'
  if (dateType === 'contract_end') return 'Contract end'
  return 'RERA notice date'
}

function relevantDateForType(row: ComplianceRow, dateType: ComplianceDateType) {
  return row[dateType]
}

function nextThresholdForDays(daysRemaining: number, sentThresholds: Set<ComplianceThreshold>) {
  const eligibleThresholds = thresholds.filter((threshold) => daysRemaining <= threshold && !sentThresholds.has(threshold))
  if (eligibleThresholds.length === 0) return null
  return Math.min(...eligibleThresholds) as ComplianceThreshold
}

function buildDraftScaffold(input: { row: ComplianceRow; dateType: ComplianceDateType; threshold: ComplianceThreshold; daysRemaining: number }) {
  if (input.threshold !== 30) {
    return { nextAction: input.dateType === 'ejari_expiry' ? 'Review renewal preparation and confirm whether tenant renewal is proceeding.' : 'Review renewal or notice planning with the property team.', legalActionRecommended: false, draftTitle: null, draftBody: null, notificationType: 'compliance_alert' as const }
  }

  const propertyName = input.row.properties?.property_name ?? 'your property'
  const unit = unitLabel(input.row.properties?.unit_number)
  const tenantName = input.row.tenants?.full_name ?? 'the current tenant'
  const trigger = triggerLabel(input.dateType)

  if (input.dateType === 'ejari_expiry') {
    return { nextAction: 'Escalate Ejari renewal immediately and prepare fallback legal review if renewal is not progressing.', legalActionRecommended: true, draftTitle: `Renewal escalation note for ${propertyName}`, draftBody: `Review ${trigger.toLowerCase()} for ${propertyName} ${unit}. ${tenantName} is ${input.daysRemaining} days away from the milestone. Confirm renewal status, chase missing documents, and prepare legal escalation if renewal will not complete in time.`, notificationType: 'compliance_alert_urgent' as const }
  }

  return { nextAction: 'Prepare the Form 12 / legal action review package for owner approval.', legalActionRecommended: true, draftTitle: `Form 12 preparation note for ${propertyName}`, draftBody: `Prepare a Form 12 review package for ${propertyName} ${unit}. ${tenantName} is ${input.daysRemaining} days away from ${trigger.toLowerCase()}. Verify notice grounds, supporting facts, and owner approval steps before initiating any legal action.`, notificationType: 'compliance_alert_urgent' as const }
}

async function ownerComplianceSettingsMap(ownerIds: string[]) {
  if (ownerIds.length === 0) return new Map<string, boolean>()

  const data = await prisma.owner_automation_settings.findMany({
    select: { owner_id: true, compliance_alerts_enabled: true },
    where: { owner_id: { in: ownerIds } },
  })

  const map = new Map<string, boolean>()
  for (const row of data) {
    map.set(row.owner_id, Boolean(row.compliance_alerts_enabled))
  }
  return map
}

function normalizeRelation<T>(value: unknown): T | null {
  if (!value) return null
  if (Array.isArray(value)) return (value[0] as T) ?? null
  return value as T
}

function serializeDateField(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  return String(value)
}

async function loadComplianceRows(filter?: { organizationId?: string; ownerId?: string }): Promise<ComplianceRow[]> {
  const where: Record<string, unknown> = {}
  if (filter?.organizationId) where.organization_id = filter.organizationId
  if (filter?.ownerId) where.owner_id = filter.ownerId

  const data = await prisma.legal_dates.findMany({
    select: { id: true, organization_id: true, owner_id: true, property_id: true, tenant_id: true, ejari_expiry: true, contract_end: true, rera_notice_date: true, form12_sent: true, alert_120_sent_at: true, alert_90_sent_at: true, alert_60_sent_at: true, alert_30_sent_at: true, owners: { select: { email: true, full_name: true, company_name: true, support_email: true, support_whatsapp: true } }, properties: { select: { property_name: true, unit_number: true } }, tenants: { select: { full_name: true, tenant_access_id: true } } },
    where,
  })

  return data.map((row) => ({
    id: row.id,
    organization_id: row.organization_id,
    owner_id: row.owner_id ?? '',
    property_id: row.property_id ?? '',
    tenant_id: row.tenant_id,
    ejari_expiry: serializeDateField(row.ejari_expiry as Date | string | null),
    contract_end: serializeDateField(row.contract_end as Date | string | null),
    rera_notice_date: serializeDateField(row.rera_notice_date as Date | string | null),
    form12_sent: Boolean(row.form12_sent),
    alert_120_sent_at: row.alert_120_sent_at instanceof Date ? row.alert_120_sent_at.toISOString() : (row.alert_120_sent_at as string | null),
    alert_90_sent_at: row.alert_90_sent_at instanceof Date ? row.alert_90_sent_at.toISOString() : (row.alert_90_sent_at as string | null),
    alert_60_sent_at: row.alert_60_sent_at instanceof Date ? row.alert_60_sent_at.toISOString() : (row.alert_60_sent_at as string | null),
    alert_30_sent_at: row.alert_30_sent_at instanceof Date ? row.alert_30_sent_at.toISOString() : (row.alert_30_sent_at as string | null),
    owners: normalizeRelation<ComplianceRow['owners']>(row.owners),
    properties: normalizeRelation<ComplianceRow['properties']>(row.properties),
    tenants: normalizeRelation<ComplianceRow['tenants']>(row.tenants),
  }))
}

async function loadComplianceAlertEvents(filter?: { organizationId?: string; ownerId?: string }): Promise<ComplianceAlertEventRow[]> {
  const where: Record<string, unknown> = {}
  if (filter?.organizationId) where.organization_id = filter.organizationId
  if (filter?.ownerId) where.owner_id = filter.ownerId

  const data = await prisma.compliance_alert_events.findMany({
    select: { id: true, legal_date_id: true, organization_id: true, owner_id: true, property_id: true, tenant_id: true, trigger_date_type: true, threshold_days: true, relevant_date: true, days_remaining: true, notification_type: true, message_subject: true, message_preview: true, delivery_channels: true, next_action: true, legal_action_recommended: true, legal_action_initiated: true, draft_title: true, draft_body: true, sent_at: true, created_at: true, properties: { select: { property_name: true, unit_number: true } }, tenants: { select: { full_name: true, tenant_access_id: true } } },
    where,
    orderBy: { sent_at: 'desc' },
  })

  return data.map((row) => ({
    id: row.id,
    legal_date_id: row.legal_date_id ?? '',
    organization_id: row.organization_id,
    owner_id: row.owner_id ?? '',
    property_id: row.property_id ?? '',
    tenant_id: row.tenant_id,
    trigger_date_type: row.trigger_date_type as ComplianceDateType,
    threshold_days: Number(row.threshold_days) as ComplianceThreshold,
    relevant_date: serializeDateField(row.relevant_date as Date | string | null) ?? '',
    days_remaining: Number(row.days_remaining),
    notification_type: row.notification_type as 'compliance_alert' | 'compliance_alert_urgent',
    message_subject: row.message_subject,
    message_preview: row.message_preview,
    delivery_channels: Array.isArray(row.delivery_channels) ? row.delivery_channels as ComplianceAlertEventRow['delivery_channels'] : [],
    next_action: row.next_action,
    legal_action_recommended: Boolean(row.legal_action_recommended),
    legal_action_initiated: Boolean(row.legal_action_initiated),
    draft_title: row.draft_title,
    draft_body: row.draft_body,
    sent_at: row.sent_at instanceof Date ? row.sent_at.toISOString() : String(row.sent_at),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    properties: normalizeRelation<ComplianceAlertEventRow['properties']>(row.properties),
    tenants: normalizeRelation<ComplianceAlertEventRow['tenants']>(row.tenants),
  }))
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

function buildTemplateVariables(input: { row: ComplianceRow; dateType: ComplianceDateType; threshold: ComplianceThreshold; daysRemaining: number; draftTitle: string | null; recommendedAction: string }) {
  const relevantDate = relevantDateForType(input.row, input.dateType)
  return { ownerName: ownerDisplayName(input.row.owners), propertyName: input.row.properties?.property_name ?? 'Property not provided', unitNumber: input.row.properties?.unit_number ?? 'Not provided', unitLabel: unitLabel(input.row.properties?.unit_number), tenantName: input.row.tenants?.full_name ?? 'Not provided', tenantAccessId: input.row.tenants?.tenant_access_id ?? 'Not provided', triggerType: input.dateType, triggerLabel: triggerLabel(input.dateType), threshold: input.threshold, daysRemaining: input.daysRemaining, relevantDate, relevantDateLabel: formatDateLabel(relevantDate), ejariExpiry: formatDateLabel(input.row.ejari_expiry), contractEnd: formatDateLabel(input.row.contract_end), reraNoticeDate: formatDateLabel(input.row.rera_notice_date), recommendedAction: input.recommendedAction, draftTitle: input.draftTitle ?? 'No draft prepared' }
}

async function createComplianceOwnerNotification(input: { row: ComplianceRow; dateType: ComplianceDateType; threshold: ComplianceThreshold; daysRemaining: number; recommendedAction: string; notificationType: 'compliance_alert' | 'compliance_alert_urgent'; templateVariables: Record<string, unknown> }) {
  const fallbackTitle = input.threshold === 30 ? `Urgent ${triggerLabel(input.dateType)} action in ${input.daysRemaining} days` : `${triggerLabel(input.dateType)} in ${input.daysRemaining} days`
  const fallbackBody = `${input.row.properties?.property_name ?? 'Property'} ${unitLabel(input.row.properties?.unit_number)} requires attention. ${triggerLabel(input.dateType)} is due on ${formatDateLabel(relevantDateForType(input.row, input.dateType))}. Next action: ${input.recommendedAction}`

  const rendered = await resolveAutomationMessageTemplate({ organizationId: input.row.organization_id, templateKey: input.notificationType, channel: 'in_app', fallbackSubject: fallbackTitle, fallbackBody, variables: input.templateVariables })

  await createOwnerNotification({ organization_id: input.row.organization_id, owner_id: input.row.owner_id, tenant_id: input.row.tenant_id, notification_type: input.notificationType, title: rendered.subject ?? fallbackTitle, message: rendered.body })

  return { title: rendered.subject ?? fallbackTitle, message: rendered.body }
}

async function recordComplianceAlertEvent(input: { row: ComplianceRow; dateType: ComplianceDateType; threshold: ComplianceThreshold; daysRemaining: number; notificationType: 'compliance_alert' | 'compliance_alert_urgent'; title: string; preview: string; nextAction: string; legalActionRecommended: boolean; legalActionInitiated: boolean; draftTitle: string | null; draftBody: string | null; draftPayload: Record<string, unknown>; automationJobId?: string | null; deliveryChannels: Array<{ channel: string; status: string; reason?: string }>; sentAt: string }) {
  const relevantDate = relevantDateForType(input.row, input.dateType)
  const row = await prisma.compliance_alert_events.create({
    select: { id: true },
    data: {
      legal_date_id: input.row.id,
      organization_id: input.row.organization_id,
      owner_id: input.row.owner_id,
      property_id: input.row.property_id,
      tenant_id: input.row.tenant_id,
      automation_job_id: input.automationJobId ?? null,
      trigger_date_type: input.dateType,
      threshold_days: input.threshold,
      relevant_date: relevantDate ? new Date(relevantDate) : new Date(),
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
      draft_payload: input.draftPayload as object,
      sent_at: new Date(input.sentAt),
    },
  })
  return row.id
}

async function markLegacyThresholdSent(row: ComplianceRow, threshold: ComplianceThreshold, sentAt: string) {
  const col = thresholdColumn(threshold)
  await prisma.legal_dates.update({ where: { id: row.id }, data: { [col]: new Date(sentAt) } })
}

async function logComplianceRowFailure(input: { jobId?: string | null; row: ComplianceRow; dateType: ComplianceDateType; threshold: ComplianceThreshold; daysRemaining: number; errorMessage: string }) {
  if (!input.jobId) return
  await recordAutomationError({ jobId: input.jobId, organizationId: input.row.organization_id, ownerId: input.row.owner_id, flowName: 'compliance_scan', errorMessage: input.errorMessage, context: { legal_date_id: input.row.id, trigger_date_type: input.dateType, threshold: input.threshold, days_remaining: input.daysRemaining } })
}

export async function attachComplianceAlertEventsToRun(eventIds: string[], runId: string) {
  if (eventIds.length === 0) return
  await prisma.compliance_alert_events.updateMany({ where: { id: { in: eventIds } }, data: { automation_run_id: runId } })
}

export async function runComplianceAlerts(now = new Date(), options?: { jobId?: string | null }) {
  const rows = await loadComplianceRows()
  const settingsMap = await ownerComplianceSettingsMap(Array.from(new Set(rows.map((row) => row.owner_id))))
  const existingEvents = await loadComplianceAlertEvents()
  const sentMap = buildSentThresholdMap(existingEvents)

  let alertsSent = 0; let skippedDisabled = 0; let candidatesConsidered = 0; let failures = 0
  const complianceAlertEventIds: string[] = []

  for (const row of rows) {
    const complianceEnabled = settingsMap.get(row.owner_id) ?? true
    if (!complianceEnabled) { skippedDisabled += complianceDateTypes.length; continue }

    for (const dateType of complianceDateTypes) {
      const relevantDateValue = relevantDateForType(row, dateType)
      const parsedDate = parseDateOnly(relevantDateValue)
      if (!parsedDate) continue

      const daysRemaining = daysUntil(parsedDate, now)
      if (daysRemaining < 0 || daysRemaining > 120) continue

      const sentThresholds = sentMap.get(`${row.id}:${dateType}`) ?? new Set<ComplianceThreshold>()
      const threshold = nextThresholdForDays(daysRemaining, sentThresholds)
      if (!threshold) continue

      candidatesConsidered += 1

      try {
        const draft = buildDraftScaffold({ row, dateType, threshold, daysRemaining })
        const templateVariables = buildTemplateVariables({ row, dateType, threshold, daysRemaining, draftTitle: draft.draftTitle, recommendedAction: draft.nextAction })
        const notification = await createComplianceOwnerNotification({ row, dateType, threshold, daysRemaining, recommendedAction: draft.nextAction, notificationType: draft.notificationType, templateVariables })

        const deliveryResult = await deliverOwnerAutomationMessage({ organizationId: row.organization_id, ownerId: row.owner_id, templateKey: draft.notificationType, templateVariables, email: { subject: notification.title, preheader: `${row.properties?.property_name ?? 'Property'} requires compliance action in ${daysRemaining} days.`, eyebrow: threshold === 30 ? 'Urgent Compliance Window' : 'Compliance Alert', title: notification.title, intro: [`Hello ${ownerDisplayName(row.owners)},`, threshold === 30 ? 'A legal milestone has reached the 30-day action window and needs immediate review.' : 'A legal milestone is approaching and has entered the scheduled reminder window.'], details: [{ label: 'Property', value: row.properties?.property_name ?? 'Not provided', emphasize: true, tone: 'accent' }, { label: 'Unit', value: row.properties?.unit_number ?? 'Not provided' }, { label: 'Tenant', value: row.tenants?.full_name ?? 'Not provided' }, { label: 'Tenant Access ID', value: row.tenants?.tenant_access_id ?? 'Not provided' }, { label: 'Trigger', value: triggerLabel(dateType), emphasize: true, tone: threshold === 30 ? 'security' : 'accent' }, { label: 'Relevant Date', value: formatDateLabel(relevantDateValue), emphasize: true }, { label: 'Days Remaining', value: String(daysRemaining), emphasize: true, tone: threshold === 30 ? 'security' : 'default' }, { label: 'Next Action', value: draft.nextAction }], body: draft.draftBody ? [draft.draftBody] : [notification.message], note: { title: threshold === 30 ? 'Action window note' : 'Reminder note', body: threshold === 30 ? 'This alert includes a draft preparation note so your team can review legal steps without fabricating any final legal document.' : 'This reminder is sent once per threshold and remains organization-scoped inside Prophives.', tone: threshold === 30 ? 'warning' : 'info' }, cta: { label: 'Open automation center', url: ownerDashboardUrl() }, footer: [`Ejari expiry: ${formatDateLabel(row.ejari_expiry)}`, `Contract end: ${formatDateLabel(row.contract_end)}`, `RERA notice date: ${formatDateLabel(row.rera_notice_date)}`] }, telegram: { fallbackText: [threshold === 30 ? 'Urgent compliance alert' : 'Compliance alert', `Property: ${row.properties?.property_name ?? 'Not provided'} (${unitLabel(row.properties?.unit_number)})`, `Trigger: ${triggerLabel(dateType)}`, `Relevant date: ${formatDateLabel(relevantDateValue)}`, `Days remaining: ${daysRemaining}`, `Next action: ${draft.nextAction}`].join('\n') }, whatsapp: { fallbackText: `${triggerLabel(dateType)} for ${row.properties?.property_name ?? 'your property'} is due in ${daysRemaining} days. ${draft.nextAction}` } })

        const sentAt = new Date().toISOString()
        const eventId = await recordComplianceAlertEvent({ row, dateType, threshold, daysRemaining, notificationType: draft.notificationType, title: notification.title, preview: notification.message, nextAction: draft.nextAction, legalActionRecommended: draft.legalActionRecommended, legalActionInitiated: row.form12_sent, draftTitle: draft.draftTitle, draftBody: draft.draftBody, draftPayload: { trigger_date_type: dateType, threshold, recommended_action: draft.nextAction, tenant_access_id: row.tenants?.tenant_access_id ?? null }, automationJobId: options?.jobId ?? null, deliveryChannels: [{ channel: 'in_app', status: 'sent' }, ...deliveryResult.deliveries.map((d) => ({ channel: d.channel, status: d.status, ...(d.reason ? { reason: d.reason } : {}) }))], sentAt })

        complianceAlertEventIds.push(eventId)
        await markLegacyThresholdSent(row, threshold, sentAt)

        const mapKey = `${row.id}:${dateType}`
        const thresholdSet = sentMap.get(mapKey) ?? new Set<ComplianceThreshold>()
        thresholdSet.add(threshold)
        sentMap.set(mapKey, thresholdSet)
        alertsSent += 1
      } catch (error) {
        failures += 1
        await logComplianceRowFailure({ jobId: options?.jobId, row, dateType, threshold, daysRemaining, errorMessage: error instanceof Error ? error.message : 'Unknown compliance alert failure' })
      }
    }
  }

  return { records_scanned: rows.length, candidates_considered: candidatesConsidered, alerts_sent: alertsSent, skipped_disabled: skippedDisabled, failures, compliance_alert_event_ids: complianceAlertEventIds }
}

function deriveUpcomingItems(rows: ComplianceRow[], events: ComplianceAlertEventRow[], now: Date): ComplianceUpcomingItem[] {
  const sentMap = buildSentThresholdMap(events)
  const latestEventMap = new Map<string, ComplianceAlertEventRow>()
  for (const event of events) {
    const key = `${event.legal_date_id}:${event.trigger_date_type}`
    if (!latestEventMap.has(key)) latestEventMap.set(key, event)
  }

  const items: ComplianceUpcomingItem[] = []
  for (const row of rows) {
    for (const dateType of complianceDateTypes) {
      const relevantDateValue = relevantDateForType(row, dateType)
      const parsedDate = parseDateOnly(relevantDateValue)
      if (!parsedDate) continue

      const daysRemaining = daysUntil(parsedDate, now)
      if (daysRemaining < 0 || daysRemaining > 120) continue

      const mapKey = `${row.id}:${dateType}`
      const sentThresholds = sentMap.get(mapKey) ?? new Set<ComplianceThreshold>()
      const latestEvent = latestEventMap.get(mapKey) ?? null
      const threshold = nextThresholdForDays(daysRemaining, sentThresholds)
      const draft = buildDraftScaffold({ row, dateType, threshold: threshold ?? 30, daysRemaining })

      items.push({ legal_date_id: row.id, organization_id: row.organization_id, owner_id: row.owner_id, property_id: row.property_id, tenant_id: row.tenant_id, trigger_date_type: dateType, trigger_label: triggerLabel(dateType), property_name: row.properties?.property_name ?? 'Not provided', unit_number: row.properties?.unit_number ?? null, tenant_name: row.tenants?.full_name ?? null, tenant_access_id: row.tenants?.tenant_access_id ?? null, relevant_date: relevantDateValue ?? '', relevant_date_label: formatDateLabel(relevantDateValue), days_remaining: daysRemaining, next_threshold: threshold, last_sent_at: latestEvent?.sent_at ?? null, last_sent_threshold: latestEvent?.threshold_days ?? null, next_action: latestEvent?.next_action ?? draft.nextAction, legal_action_initiated: latestEvent?.legal_action_initiated ?? row.form12_sent, draft_title: latestEvent?.draft_title ?? draft.draftTitle })
    }
  }

  return items.sort((l, r) => l.days_remaining - r.days_remaining)
}

async function loadRecentComplianceFailures(filter: { organizationId?: string; ownerId?: string }) {
  const where: Record<string, unknown> = { flow_name: 'compliance_scan' }
  if (filter.organizationId) where.organization_id = filter.organizationId
  if (filter.ownerId) where.owner_id = filter.ownerId

  return prisma.automation_errors.findMany({ select: { id: true, job_id: true, organization_id: true, owner_id: true, flow_name: true, error_message: true, context: true, created_at: true }, where, orderBy: { created_at: 'desc' }, take: 10 })
}

export async function getOwnerComplianceOverview(ownerId: string, organizationId: string, now = new Date()) {
  const [rows, events, failures] = await Promise.all([
    loadComplianceRows({ organizationId, ownerId }),
    loadComplianceAlertEvents({ organizationId, ownerId }),
    loadRecentComplianceFailures({ organizationId, ownerId }),
  ])
  return { upcoming_items: deriveUpcomingItems(rows, events, now).slice(0, 12), sent_reminders: events.slice(0, 12), failures }
}

export async function getAdminComplianceOverview(input: { organizationId?: string; now?: Date }) {
  const now = input.now ?? new Date()
  const [rows, events, failures] = await Promise.all([
    loadComplianceRows({ organizationId: input.organizationId }),
    loadComplianceAlertEvents({ organizationId: input.organizationId }),
    loadRecentComplianceFailures({ organizationId: input.organizationId }),
  ])
  return { upcoming_items: deriveUpcomingItems(rows, events, now).slice(0, 16), sent_reminders: events.slice(0, 16), failures }
}
