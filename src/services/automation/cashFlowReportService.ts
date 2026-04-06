import { env } from '../../config/env.js'
import { AppError } from '../../lib/errors.js'
import { prisma } from '../../lib/db.js'
import { createOwnerNotification } from '../ownerService.js'
import { recordAutomationError } from './core/runLogger.js'
import { resolveAutomationMessageTemplate } from './messageTemplateService.js'
import { deliverOwnerAutomationMessage } from './providers/messageProvider.js'

export type CashFlowReportScope = 'current' | 'monthly' | 'annual'

type TriggerType = 'schedule' | 'event' | 'manual'

type OwnerRow = {
  id: string
  email: string
  full_name: string | null
  company_name: string | null
  support_email: string | null
  organization_id: string
  organizations?: { name?: string | null; slug?: string | null; currency_code?: string | null } | null
  owner_automation_settings?: Array<{
    cash_flow_reporting_enabled: boolean | null
    monthly_digest_enabled: boolean | null
    portfolio_visibility_enabled: boolean | null
    yield_alert_threshold_percent: number | null
    yield_alert_cooldown_days: number | null
  }> | null
}

type PropertyRow = { id: string; organization_id: string; owner_id: string; property_name: string; unit_number: string | null }
type ProfileRow = { property_id: string; service_charge_monthly: number | null; agency_fee_monthly: number | null; property_value: number | null; target_yield_percent: number | null }
type LedgerRow = { owner_id: string; property_id: string; due_date: string; amount_due: number | null; amount_paid: number | null }
type MaintenanceRow = { owner_id: string; property_id: string; amount: number | null; incurred_on: string }

type Period = {
  scope: CashFlowReportScope; reportYear: number; reportMonth: number; reportLabel: string; reportPeriodKey: string; periodStart: Date; periodEnd: Date; monthsInPeriod: number
}

type PropertyMetric = {
  property_id: string; property_name: string; unit_number: string | null; gross_rent_due: number; gross_rent_received: number; maintenance_costs: number; service_charges: number; agency_fees: number; fixed_charges: number; net_income: number; yield_percent: number | null; property_value: number | null; target_yield_percent: number | null; below_target: boolean
}

type PortfolioMetric = {
  report_scope: CashFlowReportScope; report_label: string; report_year: number; report_month: number; report_period_key: string; period_start: string; period_end: string; currency_code: string; property_count: number; gross_rent_due: number; gross_rent_received: number; maintenance_costs: number; service_charges: number; agency_fees: number; fixed_charges: number; net_income: number; yield_percent: number | null; target_yield_threshold_percent: number | null; below_target: boolean
}

type YieldAlertItem = { signature: string; kind: 'portfolio' | 'property'; label: string; actual_yield_percent: number; threshold_percent: number; property_id?: string }

type CashFlowReport = { owner_id: string; organization_id: string; currency_code: string; portfolio: PortfolioMetric; properties: PropertyMetric[]; below_target_items: YieldAlertItem[] }

type SnapshotRow = {
  id: string; owner_id: string; organization_id: string; automation_run_id?: string | null; report_scope: CashFlowReportScope; trigger_type: TriggerType; report_label: string; report_year: number; report_month: number; report_period_key: string; period_start: string; period_end: string; currency_code: string; property_count: number; portfolio_gross_rent: number; portfolio_maintenance: number; portfolio_fixed_charges: number; portfolio_net_income: number; portfolio_yield_percent: number | null; below_target_count: number; alerts_sent: string[]; payload: { portfolio: PortfolioMetric; properties: PropertyMetric[]; below_target_items: YieldAlertItem[] }; created_at: string; owners?: { full_name?: string | null; company_name?: string | null; email?: string | null } | null; organizations?: { name?: string | null; slug?: string | null } | null
}

type MaintenanceCostEntryRecord = {
  id: string; organization_id: string; owner_id: string; property_id: string; amount: number; incurred_on: string; status: 'recorded' | 'voided'; source_type: 'manual' | 'ticket' | 'invoice' | 'automation'; vendor_name: string | null; description: string | null; invoice_ref: string | null; source_ticket_id: string | null
}

function safeNumber(value: unknown) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function roundToTwo(value: number) {
  return Number(value.toFixed(2))
}

function normalizeCurrencyCode(currencyCode: string | null | undefined) {
  const normalized = currencyCode?.trim().toUpperCase()
  return normalized || 'INR'
}

function toCurrencyLabel(amount: number, currencyCode: string) {
  const normalized = normalizeCurrencyCode(currencyCode)
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: normalized, maximumFractionDigits: 0 }).format(amount)
  } catch {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount)
  }
}

function toDateOnly(value: Date) {
  return value.toISOString().slice(0, 10)
}

function monthLabel(year: number, month: number) {
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)))
}

function startOfUtcMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0))
}

function endOfUtcMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0, 23, 59, 59, 999))
}

function previousMonthAnchor(now: Date) {
  const anchor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return { year: anchor.getUTCFullYear(), month: anchor.getUTCMonth() + 1 }
}

function resolvePeriod(input: { scope: CashFlowReportScope; now?: Date; year?: number; month?: number }): Period {
  const now = input.now ?? new Date()
  if (input.scope === 'current') {
    const year = input.year ?? now.getUTCFullYear()
    const month = input.month ?? now.getUTCMonth() + 1
    return { scope: 'current', reportYear: year, reportMonth: month, reportLabel: `${monthLabel(year, month)} | Month to date`, reportPeriodKey: `${year}-${String(month).padStart(2, '0')}:current`, periodStart: startOfUtcMonth(year, month), periodEnd: year === now.getUTCFullYear() && month === now.getUTCMonth() + 1 ? now : endOfUtcMonth(year, month), monthsInPeriod: 1 }
  }
  if (input.scope === 'monthly') {
    const ref = typeof input.year === 'number' && typeof input.month === 'number' ? { year: input.year, month: input.month } : previousMonthAnchor(now)
    return { scope: 'monthly', reportYear: ref.year, reportMonth: ref.month, reportLabel: monthLabel(ref.year, ref.month), reportPeriodKey: `${ref.year}-${String(ref.month).padStart(2, '0')}:monthly`, periodStart: startOfUtcMonth(ref.year, ref.month), periodEnd: endOfUtcMonth(ref.year, ref.month), monthsInPeriod: 1 }
  }
  const ref = typeof input.year === 'number' && typeof input.month === 'number' ? { year: input.year, month: input.month } : { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
  return { scope: 'annual', reportYear: ref.year, reportMonth: ref.month, reportLabel: `Trailing 12 months ending ${monthLabel(ref.year, ref.month)}`, reportPeriodKey: `${ref.year}-${String(ref.month).padStart(2, '0')}:annual`, periodStart: startOfUtcMonth(ref.year, ref.month - 11), periodEnd: endOfUtcMonth(ref.year, ref.month), monthsInPeriod: 12 }
}

function ownerDisplayName(owner: OwnerRow) {
  return owner.full_name || owner.company_name || owner.email
}

function buildOwnerAutomationUrl() {
  return new URL('/owner/automation', `${env.FRONTEND_URL.replace(/\/$/, '')}/`).toString()
}

function ownerSettings(owner: OwnerRow) {
  const row = owner.owner_automation_settings?.[0]
  return {
    cashFlowReportingEnabled: row?.cash_flow_reporting_enabled ?? true,
    monthlyDigestEnabled: row?.monthly_digest_enabled ?? false,
    portfolioVisibilityEnabled: row?.portfolio_visibility_enabled ?? true,
    yieldAlertThresholdPercent: row?.yield_alert_threshold_percent ?? null,
    yieldAlertCooldownDays: row?.yield_alert_cooldown_days ?? 7,
  }
}

function normalizeOwnerRow(row: Record<string, unknown>): OwnerRow {
  const orgs = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations
  const settings = Array.isArray(row.owner_automation_settings) ? row.owner_automation_settings : (row.owner_automation_settings ? [row.owner_automation_settings] : null)
  return {
    id: String(row.id),
    email: String(row.email),
    full_name: (row.full_name as string | null) ?? null,
    company_name: (row.company_name as string | null) ?? null,
    support_email: (row.support_email as string | null) ?? null,
    organization_id: String(row.organization_id),
    organizations: (orgs as OwnerRow['organizations']) ?? null,
    owner_automation_settings: (settings as OwnerRow['owner_automation_settings']) ?? null,
  }
}

async function listOwners(input?: { ownerId?: string; organizationId?: string }): Promise<OwnerRow[]> {
  const where: Record<string, unknown> = {}
  if (input?.ownerId) where.id = input.ownerId
  if (input?.organizationId) where.organization_id = input.organizationId

  const data = await prisma.owners.findMany({
    select: { id: true, email: true, full_name: true, company_name: true, support_email: true, organization_id: true, organizations: { select: { name: true, slug: true, currency_code: true } }, owner_automation_settings: { select: { cash_flow_reporting_enabled: true, monthly_digest_enabled: true, portfolio_visibility_enabled: true, yield_alert_threshold_percent: true, yield_alert_cooldown_days: true } } },
    where,
  })

  return data.map((row) => normalizeOwnerRow(row as unknown as Record<string, unknown>))
}

async function loadDataset(owners: OwnerRow[], period: Period) {
  if (owners.length === 0) {
    return { propertiesByOwner: new Map<string, PropertyRow[]>(), profilesByProperty: new Map<string, ProfileRow>(), ledgerByOwner: new Map<string, LedgerRow[]>(), maintenanceByOwner: new Map<string, MaintenanceRow[]>() }
  }

  const ownerIds = owners.map((o) => o.id)
  const organizationIds = Array.from(new Set(owners.map((o) => o.organization_id)))
  const periodStart = period.periodStart
  const periodEnd = period.periodEnd

  const [propertiesData, ledgerData, maintenanceData, profileData] = await Promise.all([
    prisma.properties.findMany({ select: { id: true, organization_id: true, owner_id: true, property_name: true, unit_number: true }, where: { owner_id: { in: ownerIds } } }),
    prisma.rent_ledger.findMany({ select: { owner_id: true, property_id: true, due_date: true, amount_due: true, amount_paid: true }, where: { owner_id: { in: ownerIds }, due_date: { gte: periodStart, lte: periodEnd } } }),
    prisma.maintenance_cost_entries.findMany({ select: { owner_id: true, property_id: true, amount: true, incurred_on: true }, where: { owner_id: { in: ownerIds }, status: 'recorded', incurred_on: { gte: periodStart, lte: periodEnd } } }),
    prisma.property_financial_profiles.findMany({ select: { property_id: true, service_charge_monthly: true, agency_fee_monthly: true, property_value: true, target_yield_percent: true }, where: { organization_id: { in: organizationIds } } }),
  ])

  const propertiesByOwner = new Map<string, PropertyRow[]>()
  for (const row of propertiesData) {
    const existing = propertiesByOwner.get(row.owner_id ?? '') ?? []
    existing.push({ id: row.id, organization_id: row.organization_id, owner_id: row.owner_id ?? '', property_name: row.property_name, unit_number: row.unit_number })
    propertiesByOwner.set(row.owner_id ?? '', existing)
  }

  const profilesByProperty = new Map<string, ProfileRow>()
  for (const row of profileData) {
    profilesByProperty.set(row.property_id, { property_id: row.property_id, service_charge_monthly: row.service_charge_monthly ? Number(row.service_charge_monthly) : null, agency_fee_monthly: row.agency_fee_monthly ? Number(row.agency_fee_monthly) : null, property_value: row.property_value ? Number(row.property_value) : null, target_yield_percent: row.target_yield_percent ? Number(row.target_yield_percent) : null })
  }

  const ledgerByOwner = new Map<string, LedgerRow[]>()
  for (const row of ledgerData) {
    const existing = ledgerByOwner.get(row.owner_id ?? '') ?? []
    existing.push({ owner_id: row.owner_id ?? '', property_id: row.property_id ?? '', due_date: row.due_date instanceof Date ? row.due_date.toISOString().slice(0, 10) : String(row.due_date), amount_due: row.amount_due ? Number(row.amount_due) : null, amount_paid: row.amount_paid ? Number(row.amount_paid) : null })
    ledgerByOwner.set(row.owner_id ?? '', existing)
  }

  const maintenanceByOwner = new Map<string, MaintenanceRow[]>()
  for (const row of maintenanceData) {
    const existing = maintenanceByOwner.get(row.owner_id ?? '') ?? []
    existing.push({ owner_id: row.owner_id ?? '', property_id: row.property_id ?? '', amount: row.amount ? Number(row.amount) : null, incurred_on: row.incurred_on instanceof Date ? row.incurred_on.toISOString().slice(0, 10) : String(row.incurred_on) })
    maintenanceByOwner.set(row.owner_id ?? '', existing)
  }

  return { propertiesByOwner, profilesByProperty, ledgerByOwner, maintenanceByOwner }
}

function annualizeYield(netIncome: number, propertyValue: number, periodMonths: number) {
  if (!propertyValue || propertyValue <= 0) return null
  const annualizedNetIncome = periodMonths >= 12 ? netIncome : netIncome * (12 / periodMonths)
  return roundToTwo((annualizedNetIncome / propertyValue) * 100)
}

function buildReport(input: { owner: OwnerRow; period: Period; properties: PropertyRow[]; profilesByProperty: Map<string, ProfileRow>; ledgerRows: LedgerRow[]; maintenanceRows: MaintenanceRow[] }): CashFlowReport {
  const settings = ownerSettings(input.owner)
  const currencyCode = normalizeCurrencyCode(input.owner.organizations?.currency_code)
  const ledgerByProperty = new Map<string, LedgerRow[]>()
  const maintenanceByProperty = new Map<string, MaintenanceRow[]>()

  for (const row of input.ledgerRows) { const existing = ledgerByProperty.get(row.property_id) ?? []; existing.push(row); ledgerByProperty.set(row.property_id, existing) }
  for (const row of input.maintenanceRows) { const existing = maintenanceByProperty.get(row.property_id) ?? []; existing.push(row); maintenanceByProperty.set(row.property_id, existing) }

  const properties = input.properties.map<PropertyMetric>((property) => {
    const profile = input.profilesByProperty.get(property.id)
    const propertyLedger = ledgerByProperty.get(property.id) ?? []
    const propertyMaintenance = maintenanceByProperty.get(property.id) ?? []
    const grossRentDue = roundToTwo(propertyLedger.reduce((sum, row) => sum + safeNumber(row.amount_due), 0))
    const grossRentReceived = roundToTwo(propertyLedger.reduce((sum, row) => sum + safeNumber(row.amount_paid), 0))
    const maintenanceCosts = roundToTwo(propertyMaintenance.reduce((sum, row) => sum + safeNumber(row.amount), 0))
    const serviceCharges = roundToTwo(safeNumber(profile?.service_charge_monthly) * input.period.monthsInPeriod)
    const agencyFees = roundToTwo(safeNumber(profile?.agency_fee_monthly) * input.period.monthsInPeriod)
    const fixedCharges = roundToTwo(serviceCharges + agencyFees)
    const netIncome = roundToTwo(grossRentReceived - maintenanceCosts - fixedCharges)
    const propertyValue = profile?.property_value ?? null
    const yieldPercent = propertyValue ? annualizeYield(netIncome, propertyValue, input.period.monthsInPeriod) : null
    const targetYieldPercent = profile?.target_yield_percent ?? null
    const belowTarget = typeof targetYieldPercent === 'number' && typeof yieldPercent === 'number' ? yieldPercent < targetYieldPercent : false
    return { property_id: property.id, property_name: property.property_name, unit_number: property.unit_number, gross_rent_due: grossRentDue, gross_rent_received: grossRentReceived, maintenance_costs: maintenanceCosts, service_charges: serviceCharges, agency_fees: agencyFees, fixed_charges: fixedCharges, net_income: netIncome, yield_percent: yieldPercent, property_value: propertyValue, target_yield_percent: targetYieldPercent, below_target: belowTarget }
  })

  const portfolioGrossDue = roundToTwo(properties.reduce((sum, p) => sum + p.gross_rent_due, 0))
  const portfolioGrossRent = roundToTwo(properties.reduce((sum, p) => sum + p.gross_rent_received, 0))
  const portfolioMaintenance = roundToTwo(properties.reduce((sum, p) => sum + p.maintenance_costs, 0))
  const portfolioServiceCharges = roundToTwo(properties.reduce((sum, p) => sum + p.service_charges, 0))
  const portfolioAgencyFees = roundToTwo(properties.reduce((sum, p) => sum + p.agency_fees, 0))
  const portfolioFixedCharges = roundToTwo(portfolioServiceCharges + portfolioAgencyFees)
  const portfolioNetIncome = roundToTwo(portfolioGrossRent - portfolioMaintenance - portfolioFixedCharges)
  const portfolioValue = roundToTwo(properties.reduce((sum, p) => sum + safeNumber(p.property_value), 0))
  const portfolioYield = portfolioValue > 0 ? annualizeYield(portfolioNetIncome, portfolioValue, input.period.monthsInPeriod) : null
  const portfolioBelowTarget = typeof settings.yieldAlertThresholdPercent === 'number' && typeof portfolioYield === 'number' ? portfolioYield < settings.yieldAlertThresholdPercent : false

  const belowTargetItems: YieldAlertItem[] = []
  if (portfolioBelowTarget && typeof portfolioYield === 'number' && typeof settings.yieldAlertThresholdPercent === 'number') {
    belowTargetItems.push({ signature: 'portfolio', kind: 'portfolio', label: 'Portfolio yield', actual_yield_percent: portfolioYield, threshold_percent: settings.yieldAlertThresholdPercent })
  }
  for (const property of properties.filter((m) => m.below_target && typeof m.yield_percent === 'number' && typeof m.target_yield_percent === 'number')) {
    belowTargetItems.push({ signature: `property:${property.property_id}`, kind: 'property', property_id: property.property_id, label: `${property.property_name}${property.unit_number ? ` (${property.unit_number})` : ''}`, actual_yield_percent: property.yield_percent as number, threshold_percent: property.target_yield_percent as number })
  }

  return { owner_id: input.owner.id, organization_id: input.owner.organization_id, currency_code: currencyCode, portfolio: { report_scope: input.period.scope, report_label: input.period.reportLabel, report_year: input.period.reportYear, report_month: input.period.reportMonth, report_period_key: input.period.reportPeriodKey, period_start: toDateOnly(input.period.periodStart), period_end: toDateOnly(input.period.periodEnd), currency_code: currencyCode, property_count: properties.length, gross_rent_due: portfolioGrossDue, gross_rent_received: portfolioGrossRent, maintenance_costs: portfolioMaintenance, service_charges: portfolioServiceCharges, agency_fees: portfolioAgencyFees, fixed_charges: portfolioFixedCharges, net_income: portfolioNetIncome, yield_percent: portfolioYield, target_yield_threshold_percent: settings.yieldAlertThresholdPercent, below_target: portfolioBelowTarget }, properties, below_target_items: belowTargetItems }
}

function hasMeaningfulData(report: CashFlowReport) {
  return report.portfolio.property_count > 0 || report.portfolio.gross_rent_due > 0 || report.portfolio.gross_rent_received > 0 || report.portfolio.maintenance_costs > 0 || report.portfolio.fixed_charges > 0
}

async function recentAlertSignatures(ownerId: string, scope: CashFlowReportScope, cooldownDays: number) {
  const since = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000)
  const data = await prisma.cash_flow_report_snapshots.findMany({
    select: { alerts_sent: true },
    where: { owner_id: ownerId, report_scope: scope, created_at: { gte: since } },
    orderBy: { created_at: 'desc' },
    take: 5,
  })

  const signatures = new Set<string>()
  for (const row of data) {
    const alerts = Array.isArray(row.alerts_sent) ? row.alerts_sent : []
    for (const item of alerts) {
      if (typeof item === 'string' && item.trim()) signatures.add(item)
    }
  }
  return signatures
}

async function persistSnapshot(input: { report: CashFlowReport; period: Period; triggerType: TriggerType; alertsSent: string[]; automationJobId?: string | null }) {
  const row = await prisma.cash_flow_report_snapshots.create({
    select: { id: true, created_at: true },
    data: {
      organization_id: input.report.organization_id,
      owner_id: input.report.owner_id,
      automation_job_id: input.automationJobId ?? null,
      report_scope: input.period.scope,
      trigger_type: input.triggerType,
      report_year: input.period.reportYear,
      report_month: input.period.reportMonth,
      report_period_key: input.period.reportPeriodKey,
      report_label: input.period.reportLabel,
      period_start: new Date(toDateOnly(input.period.periodStart)),
      period_end: new Date(toDateOnly(input.period.periodEnd)),
      currency_code: input.report.currency_code,
      property_count: input.report.portfolio.property_count,
      portfolio_gross_rent: input.report.portfolio.gross_rent_received,
      portfolio_maintenance: input.report.portfolio.maintenance_costs,
      portfolio_fixed_charges: input.report.portfolio.fixed_charges,
      portfolio_net_income: input.report.portfolio.net_income,
      portfolio_yield_percent: input.report.portfolio.yield_percent,
      below_target_count: input.report.below_target_items.length,
      alerts_sent: input.alertsSent,
      payload: { portfolio: input.report.portfolio, properties: input.report.properties, below_target_items: input.report.below_target_items },
    },
  })
  return { id: row.id, created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at) }
}

export async function attachCashFlowSnapshotsToRun(snapshotIds: string[], runId: string) {
  if (snapshotIds.length === 0) return
  await prisma.cash_flow_report_snapshots.updateMany({ where: { id: { in: snapshotIds } }, data: { automation_run_id: runId } })
}

async function createInAppNotification(input: { organizationId: string; ownerId: string; templateKey: 'cash_flow_monthly_report' | 'cash_flow_yield_alert'; title: string; fallbackBody: string; variables: Record<string, unknown> }) {
  const resolved = await resolveAutomationMessageTemplate({ organizationId: input.organizationId, templateKey: input.templateKey, channel: 'in_app', fallbackBody: input.fallbackBody, variables: input.variables })
  await createOwnerNotification({ organization_id: input.organizationId, owner_id: input.ownerId, notification_type: input.templateKey, title: input.title, message: resolved.body })
}

async function maybeSendYieldAlert(input: { owner: OwnerRow; report: CashFlowReport; period: Period }) {
  if (input.report.below_target_items.length === 0) return { sent: false, alertsSent: [] as string[] }

  const settings = ownerSettings(input.owner)
  const seen = await recentAlertSignatures(input.owner.id, input.period.scope, settings.yieldAlertCooldownDays)
  const newItems = input.report.below_target_items.filter((item) => !seen.has(item.signature))
  if (newItems.length === 0) return { sent: false, alertsSent: [] as string[] }

  const portfolioYieldLabel = typeof input.report.portfolio.yield_percent === 'number' ? `${input.report.portfolio.yield_percent}%` : 'Not available'
  const summary = newItems.slice(0, 3).map((item) => `${item.label} (${item.actual_yield_percent.toFixed(2)}% vs ${item.threshold_percent.toFixed(2)}%)`)

  await createInAppNotification({ organizationId: input.owner.organization_id, ownerId: input.owner.id, templateKey: 'cash_flow_yield_alert', title: `Yield alert | ${input.period.reportLabel}`, fallbackBody: `Yield has fallen below target for ${newItems.length} tracked item(s) in ${input.period.reportLabel}. Portfolio yield is ${portfolioYieldLabel}.`, variables: { reportLabel: input.period.reportLabel, alertCount: newItems.length, portfolioYield: portfolioYieldLabel } })

  await deliverOwnerAutomationMessage({ organizationId: input.owner.organization_id, ownerId: input.owner.id, templateKey: 'cash_flow_yield_alert', templateVariables: { reportLabel: input.period.reportLabel, alertCount: newItems.length, portfolioYield: portfolioYieldLabel }, email: { subject: `Yield alert | ${input.period.reportLabel}`, preheader: `Yield is below target for ${newItems.length} tracked item(s).`, eyebrow: 'Yield Alert', title: `Review cash flow for ${input.period.reportLabel}`, intro: [`Hello ${ownerDisplayName(input.owner)},`, 'Prophives detected yield performance below the configured threshold in your latest cash-flow snapshot.'], details: [{ label: 'Report Window', value: input.period.reportLabel, emphasize: true, tone: 'accent' }, { label: 'Portfolio Yield', value: portfolioYieldLabel, emphasize: true }, { label: 'Items Below Target', value: String(newItems.length) }, { label: 'Net Income', value: toCurrencyLabel(input.report.portfolio.net_income, input.report.currency_code), emphasize: true, tone: 'security' }], body: [summary.length > 0 ? `Signals requiring review: ${summary.join('; ')}.` : 'A portfolio-level threshold was breached and should be reviewed.'], note: { title: 'Alert discipline', body: `Prophives respects your cooldown window and will not repeat the same yield alert for ${settings.yieldAlertCooldownDays} day(s) unless the signal materially changes.`, tone: 'warning' }, cta: { label: 'Review cash flow', url: buildOwnerAutomationUrl() }, footer: ['Yield alerts are generated from your organization-scoped rent ledger, maintenance records, and property financial profiles.'] }, telegram: { fallbackText: [`Yield alert | ${input.period.reportLabel}`, `Portfolio yield: ${portfolioYieldLabel}`, `Tracked items below target: ${newItems.length}`, summary.length > 0 ? `Review: ${summary.join('; ')}` : 'Review portfolio performance in Prophives.'].join('\n') }, whatsapp: { fallbackText: `Yield alert for ${input.period.reportLabel}: ${newItems.length} tracked item(s) below target. Portfolio yield ${portfolioYieldLabel}.` } })

  return { sent: true, alertsSent: newItems.map((item) => item.signature) }
}

async function maybeSendMonthlyDigest(input: { owner: OwnerRow; monthlyReport: CashFlowReport; annualReport: CashFlowReport; period: Period }) {
  const settings = ownerSettings(input.owner)
  if (!settings.cashFlowReportingEnabled || !settings.monthlyDigestEnabled || !settings.portfolioVisibilityEnabled) return { sent: false }

  await createInAppNotification({ organizationId: input.owner.organization_id, ownerId: input.owner.id, templateKey: 'cash_flow_monthly_report', title: `Cash flow report | ${input.period.reportLabel}`, fallbackBody: `Cash-flow report ready for ${input.period.reportLabel}. Net income: ${toCurrencyLabel(input.monthlyReport.portfolio.net_income, input.monthlyReport.currency_code)} across ${input.monthlyReport.portfolio.property_count} properties.`, variables: { reportPeriod: input.period.reportLabel, propertyCount: input.monthlyReport.portfolio.property_count, portfolioNetIncome: toCurrencyLabel(input.monthlyReport.portfolio.net_income, input.monthlyReport.currency_code) } })

  await deliverOwnerAutomationMessage({ organizationId: input.owner.organization_id, ownerId: input.owner.id, templateKey: 'cash_flow_monthly_report', templateVariables: { reportPeriod: input.period.reportLabel, propertyCount: input.monthlyReport.portfolio.property_count, portfolioGrossRent: toCurrencyLabel(input.monthlyReport.portfolio.gross_rent_received, input.monthlyReport.currency_code), portfolioMaintenance: toCurrencyLabel(input.monthlyReport.portfolio.maintenance_costs, input.monthlyReport.currency_code), portfolioFixedCharges: toCurrencyLabel(input.monthlyReport.portfolio.fixed_charges, input.monthlyReport.currency_code), portfolioNetIncome: toCurrencyLabel(input.monthlyReport.portfolio.net_income, input.monthlyReport.currency_code), portfolioYield: typeof input.annualReport.portfolio.yield_percent === 'number' ? `${input.annualReport.portfolio.yield_percent}%` : 'Not available' }, email: { subject: `Cash flow report | ${input.period.reportLabel}`, preheader: `Net income ${toCurrencyLabel(input.monthlyReport.portfolio.net_income, input.monthlyReport.currency_code)} across ${input.monthlyReport.portfolio.property_count} properties.`, eyebrow: 'Cash Flow Report', title: `Monthly cash flow for ${input.period.reportLabel}`, intro: [`Hello ${ownerDisplayName(input.owner)},`, 'Your Prophives monthly and trailing annual cash-flow summary is ready.'], details: [{ label: 'Report Period', value: input.period.reportLabel, emphasize: true, tone: 'accent' }, { label: 'Properties Covered', value: String(input.monthlyReport.portfolio.property_count) }, { label: 'Gross Rent Received', value: toCurrencyLabel(input.monthlyReport.portfolio.gross_rent_received, input.monthlyReport.currency_code), emphasize: true }, { label: 'Maintenance Costs', value: toCurrencyLabel(input.monthlyReport.portfolio.maintenance_costs, input.monthlyReport.currency_code) }, { label: 'Fixed Charges', value: toCurrencyLabel(input.monthlyReport.portfolio.fixed_charges, input.monthlyReport.currency_code) }, { label: 'Net Income', value: toCurrencyLabel(input.monthlyReport.portfolio.net_income, input.monthlyReport.currency_code), emphasize: true, tone: 'security' }, { label: 'Trailing Annual Yield', value: typeof input.annualReport.portfolio.yield_percent === 'number' ? `${input.annualReport.portfolio.yield_percent}%` : 'Not available', emphasize: true, tone: 'accent' }], cta: { label: 'Open automation reports', url: buildOwnerAutomationUrl() }, footer: ['Monthly cash-flow reports are stored as immutable snapshots for auditability.'] }, telegram: { fallbackText: [`Cash flow report | ${input.period.reportLabel}`, `Gross rent received: ${toCurrencyLabel(input.monthlyReport.portfolio.gross_rent_received, input.monthlyReport.currency_code)}`, `Maintenance: ${toCurrencyLabel(input.monthlyReport.portfolio.maintenance_costs, input.monthlyReport.currency_code)}`, `Net income: ${toCurrencyLabel(input.monthlyReport.portfolio.net_income, input.monthlyReport.currency_code)}`, `Trailing annual yield: ${typeof input.annualReport.portfolio.yield_percent === 'number' ? `${input.annualReport.portfolio.yield_percent}%` : 'Not available'}`].join('\n') }, whatsapp: { fallbackText: `Cash flow report ${input.period.reportLabel}: net income ${toCurrencyLabel(input.monthlyReport.portfolio.net_income, input.monthlyReport.currency_code)} and trailing annual yield ${typeof input.annualReport.portfolio.yield_percent === 'number' ? `${input.annualReport.portfolio.yield_percent}%` : 'Not available'}.` } })

  return { sent: true }
}

async function generateReport(input: { owner: OwnerRow; scope: CashFlowReportScope; now?: Date; year?: number; month?: number; triggerType: TriggerType; automationJobId?: string | null; persist: boolean; allowAlerts: boolean }) {
  const period = resolvePeriod({ scope: input.scope, now: input.now, year: input.year, month: input.month })
  const dataset = await loadDataset([input.owner], period)
  const report = buildReport({ owner: input.owner, period, properties: dataset.propertiesByOwner.get(input.owner.id) ?? [], profilesByProperty: dataset.profilesByProperty, ledgerRows: dataset.ledgerByOwner.get(input.owner.id) ?? [], maintenanceRows: dataset.maintenanceByOwner.get(input.owner.id) ?? [] })

  let alertsSent: string[] = []
  if (input.allowAlerts) alertsSent = (await maybeSendYieldAlert({ owner: input.owner, report, period })).alertsSent

  const snapshot = input.persist ? await persistSnapshot({ report, period, triggerType: input.triggerType, alertsSent, automationJobId: input.automationJobId ?? null }) : null
  return { period, report, snapshot, alertsSent }
}

export async function runMonthlyCashFlowReports(now = new Date(), options?: { jobId?: string | null }) {
  const owners = (await listOwners()).filter((owner) => ownerSettings(owner).cashFlowReportingEnabled)
  const monthlyRef = previousMonthAnchor(now)
  const monthlyPeriod = resolvePeriod({ scope: 'monthly', year: monthlyRef.year, month: monthlyRef.month, now })
  const annualPeriod = resolvePeriod({ scope: 'annual', year: monthlyRef.year, month: monthlyRef.month, now })
  const [monthlyDataset, annualDataset] = await Promise.all([loadDataset(owners, monthlyPeriod), loadDataset(owners, annualPeriod)])

  const snapshotIds: string[] = []
  let ownersEvaluated = 0; let reportsGenerated = 0; let digestsSent = 0; let alertsSent = 0; let failures = 0

  for (const owner of owners) {
    ownersEvaluated += 1
    try {
      const monthlyReport = buildReport({ owner, period: monthlyPeriod, properties: monthlyDataset.propertiesByOwner.get(owner.id) ?? [], profilesByProperty: monthlyDataset.profilesByProperty, ledgerRows: monthlyDataset.ledgerByOwner.get(owner.id) ?? [], maintenanceRows: monthlyDataset.maintenanceByOwner.get(owner.id) ?? [] })
      const annualReport = buildReport({ owner, period: annualPeriod, properties: annualDataset.propertiesByOwner.get(owner.id) ?? [], profilesByProperty: annualDataset.profilesByProperty, ledgerRows: annualDataset.ledgerByOwner.get(owner.id) ?? [], maintenanceRows: annualDataset.maintenanceByOwner.get(owner.id) ?? [] })

      if (!hasMeaningfulData(monthlyReport) && !hasMeaningfulData(annualReport)) continue

      const annualAlertResult = await maybeSendYieldAlert({ owner, report: annualReport, period: annualPeriod })
      const monthlySnapshot = await persistSnapshot({ report: monthlyReport, period: monthlyPeriod, triggerType: 'schedule', alertsSent: [], automationJobId: options?.jobId ?? null })
      const annualSnapshot = await persistSnapshot({ report: annualReport, period: annualPeriod, triggerType: 'schedule', alertsSent: annualAlertResult.alertsSent, automationJobId: options?.jobId ?? null })
      snapshotIds.push(monthlySnapshot.id, annualSnapshot.id)
      reportsGenerated += 2
      alertsSent += annualAlertResult.alertsSent.length

      if ((await maybeSendMonthlyDigest({ owner, monthlyReport, annualReport, period: monthlyPeriod })).sent) digestsSent += 1
    } catch (error) {
      failures += 1
      if (options?.jobId) {
        await recordAutomationError({ jobId: options.jobId, organizationId: owner.organization_id, ownerId: owner.id, flowName: 'cash_flow_monthly_report', errorMessage: error instanceof Error ? error.message : 'cash_flow_monthly_report_failed', context: { owner_id: owner.id, organization_id: owner.organization_id, report_period: monthlyPeriod.reportLabel } })
      }
    }
  }

  return { report_period: monthlyPeriod.reportLabel, annual_period: annualPeriod.reportLabel, owners_evaluated: ownersEvaluated, reports_generated: reportsGenerated, digests_sent: digestsSent, alerts_sent: alertsSent, failures, cash_flow_snapshot_ids: snapshotIds }
}

export async function runCashFlowRefresh(input: { ownerId: string; organizationId: string; now?: Date; year?: number; month?: number; scope?: CashFlowReportScope; triggerType?: TriggerType; automationJobId?: string | null; persist?: boolean; allowAlerts?: boolean }) {
  const owner = (await listOwners({ ownerId: input.ownerId, organizationId: input.organizationId }))[0]
  if (!owner) throw new AppError('Owner not found for cash-flow refresh', 404)
  if (!ownerSettings(owner).cashFlowReportingEnabled) return { owner_id: owner.id, organization_id: owner.organization_id, scope: input.scope ?? 'current', skipped: true, reason: 'cash_flow_reporting_disabled', cash_flow_snapshot_ids: [] }

  const result = await generateReport({ owner, scope: input.scope ?? 'current', now: input.now, year: input.year, month: input.month, triggerType: input.triggerType ?? 'event', automationJobId: input.automationJobId ?? null, persist: input.persist ?? true, allowAlerts: input.allowAlerts ?? true })

  return { owner_id: owner.id, organization_id: owner.organization_id, scope: result.period.scope, report_period: result.period.reportLabel, alerts_sent: result.alertsSent.length, cash_flow_snapshot_ids: result.snapshot ? [result.snapshot.id] : [] }
}

export async function getOwnerCashFlowOverview(ownerId: string, organizationId: string, now = new Date()) {
  const owner = (await listOwners({ ownerId, organizationId }))[0]
  if (!owner) throw new AppError('Owner not found', 404)

  const current = await generateReport({ owner, scope: 'current', now, triggerType: 'manual', persist: false, allowAlerts: false })

  const snapshots = await prisma.cash_flow_report_snapshots.findMany({
    select: { id: true, owner_id: true, organization_id: true, report_scope: true, trigger_type: true, report_label: true, report_year: true, report_month: true, report_period_key: true, period_start: true, period_end: true, currency_code: true, property_count: true, portfolio_gross_rent: true, portfolio_maintenance: true, portfolio_fixed_charges: true, portfolio_net_income: true, portfolio_yield_percent: true, below_target_count: true, alerts_sent: true, payload: true, created_at: true },
    where: { owner_id: ownerId, organization_id: organizationId },
    orderBy: { created_at: 'desc' },
    take: 12,
  })

  return { current_report: { generated_at: now.toISOString(), portfolio: current.report.portfolio, properties: current.report.properties, below_target_items: current.report.below_target_items }, latest_monthly_snapshot: snapshots.find((s) => s.report_scope === 'monthly') ?? null, latest_annual_snapshot: snapshots.find((s) => s.report_scope === 'annual') ?? null, recent_snapshots: snapshots }
}

export async function getAdminCashFlowOverview(input?: { organizationId?: string }) {
  const snapshots = await prisma.cash_flow_report_snapshots.findMany({
    select: { id: true, owner_id: true, organization_id: true, report_scope: true, trigger_type: true, report_label: true, report_year: true, report_month: true, report_period_key: true, period_start: true, period_end: true, currency_code: true, property_count: true, portfolio_gross_rent: true, portfolio_maintenance: true, portfolio_fixed_charges: true, portfolio_net_income: true, portfolio_yield_percent: true, below_target_count: true, alerts_sent: true, payload: true, created_at: true, owners: { select: { full_name: true, company_name: true, email: true } }, organizations: { select: { name: true, slug: true } } },
    where: input?.organizationId ? { organization_id: input.organizationId } : {},
    orderBy: { created_at: 'desc' },
    take: 20,
  })
  return { recent_snapshots: snapshots as unknown as SnapshotRow[] }
}

export async function createMaintenanceCostEntry(input: { organizationId: string; ownerId: string; propertyId: string; amount: number; incurredOn: string; sourceType?: 'manual' | 'ticket' | 'invoice' | 'automation'; vendorName?: string | null; description?: string | null; invoiceRef?: string | null; sourceTicketId?: string | null; recordedByRole?: 'owner' | 'admin' | 'system'; recordedByOwnerId?: string | null; recordedByAdminId?: string | null }) {
  const row = await prisma.maintenance_cost_entries.create({
    select: { id: true, organization_id: true, owner_id: true, property_id: true, amount: true, incurred_on: true, status: true, source_type: true, vendor_name: true, description: true, invoice_ref: true, source_ticket_id: true },
    data: { organization_id: input.organizationId, owner_id: input.ownerId, property_id: input.propertyId, amount: input.amount, incurred_on: new Date(input.incurredOn), source_type: input.sourceType ?? 'manual', vendor_name: input.vendorName ?? null, description: input.description ?? null, invoice_ref: input.invoiceRef ?? null, source_ticket_id: input.sourceTicketId ?? null, recorded_by_role: input.recordedByRole ?? 'system', recorded_by_owner_id: input.recordedByOwnerId ?? null, recorded_by_admin_id: input.recordedByAdminId ?? null },
  })
  return { ...row, amount: Number(row.amount), incurred_on: row.incurred_on instanceof Date ? row.incurred_on.toISOString().slice(0, 10) : String(row.incurred_on) } as MaintenanceCostEntryRecord
}
