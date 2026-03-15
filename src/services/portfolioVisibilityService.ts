
import type { PostgrestError } from '@supabase/supabase-js'

import { env } from '../config/env.js'
import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { recordAutomationError } from './automation/core/runLogger.js'
import { resolveAutomationMessageTemplate } from './automation/messageTemplateService.js'
import { deliverOwnerAutomationMessage } from './automation/providers/messageProvider.js'
import { getOwnerComplianceOverview, type ComplianceUpcomingItem } from './complianceService.js'
import { createOwnerNotification } from './ownerService.js'

type DigestFrequency = 'daily' | 'weekly' | 'monthly'
type SnapshotScope = 'current' | 'daily' | 'weekly' | 'monthly'
type TriggerType = 'schedule' | 'event' | 'manual'

type OwnerRow = {
  id: string
  email: string
  full_name: string | null
  company_name: string | null
  support_email: string | null
  organization_id: string
  organizations?: { name?: string | null; slug?: string | null; currency_code?: string | null } | null
  owner_automation_settings?:
    | Array<{
        daily_digest_enabled: boolean | null
        weekly_digest_enabled: boolean | null
        monthly_digest_enabled: boolean | null
        portfolio_visibility_enabled: boolean | null
      }>
    | null
}

type PropertyRow = {
  id: string
  property_name: string
  unit_number: string | null
}

type ActiveTenantRow = {
  id: string
  property_id: string
  full_name: string
  tenant_access_id: string
  monthly_rent: number
  payment_status: 'pending' | 'paid' | 'overdue' | 'partial'
}

type TicketRow = {
  id: string
  subject: string
  message: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  created_at: string
  updated_at: string
  tenants?: {
    id: string
    full_name: string | null
    tenant_access_id: string | null
    properties?: {
      id: string
      property_name: string | null
      unit_number: string | null
    } | null
  } | null
}

type AlertRow = {
  id: string
  notification_type: string
  title: string
  message: string
  is_read: boolean
  created_at: string
  tenant_id: string | null
  tenants?: {
    id: string
    full_name: string | null
    tenant_access_id: string | null
  } | null
}

type CashFlowSignalRow = {
  id: string
  report_scope: 'current' | 'monthly' | 'annual'
  report_label: string
  currency_code: string
  portfolio_net_income: number
  portfolio_yield_percent: number | null
  created_at: string
}

type PortfolioTicketHighlight = {
  id: string
  subject: string
  status: TicketRow['status']
  created_at: string
  updated_at: string
  tenant_name: string | null
  tenant_access_id: string | null
  property_name: string | null
  unit_number: string | null
  urgency: 'urgent' | 'normal'
  age_days: number
}

type PortfolioVacancyHighlight = {
  property_id: string
  property_name: string
  unit_number: string | null
}

type PortfolioOverdueItem = {
  tenant_id: string
  tenant_name: string
  tenant_access_id: string
  property_id: string
  property_name: string | null
  unit_number: string | null
  monthly_rent: number
}

type PortfolioCashFlowSummary = {
  latest_monthly_snapshot: CashFlowSignalRow | null
  latest_annual_snapshot: CashFlowSignalRow | null
}

type PortfolioVisibilityPayload = {
  ticket_highlights: {
    recent: PortfolioTicketHighlight[]
    urgent_open: PortfolioTicketHighlight[]
    stale_open: PortfolioTicketHighlight[]
  }
  overdue_rent_items: PortfolioOverdueItem[]
  compliance_highlights: ComplianceUpcomingItem[]
  vacancy_highlights: PortfolioVacancyHighlight[]
  cash_flow_summary: PortfolioCashFlowSummary
}

type PortfolioVisibilitySnapshot = {
  snapshot_scope: SnapshotScope
  trigger_type: TriggerType
  snapshot_label: string
  period_start: string
  period_end: string
  currency_code: string
  active_tenant_count: number
  open_ticket_count: number
  new_ticket_count: number
  urgent_open_ticket_count: number
  stale_ticket_count: number
  overdue_rent_count: number
  reminders_pending_count: number
  awaiting_approvals_count: number
  occupied_property_count: number
  vacant_property_count: number
  upcoming_compliance_count: number
  payload: PortfolioVisibilityPayload
}

type PortfolioVisibilitySnapshotRow = PortfolioVisibilitySnapshot & {
  id: string
  owner_id: string
  organization_id: string
  created_at: string
  owners?: {
    full_name?: string | null
    company_name?: string | null
    email?: string | null
  } | null
  organizations?: {
    name?: string | null
    slug?: string | null
  } | null
}

type OwnerPortfolioVisibilityOverview = {
  current_snapshot: PortfolioVisibilitySnapshot & { generated_at: string }
  latest_daily_snapshot: PortfolioVisibilitySnapshotRow | null
  latest_weekly_snapshot: PortfolioVisibilitySnapshotRow | null
  latest_monthly_snapshot: PortfolioVisibilitySnapshotRow | null
  recent_snapshots: PortfolioVisibilitySnapshotRow[]
  recent_alerts: AlertRow[]
}

type AdminPortfolioVisibilityOverview = {
  recent_snapshots: PortfolioVisibilitySnapshotRow[]
}

type SnapshotWindow = {
  scope: SnapshotScope
  label: string
  periodStart: Date
  periodEnd: Date
}

const urgentTicketPattern =
  /\b(urgent|emergency|leak|flood|gas|fire|smoke|electrical|electric|power outage|no water|lock(ed)? out|break[-\s]?in|security|ac not working|air.?conditioner)\b/i
const staleTicketHours = 72
const recentAlertsLimit = 8

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

function normalizeCurrencyCode(currencyCode: string | null | undefined) {
  const normalized = currencyCode?.trim().toUpperCase()
  return normalized || 'INR'
}

function formatCurrencyLabel(amount: number, currencyCode: string) {
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: normalizeCurrencyCode(currencyCode),
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount)
  }
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10)
}

function ownerDisplayName(owner: OwnerRow) {
  return owner.full_name || owner.company_name || owner.email
}

function ownerDashboardUrl() {
  return new URL('/owner/dashboard', `${env.FRONTEND_URL.replace(/\/$/, '')}/`).toString()
}

function ownerAutomationUrl() {
  return new URL('/owner/automation', `${env.FRONTEND_URL.replace(/\/$/, '')}/`).toString()
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0))
}

function endOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 23, 59, 59, 999))
}

function daysAgo(now: Date, days: number) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
}

function previousMonthWindow(now: Date) {
  const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const periodStart = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1, 0, 0, 0, 0))
  const periodEnd = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0, 23, 59, 59, 999))
  const label = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(periodStart)

  return { periodStart, periodEnd, label }
}

function buildSnapshotWindow(frequency: DigestFrequency, now: Date): SnapshotWindow {
  if (frequency === 'daily') {
    return {
      scope: 'daily',
      label: new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(now),
      periodStart: startOfUtcDay(daysAgo(now, 1)),
      periodEnd: endOfUtcDay(now),
    }
  }

  if (frequency === 'weekly') {
    return {
      scope: 'weekly',
      label: `Week ending ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' }).format(now)}`,
      periodStart: startOfUtcDay(daysAgo(now, 7)),
      periodEnd: endOfUtcDay(now),
    }
  }

  const monthly = previousMonthWindow(now)
  return {
    scope: 'monthly',
    label: monthly.label,
    periodStart: monthly.periodStart,
    periodEnd: monthly.periodEnd,
  }
}

function frequencyLabels(frequency: DigestFrequency, window: SnapshotWindow, ownerName: string) {
  if (frequency === 'daily') {
    return {
      templateKey: 'portfolio_daily_digest' as const,
      title: 'Daily portfolio brief',
      subject: `Daily portfolio brief | ${window.label}`,
      preheader: 'Material operational signals from your Prophives portfolio are ready.',
      eyebrow: 'Portfolio Daily Brief',
      intro: [
        `Hello ${ownerName},`,
        'Your Prophives daily operating brief is ready. This digest is only sent when something actionable needs attention.',
      ],
    }
  }

  if (frequency === 'weekly') {
    return {
      templateKey: 'portfolio_weekly_digest' as const,
      title: 'Weekly portfolio digest',
      subject: `Weekly portfolio digest | ${window.label}`,
      preheader: 'Your weekly Prophives visibility summary is ready.',
      eyebrow: 'Portfolio Weekly Digest',
      intro: [`Hello ${ownerName},`, 'Here is your weekly portfolio operations summary across rent, service, compliance, and occupancy.'],
    }
  }

  return {
    templateKey: 'portfolio_monthly_digest' as const,
    title: 'Monthly portfolio overview',
    subject: `Monthly portfolio overview | ${window.label}`,
    preheader: 'Your monthly Prophives owner overview is ready.',
    eyebrow: 'Portfolio Monthly Overview',
    intro: [`Hello ${ownerName},`, 'Here is your monthly portfolio overview with operations posture and the latest financial signals.'],
  }
}

function isDigestEnabled(owner: OwnerRow, frequency: DigestFrequency) {
  const settings = owner.owner_automation_settings?.[0]
  if (!settings) {
    return true
  }

  if (!settings.portfolio_visibility_enabled) {
    return false
  }

  if (frequency === 'daily') {
    return settings.daily_digest_enabled ?? true
  }

  if (frequency === 'weekly') {
    return settings.weekly_digest_enabled ?? false
  }

  return settings.monthly_digest_enabled ?? false
}

function hasMaterialDailySignal(snapshot: PortfolioVisibilitySnapshot) {
  return (
    snapshot.overdue_rent_count > 0 ||
    snapshot.new_ticket_count > 0 ||
    snapshot.urgent_open_ticket_count > 0 ||
    snapshot.stale_ticket_count > 0 ||
    snapshot.upcoming_compliance_count > 0 ||
    snapshot.awaiting_approvals_count > 0
  )
}

function hasPortfolioData(snapshot: PortfolioVisibilitySnapshot) {
  return (
    snapshot.active_tenant_count > 0 ||
    snapshot.occupied_property_count > 0 ||
    snapshot.vacant_property_count > 0 ||
    snapshot.open_ticket_count > 0 ||
    snapshot.new_ticket_count > 0 ||
    snapshot.overdue_rent_count > 0 ||
    snapshot.upcoming_compliance_count > 0 ||
    Boolean(snapshot.payload.cash_flow_summary.latest_monthly_snapshot || snapshot.payload.cash_flow_summary.latest_annual_snapshot)
  )
}

function ticketUrgency(subject: string, message: string): 'urgent' | 'normal' {
  return urgentTicketPattern.test(`${subject}\n${message}`) ? 'urgent' : 'normal'
}

function ageInDays(isoDate: string, now: Date) {
  const parsed = new Date(isoDate)
  if (Number.isNaN(parsed.getTime())) {
    return 0
  }

  return Math.max(0, Math.floor((now.getTime() - parsed.getTime()) / (24 * 60 * 60 * 1000)))
}

function toTicketHighlight(ticket: TicketRow, now: Date): PortfolioTicketHighlight {
  return {
    id: ticket.id,
    subject: ticket.subject,
    status: ticket.status,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    tenant_name: ticket.tenants?.full_name ?? null,
    tenant_access_id: ticket.tenants?.tenant_access_id ?? null,
    property_name: ticket.tenants?.properties?.property_name ?? null,
    unit_number: ticket.tenants?.properties?.unit_number ?? null,
    urgency: ticketUrgency(ticket.subject, ticket.message),
    age_days: ageInDays(ticket.updated_at, now),
  }
}

function dedupeTickets(rows: TicketRow[]) {
  const seen = new Set<string>()
  const items: TicketRow[] = []
  for (const row of rows) {
    if (seen.has(row.id)) {
      continue
    }
    seen.add(row.id)
    items.push(row)
  }
  return items
}

function toAlertWindowDate(hours: number, now: Date) {
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString()
}

async function listOwnersForPortfolioVisibility() {
  const { data, error } = await supabaseAdmin
    .from('owners')
    .select(
      'id, email, full_name, company_name, support_email, organization_id, organizations(name, slug, currency_code), owner_automation_settings(daily_digest_enabled, weekly_digest_enabled, monthly_digest_enabled, portfolio_visibility_enabled)',
    )

  throwIfError(error, 'Failed to load owners for portfolio visibility')
  return (data ?? []) as OwnerRow[]
}

async function loadOwnerProperties(ownerId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('properties')
    .select('id, property_name, unit_number')
    .eq('owner_id', ownerId)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })

  throwIfError(error, 'Failed to load owner properties for portfolio visibility')
  return (data ?? []) as PropertyRow[]
}

async function loadOwnerActiveTenants(ownerId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id, property_id, full_name, tenant_access_id, monthly_rent, payment_status')
    .eq('owner_id', ownerId)
    .eq('organization_id', organizationId)
    .eq('status', 'active')

  throwIfError(error, 'Failed to load active tenants for portfolio visibility')
  return (data ?? []) as ActiveTenantRow[]
}

async function loadOwnerOpenTickets(ownerId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .select(
      'id, subject, message, status, created_at, updated_at, tenants(id, full_name, tenant_access_id, properties(id, property_name, unit_number))',
    )
    .eq('owner_id', ownerId)
    .eq('organization_id', organizationId)
    .in('status', ['open', 'in_progress'])
    .order('updated_at', { ascending: false })
    .limit(100)

  throwIfError(error, 'Failed to load open tickets for portfolio visibility')
  return (data ?? []) as unknown as TicketRow[]
}

async function loadOwnerRecentTickets(ownerId: string, organizationId: string, periodStartIso: string) {
  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .select(
      'id, subject, message, status, created_at, updated_at, tenants(id, full_name, tenant_access_id, properties(id, property_name, unit_number))',
    )
    .eq('owner_id', ownerId)
    .eq('organization_id', organizationId)
    .gte('created_at', periodStartIso)
    .order('created_at', { ascending: false })
    .limit(100)

  throwIfError(error, 'Failed to load recent tickets for portfolio visibility')
  return (data ?? []) as unknown as TicketRow[]
}

async function countPendingReminders(ownerId: string, organizationId: string) {
  const { count, error } = await supabaseAdmin
    .from('rent_reminders')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
    .eq('organization_id', organizationId)
    .eq('status', 'pending')

  throwIfError(error, 'Failed to count pending reminders for portfolio visibility')
  return count ?? 0
}

async function countAwaitingApprovals(ownerId: string, organizationId: string) {
  const { count, error } = await supabaseAdmin
    .from('rent_payment_approvals')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', ownerId)
    .eq('organization_id', organizationId)
    .eq('status', 'awaiting_owner_approval')

  throwIfError(error, 'Failed to count awaiting approvals for portfolio visibility')
  return count ?? 0
}

async function listRecentAlerts(ownerId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('owner_notifications')
    .select('id, notification_type, title, message, is_read, created_at, tenant_id, tenants(id, full_name, tenant_access_id)')
    .eq('owner_id', ownerId)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(recentAlertsLimit)

  throwIfError(error, 'Failed to load recent portfolio alerts')
  return (data ?? []) as unknown as AlertRow[]
}
async function loadLatestCashFlowSignals(ownerId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('cash_flow_report_snapshots')
    .select('id, report_scope, report_label, currency_code, portfolio_net_income, portfolio_yield_percent, created_at')
    .eq('owner_id', ownerId)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(12)

  if (error && !error.message.toLowerCase().includes('cash_flow_report_snapshots')) {
    throwIfError(error, 'Failed to load cash-flow signals for portfolio visibility')
  }

  const rows = (data ?? []) as CashFlowSignalRow[]
  return {
    latest_monthly_snapshot: rows.find((row) => row.report_scope === 'monthly') ?? null,
    latest_annual_snapshot: rows.find((row) => row.report_scope === 'annual') ?? null,
  }
}

function buildPropertyLookup(properties: PropertyRow[]) {
  return new Map<string, PropertyRow>(properties.map((property) => [property.id, property]))
}

function deriveOccupancy(properties: PropertyRow[], tenants: ActiveTenantRow[]) {
  const occupiedPropertyIds = new Set(tenants.map((tenant) => tenant.property_id))
  const vacantProperties = properties
    .filter((property) => !occupiedPropertyIds.has(property.id))
    .map<PortfolioVacancyHighlight>((property) => ({
      property_id: property.id,
      property_name: property.property_name,
      unit_number: property.unit_number,
    }))

  return {
    occupiedPropertyCount: occupiedPropertyIds.size,
    vacantProperties,
  }
}

function deriveOverdueItems(tenants: ActiveTenantRow[], propertyLookup: Map<string, PropertyRow>) {
  return tenants
    .filter((tenant) => tenant.payment_status === 'overdue')
    .map<PortfolioOverdueItem>((tenant) => {
      const property = propertyLookup.get(tenant.property_id)
      return {
        tenant_id: tenant.id,
        tenant_name: tenant.full_name,
        tenant_access_id: tenant.tenant_access_id,
        property_id: tenant.property_id,
        property_name: property?.property_name ?? null,
        unit_number: property?.unit_number ?? null,
        monthly_rent: Number(tenant.monthly_rent ?? 0),
      }
    })
}

function deriveTicketSignals(input: { openTickets: TicketRow[]; recentTickets: TicketRow[]; now: Date }) {
  const openHighlights = input.openTickets.map((ticket) => toTicketHighlight(ticket, input.now))
  const recentHighlights = dedupeTickets([...input.recentTickets, ...input.openTickets]).map((ticket) =>
    toTicketHighlight(ticket, input.now),
  )
  const staleThresholdMs = staleTicketHours * 60 * 60 * 1000

  return {
    openTicketCount: input.openTickets.length,
    newTicketCount: input.recentTickets.length,
    recent: recentHighlights.slice(0, 6),
    urgentOpen: openHighlights.filter((ticket) => ticket.urgency === 'urgent').slice(0, 5),
    staleOpen: openHighlights
      .filter((ticket) => ticket.status !== 'resolved' && ticket.status !== 'closed')
      .filter((ticket) => {
        const updatedAt = new Date(ticket.updated_at)
        return !Number.isNaN(updatedAt.getTime()) && input.now.getTime() - updatedAt.getTime() >= staleThresholdMs
      })
      .slice(0, 5),
  }
}

async function buildOwnerPortfolioSnapshot(input: {
  owner: OwnerRow
  scope: SnapshotScope
  triggerType: TriggerType
  now: Date
  periodStart: Date
  periodEnd: Date
}) {
  const periodStartIso = input.periodStart.toISOString()
  const [properties, activeTenants, openTickets, recentTickets, remindersPendingCount, awaitingApprovalsCount, compliance, cashFlowSummary] =
    await Promise.all([
      loadOwnerProperties(input.owner.id, input.owner.organization_id),
      loadOwnerActiveTenants(input.owner.id, input.owner.organization_id),
      loadOwnerOpenTickets(input.owner.id, input.owner.organization_id),
      loadOwnerRecentTickets(input.owner.id, input.owner.organization_id, periodStartIso),
      countPendingReminders(input.owner.id, input.owner.organization_id),
      countAwaitingApprovals(input.owner.id, input.owner.organization_id),
      getOwnerComplianceOverview(input.owner.id, input.owner.organization_id, input.now),
      loadLatestCashFlowSignals(input.owner.id, input.owner.organization_id),
    ])

  const propertyLookup = buildPropertyLookup(properties)
  const occupancy = deriveOccupancy(properties, activeTenants)
  const overdueItems = deriveOverdueItems(activeTenants, propertyLookup)
  const ticketSignals = deriveTicketSignals({ openTickets, recentTickets, now: input.now })
  const currencyCode = normalizeCurrencyCode(
    input.owner.organizations?.currency_code ?? cashFlowSummary.latest_monthly_snapshot?.currency_code,
  )

  return {
    snapshot_scope: input.scope,
    trigger_type: input.triggerType,
    snapshot_label:
      input.scope === 'current'
        ? `Current portfolio snapshot | ${new Intl.DateTimeFormat('en-GB', {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(input.now)}`
        : `${input.scope[0].toUpperCase()}${input.scope.slice(1)} portfolio snapshot`,
    period_start: toDateOnly(input.periodStart),
    period_end: toDateOnly(input.periodEnd),
    currency_code: currencyCode,
    active_tenant_count: activeTenants.length,
    open_ticket_count: ticketSignals.openTicketCount,
    new_ticket_count: ticketSignals.newTicketCount,
    urgent_open_ticket_count: ticketSignals.urgentOpen.length,
    stale_ticket_count: ticketSignals.staleOpen.length,
    overdue_rent_count: overdueItems.length,
    reminders_pending_count: remindersPendingCount,
    awaiting_approvals_count: awaitingApprovalsCount,
    occupied_property_count: occupancy.occupiedPropertyCount,
    vacant_property_count: occupancy.vacantProperties.length,
    upcoming_compliance_count: compliance.upcoming_items.length,
    payload: {
      ticket_highlights: {
        recent: ticketSignals.recent,
        urgent_open: ticketSignals.urgentOpen,
        stale_open: ticketSignals.staleOpen,
      },
      overdue_rent_items: overdueItems.slice(0, 6),
      compliance_highlights: compliance.upcoming_items.slice(0, 6),
      vacancy_highlights: occupancy.vacantProperties.slice(0, 6),
      cash_flow_summary: cashFlowSummary,
    },
  } satisfies PortfolioVisibilitySnapshot
}

async function persistPortfolioSnapshot(input: {
  organizationId: string
  ownerId: string
  snapshot: PortfolioVisibilitySnapshot
  automationJobId?: string | null
}) {
  const { data, error } = await supabaseAdmin
    .from('portfolio_visibility_snapshots')
    .insert({
      organization_id: input.organizationId,
      owner_id: input.ownerId,
      automation_job_id: input.automationJobId ?? null,
      snapshot_scope: input.snapshot.snapshot_scope,
      trigger_type: input.snapshot.trigger_type,
      snapshot_label: input.snapshot.snapshot_label,
      period_start: input.snapshot.period_start,
      period_end: input.snapshot.period_end,
      currency_code: input.snapshot.currency_code,
      active_tenant_count: input.snapshot.active_tenant_count,
      open_ticket_count: input.snapshot.open_ticket_count,
      new_ticket_count: input.snapshot.new_ticket_count,
      urgent_open_ticket_count: input.snapshot.urgent_open_ticket_count,
      stale_ticket_count: input.snapshot.stale_ticket_count,
      overdue_rent_count: input.snapshot.overdue_rent_count,
      reminders_pending_count: input.snapshot.reminders_pending_count,
      awaiting_approvals_count: input.snapshot.awaiting_approvals_count,
      occupied_property_count: input.snapshot.occupied_property_count,
      vacant_property_count: input.snapshot.vacant_property_count,
      upcoming_compliance_count: input.snapshot.upcoming_compliance_count,
      payload: input.snapshot.payload,
    })
    .select('id')
    .single()

  throwIfError(error, 'Failed to persist portfolio visibility snapshot')
  return String(data?.id)
}

async function createPortfolioInAppNotification(input: {
  organizationId: string
  ownerId: string
  tenantId?: string | null
  templateKey: 'portfolio_daily_digest' | 'portfolio_weekly_digest' | 'portfolio_monthly_digest' | 'portfolio_event_alert'
  fallbackTitle: string
  fallbackBody: string
  variables: Record<string, unknown>
}) {
  const resolved = await resolveAutomationMessageTemplate({
    organizationId: input.organizationId,
    templateKey: input.templateKey,
    channel: 'in_app',
    fallbackSubject: input.fallbackTitle,
    fallbackBody: input.fallbackBody,
    variables: input.variables,
  })

  await createOwnerNotification({
    organization_id: input.organizationId,
    owner_id: input.ownerId,
    tenant_id: input.tenantId ?? null,
    notification_type: input.templateKey,
    title: resolved.subject ?? input.fallbackTitle,
    message: resolved.body,
  })
}

function buildDigestSummaryLine(snapshot: PortfolioVisibilitySnapshot) {
  return [
    `${snapshot.overdue_rent_count} overdue rent item${snapshot.overdue_rent_count === 1 ? '' : 's'}`,
    `${snapshot.open_ticket_count} open ticket${snapshot.open_ticket_count === 1 ? '' : 's'}`,
    `${snapshot.upcoming_compliance_count} compliance milestone${snapshot.upcoming_compliance_count === 1 ? '' : 's'}`,
  ].join(', ')
}
async function sendDigest(input: {
  owner: OwnerRow
  frequency: DigestFrequency
  snapshot: PortfolioVisibilitySnapshot
  window: SnapshotWindow
}) {
  const labels = frequencyLabels(input.frequency, input.window, ownerDisplayName(input.owner))
  const monthlyCashFlow = input.snapshot.payload.cash_flow_summary.latest_monthly_snapshot
  const annualCashFlow = input.snapshot.payload.cash_flow_summary.latest_annual_snapshot
  const variables = {
    ownerName: ownerDisplayName(input.owner),
    snapshotLabel: input.window.label,
    activeTenantCount: input.snapshot.active_tenant_count,
    openTicketCount: input.snapshot.open_ticket_count,
    newTicketCount: input.snapshot.new_ticket_count,
    urgentOpenTicketCount: input.snapshot.urgent_open_ticket_count,
    staleTicketCount: input.snapshot.stale_ticket_count,
    overdueRentCount: input.snapshot.overdue_rent_count,
    remindersPendingCount: input.snapshot.reminders_pending_count,
    awaitingApprovalsCount: input.snapshot.awaiting_approvals_count,
    occupiedPropertyCount: input.snapshot.occupied_property_count,
    vacantPropertyCount: input.snapshot.vacant_property_count,
    upcomingComplianceCount: input.snapshot.upcoming_compliance_count,
    cashFlowNetIncome: monthlyCashFlow
      ? formatCurrencyLabel(monthlyCashFlow.portfolio_net_income, input.snapshot.currency_code)
      : 'Not available',
    cashFlowAnnualYield:
      typeof annualCashFlow?.portfolio_yield_percent === 'number'
        ? `${annualCashFlow.portfolio_yield_percent}%`
        : 'Not available',
  }

  const fallbackBody = buildDigestSummaryLine(input.snapshot)
  await createPortfolioInAppNotification({
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    templateKey: labels.templateKey,
    fallbackTitle: labels.title,
    fallbackBody,
    variables,
  })

  const complianceLines = input.snapshot.payload.compliance_highlights.slice(0, 3).map((item) => {
    const unit = item.unit_number ? `Unit ${item.unit_number}` : 'Unit not provided'
    return `${item.property_name} (${unit}) | ${item.trigger_label} in ${item.days_remaining} days`
  })

  const noteBody =
    input.frequency === 'daily'
      ? 'Daily visibility is intentionally low-noise and only arrives when something material requires review.'
      : 'These summaries are generated from organization-scoped tenant, ticket, rent, and compliance signals inside Prophives.'

  await deliverOwnerAutomationMessage({
    organizationId: input.owner.organization_id,
    ownerId: input.owner.id,
    templateKey: labels.templateKey,
    templateVariables: variables,
    email: {
      subject: labels.subject,
      preheader: labels.preheader,
      eyebrow: labels.eyebrow,
      title: labels.title,
      intro: labels.intro,
      details: [
        {
          label: 'Overdue Rent',
          value: String(input.snapshot.overdue_rent_count),
          emphasize: true,
          tone: input.snapshot.overdue_rent_count > 0 ? 'security' : 'accent',
        },
        { label: 'Open Tickets', value: String(input.snapshot.open_ticket_count), emphasize: true },
        { label: 'New Tickets', value: String(input.snapshot.new_ticket_count) },
        {
          label: 'Urgent Open Tickets',
          value: String(input.snapshot.urgent_open_ticket_count),
          emphasize: true,
          tone: input.snapshot.urgent_open_ticket_count > 0 ? 'security' : 'accent',
        },
        { label: 'Stale Tickets', value: String(input.snapshot.stale_ticket_count) },
        { label: 'Upcoming Compliance', value: String(input.snapshot.upcoming_compliance_count), emphasize: true },
        {
          label: 'Occupied / Vacant',
          value: `${input.snapshot.occupied_property_count} / ${input.snapshot.vacant_property_count}`,
        },
        { label: 'Awaiting Approvals', value: String(input.snapshot.awaiting_approvals_count) },
        ...(input.frequency === 'monthly'
          ? [
              {
                label: 'Latest Net Income',
                value: variables.cashFlowNetIncome,
                emphasize: true,
                tone: 'accent' as const,
              },
              {
                label: 'Trailing Yield',
                value: variables.cashFlowAnnualYield,
                emphasize: true,
                tone: 'accent' as const,
              },
            ]
          : []),
      ],
      body: [
        complianceLines.length > 0
          ? `Upcoming compliance focus: ${complianceLines.join('; ')}.`
          : 'No compliance milestones are currently inside the active summary window.',
        input.snapshot.payload.vacancy_highlights.length > 0
          ? `Vacancy watch: ${input.snapshot.payload.vacancy_highlights
              .slice(0, 3)
              .map((item) => `${item.property_name}${item.unit_number ? ` (${item.unit_number})` : ''}`)
              .join(', ')}.`
          : 'All tracked properties currently show occupied coverage or no active vacancy highlights.',
      ],
      note: {
        title: 'Alert discipline',
        body: noteBody,
        tone: input.frequency === 'daily' ? 'info' : 'warning',
      },
      cta: {
        label: input.frequency === 'daily' ? 'Open owner dashboard' : 'Open automation center',
        url: input.frequency === 'daily' ? ownerDashboardUrl() : ownerAutomationUrl(),
      },
      footer: ['Portfolio summaries are generated from organization-scoped rent, support, compliance, and occupancy data.'],
    },
    telegram: {
      fallbackText: [
        labels.title,
        `Overdue rent: ${input.snapshot.overdue_rent_count}`,
        `Open tickets: ${input.snapshot.open_ticket_count}`,
        `Urgent tickets: ${input.snapshot.urgent_open_ticket_count}`,
        `Upcoming compliance: ${input.snapshot.upcoming_compliance_count}`,
        `Occupied / vacant: ${input.snapshot.occupied_property_count} / ${input.snapshot.vacant_property_count}`,
      ].join('\n'),
    },
    whatsapp: {
      fallbackText: `${labels.title}: ${buildDigestSummaryLine(input.snapshot)}.`,
    },
  })
}

async function runPortfolioDigest(now: Date, frequency: DigestFrequency, options?: { jobId?: string | null }) {
  const owners = await listOwnersForPortfolioVisibility()
  const window = buildSnapshotWindow(frequency, now)

  let ownersEvaluated = 0
  let digestsSent = 0
  let skippedQuiet = 0
  let failures = 0
  const snapshotIds: string[] = []

  for (const owner of owners) {
    if (!isDigestEnabled(owner, frequency)) {
      continue
    }

    ownersEvaluated += 1

    try {
      const snapshot = await buildOwnerPortfolioSnapshot({
        owner,
        scope: window.scope,
        triggerType: 'schedule',
        now,
        periodStart: window.periodStart,
        periodEnd: window.periodEnd,
      })

      const shouldSend = frequency === 'daily' ? hasMaterialDailySignal(snapshot) : hasPortfolioData(snapshot)
      if (!shouldSend) {
        skippedQuiet += 1
        continue
      }

      const snapshotId = await persistPortfolioSnapshot({
        organizationId: owner.organization_id,
        ownerId: owner.id,
        snapshot,
        automationJobId: options?.jobId ?? null,
      })
      snapshotIds.push(snapshotId)

      await sendDigest({
        owner,
        frequency,
        snapshot,
        window,
      })

      digestsSent += 1
    } catch (error) {
      failures += 1
      if (options?.jobId) {
        await recordAutomationError({
          jobId: options.jobId,
          organizationId: owner.organization_id,
          ownerId: owner.id,
          flowName: `portfolio_${frequency}_digest`,
          errorMessage: error instanceof Error ? error.message : 'portfolio_digest_failed',
          context: {
            frequency,
            owner_id: owner.id,
            organization_id: owner.organization_id,
            snapshot_label: window.label,
          },
        })
      }
    }
  }

  return {
    frequency,
    snapshot_label: window.label,
    owners_evaluated: ownersEvaluated,
    digests_sent: digestsSent,
    skipped_quiet: skippedQuiet,
    failures,
    portfolio_visibility_snapshot_ids: snapshotIds,
  }
}

export function runDailyPortfolioVisibility(now = new Date(), options?: { jobId?: string | null }) {
  return runPortfolioDigest(now, 'daily', options)
}

export function runWeeklyPortfolioVisibility(now = new Date(), options?: { jobId?: string | null }) {
  return runPortfolioDigest(now, 'weekly', options)
}

export function runMonthlyPortfolioVisibility(now = new Date(), options?: { jobId?: string | null }) {
  return runPortfolioDigest(now, 'monthly', options)
}

export async function attachPortfolioVisibilitySnapshotsToRun(snapshotIds: string[], runId: string) {
  if (snapshotIds.length === 0) {
    return
  }

  const { error } = await supabaseAdmin
    .from('portfolio_visibility_snapshots')
    .update({
      automation_run_id: runId,
    })
    .in('id', snapshotIds)

  throwIfError(error, 'Failed to attach portfolio visibility snapshots to automation run')
}

async function listOwnerSnapshots(ownerId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('portfolio_visibility_snapshots')
    .select(
      'id, owner_id, organization_id, snapshot_scope, trigger_type, snapshot_label, period_start, period_end, currency_code, active_tenant_count, open_ticket_count, new_ticket_count, urgent_open_ticket_count, stale_ticket_count, overdue_rent_count, reminders_pending_count, awaiting_approvals_count, occupied_property_count, vacant_property_count, upcoming_compliance_count, payload, created_at',
    )
    .eq('owner_id', ownerId)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(12)

  if (error && !error.message.toLowerCase().includes('portfolio_visibility_snapshots')) {
    throwIfError(error, 'Failed to load owner portfolio visibility history')
  }

  return (data ?? []) as PortfolioVisibilitySnapshotRow[]
}

async function listAdminSnapshots(organizationId?: string) {
  let request = supabaseAdmin
    .from('portfolio_visibility_snapshots')
    .select(
      'id, owner_id, organization_id, snapshot_scope, trigger_type, snapshot_label, period_start, period_end, currency_code, active_tenant_count, open_ticket_count, new_ticket_count, urgent_open_ticket_count, stale_ticket_count, overdue_rent_count, reminders_pending_count, awaiting_approvals_count, occupied_property_count, vacant_property_count, upcoming_compliance_count, payload, created_at, owners(full_name, company_name, email), organizations(name, slug)',
    )
    .order('created_at', { ascending: false })
    .limit(20)

  if (organizationId) {
    request = request.eq('organization_id', organizationId)
  }

  const { data, error } = await request
  if (error && !error.message.toLowerCase().includes('portfolio_visibility_snapshots')) {
    throwIfError(error, 'Failed to load admin portfolio visibility history')
  }

  return (data ?? []) as PortfolioVisibilitySnapshotRow[]
}
export async function getOwnerPortfolioVisibilityOverview(
  ownerId: string,
  organizationId: string,
  now = new Date(),
): Promise<OwnerPortfolioVisibilityOverview> {
  const periodStart = startOfUtcDay(daysAgo(now, 1))
  const periodEnd = endOfUtcDay(now)

  const [owners, recentAlerts, recentSnapshots] = await Promise.all([
    listOwnersForPortfolioVisibility(),
    listRecentAlerts(ownerId, organizationId),
    listOwnerSnapshots(ownerId, organizationId),
  ])

  const owner = owners.find((item) => item.id === ownerId && item.organization_id === organizationId)
  if (!owner) {
    throw new AppError('Owner not found', 404)
  }

  const currentSnapshot = await buildOwnerPortfolioSnapshot({
    owner,
    scope: 'current',
    triggerType: 'manual',
    now,
    periodStart,
    periodEnd,
  })

  return {
    current_snapshot: {
      ...currentSnapshot,
      generated_at: now.toISOString(),
    },
    latest_daily_snapshot: recentSnapshots.find((snapshot) => snapshot.snapshot_scope === 'daily') ?? null,
    latest_weekly_snapshot: recentSnapshots.find((snapshot) => snapshot.snapshot_scope === 'weekly') ?? null,
    latest_monthly_snapshot: recentSnapshots.find((snapshot) => snapshot.snapshot_scope === 'monthly') ?? null,
    recent_snapshots: recentSnapshots,
    recent_alerts: recentAlerts,
  }
}

export async function getAdminPortfolioVisibilityOverview(input?: {
  organizationId?: string
}): Promise<AdminPortfolioVisibilityOverview> {
  const recentSnapshots = await listAdminSnapshots(input?.organizationId)
  return {
    recent_snapshots: recentSnapshots,
  }
}

export async function notifyOwnerRentOverdueAlert(input: {
  organizationId: string
  ownerId: string
  tenantId: string
  tenantName: string
  tenantAccessId: string
  propertyName: string | null
  unitNumber: string | null
  dueDateIso: string
  amountDue: number
  currencyCode: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const duplicateWindowIso = toAlertWindowDate(36, now)

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('owner_notifications')
    .select('id')
    .eq('owner_id', input.ownerId)
    .eq('organization_id', input.organizationId)
    .eq('tenant_id', input.tenantId)
    .eq('notification_type', 'portfolio_event_alert')
    .gte('created_at', duplicateWindowIso)
    .order('created_at', { ascending: false })
    .limit(5)

  throwIfError(existingError, 'Failed to inspect existing rent overdue alerts')

  if ((existing ?? []).length > 0) {
    return { sent: false, reason: 'recent_alert_exists' as const }
  }

  const dueDateLabel = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(
    new Date(`${input.dueDateIso}T00:00:00.000Z`),
  )
  const amountLabel = formatCurrencyLabel(input.amountDue, input.currencyCode)
  const propertyLabel = input.propertyName
    ? `${input.propertyName}${input.unitNumber ? ` (${input.unitNumber})` : ''}`
    : 'the assigned property'
  const alertTitle = `Rent overdue | ${input.tenantName}`
  const alertSummary = `${input.tenantName} (${input.tenantAccessId}) is overdue on ${amountLabel} for ${propertyLabel}. Due date: ${dueDateLabel}.`
  const ownerAction = 'Review resident payment status and follow up if payment has not been confirmed.'
  const variables = {
    alertTitle,
    alertSummary,
    ownerAction,
    tenantName: input.tenantName,
    tenantAccessId: input.tenantAccessId,
    propertyName: input.propertyName ?? 'Property not provided',
    unitNumber: input.unitNumber ?? 'Not provided',
    dueDateLabel,
    amountDue: amountLabel,
  }

  await createPortfolioInAppNotification({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    tenantId: input.tenantId,
    templateKey: 'portfolio_event_alert',
    fallbackTitle: alertTitle,
    fallbackBody: alertSummary,
    variables,
  })

  await deliverOwnerAutomationMessage({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    templateKey: 'portfolio_event_alert',
    templateVariables: variables,
    email: {
      subject: alertTitle,
      preheader: `${input.tenantName} is overdue on rent for ${propertyLabel}.`,
      eyebrow: 'Portfolio Event Alert',
      title: alertTitle,
      intro: [
        'A portfolio event needs attention.',
        `${input.tenantName} has crossed the rent due date without an approved payment confirmation.`,
      ],
      details: [
        { label: 'Tenant', value: input.tenantName, emphasize: true, tone: 'accent' },
        { label: 'Tenant Access ID', value: input.tenantAccessId },
        { label: 'Property', value: input.propertyName ?? 'Not provided' },
        { label: 'Unit', value: input.unitNumber ?? 'Not provided' },
        { label: 'Amount Due', value: amountLabel, emphasize: true, tone: 'security' },
        { label: 'Due Date', value: dueDateLabel, emphasize: true },
      ],
      body: [alertSummary],
      note: {
        title: 'Low-noise alerting',
        body: 'Prophives suppresses repeated overdue alerts for the same resident inside a short cooldown window to avoid inbox fatigue.',
        tone: 'info',
      },
      cta: {
        label: 'Open owner dashboard',
        url: ownerDashboardUrl(),
      },
    },
    telegram: {
      fallbackText: ['Portfolio event alert', alertSummary, `Next action: ${ownerAction}`].join('\n'),
    },
    whatsapp: {
      fallbackText: `${alertSummary} ${ownerAction}`,
    },
  })

  return { sent: true }
}
