import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/db.js'
import { notifyOwnerRentOverdueAlert } from './portfolioVisibilityService.js'
import { processOwnerReminders } from './reminderService.js'

type ActiveTenantRow = {
  id: string
  organization_id: string
  owner_id: string
  property_id: string
  full_name: string
  tenant_access_id: string
  monthly_rent: number
  payment_due_day: number
  payment_status: 'pending' | 'paid' | 'overdue' | 'partial'
  status: string
  properties?: { property_name: string | null; unit_number: string | null } | null
}

function toDueDate(year: number, month: number, paymentDueDay: number): Date {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const safeDay = Math.max(1, Math.min(paymentDueDay, daysInMonth))
  return new Date(Date.UTC(year, month - 1, safeDay, 9, 0, 0, 0))
}

function toCycle(now: Date): { year: number; month: number } {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 }
}

async function loadRentChasingSettings(ownerIds: string[]) {
  if (ownerIds.length === 0) return new Map<string, boolean>()

  const data = await prisma.owner_automation_settings.findMany({
    select: { owner_id: true, rent_chasing_enabled: true },
    where: { owner_id: { in: ownerIds } },
  })

  const map = new Map<string, boolean>()
  for (const row of data) {
    map.set(row.owner_id, Boolean(row.rent_chasing_enabled))
  }
  return map
}

async function loadOwnerCurrencyMap(ownerIds: string[]) {
  if (ownerIds.length === 0) return new Map<string, string>()

  const data = await prisma.owners.findMany({
    select: { id: true, organizations: { select: { currency_code: true } } },
    where: { id: { in: ownerIds } },
  })

  const map = new Map<string, string>()
  for (const row of data) {
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations
    map.set(row.id, (org as { currency_code?: string | null } | null)?.currency_code?.trim().toUpperCase() || 'INR')
  }
  return map
}

async function loadApprovedTenantIds(input: {
  organizationIds: string[]
  tenantIds: string[]
  cycleYear: number
  cycleMonth: number
}) {
  if (input.tenantIds.length === 0) return new Set<string>()

  const data = await prisma.rent_payment_approvals.findMany({
    select: { tenant_id: true },
    where: { organization_id: { in: input.organizationIds }, tenant_id: { in: input.tenantIds }, cycle_year: input.cycleYear, cycle_month: input.cycleMonth, status: 'approved' },
  })

  return new Set<string>(data.map((row) => row.tenant_id as string))
}

export async function runRentChasing(now = new Date()) {
  const { year: cycleYear, month: cycleMonth } = toCycle(now)

  const rawTenants = await prisma.tenants.findMany({
    select: { id: true, organization_id: true, owner_id: true, property_id: true, full_name: true, tenant_access_id: true, monthly_rent: true, payment_due_day: true, payment_status: true, status: true, properties: { select: { property_name: true, unit_number: true } } },
    where: { status: 'active' },
  })

  const tenants: ActiveTenantRow[] = rawTenants.map((row) => {
    const prop = Array.isArray(row.properties) ? row.properties[0] : row.properties
    return {
      id: row.id,
      organization_id: row.organization_id,
      owner_id: row.owner_id ?? '',
      property_id: row.property_id ?? '',
      full_name: row.full_name,
      tenant_access_id: row.tenant_access_id,
      monthly_rent: Number(row.monthly_rent ?? 0),
      payment_due_day: Number(row.payment_due_day ?? 1),
      payment_status: row.payment_status as ActiveTenantRow['payment_status'],
      status: row.status ?? 'active',
      properties: prop ? { property_name: (prop as { property_name?: string | null }).property_name ?? null, unit_number: (prop as { unit_number?: string | null }).unit_number ?? null } : null,
    }
  })

  const approvedTenantIds = await loadApprovedTenantIds({
    organizationIds: Array.from(new Set(tenants.map((t) => t.organization_id))),
    tenantIds: tenants.map((t) => t.id),
    cycleYear,
    cycleMonth,
  })

  const ownerIds = Array.from(new Set(tenants.map((t) => t.owner_id)))
  const [settingsByOwner, ownerCurrencyById] = await Promise.all([
    loadRentChasingSettings(ownerIds),
    loadOwnerCurrencyMap(ownerIds),
  ])

  let paidCount = 0
  let pendingCount = 0
  let overdueCount = 0
  let tenantStatusUpdates = 0

  for (const tenant of tenants) {
    const dueDate = toDueDate(cycleYear, cycleMonth, tenant.payment_due_day)
    const dueDateIso = dueDate.toISOString().slice(0, 10)
    const isApproved = approvedTenantIds.has(tenant.id)

    const nextStatus: 'pending' | 'paid' | 'overdue' = isApproved ? 'paid' : now > dueDate ? 'overdue' : 'pending'

    if (nextStatus === 'paid') paidCount += 1
    else if (nextStatus === 'overdue') overdueCount += 1
    else pendingCount += 1

    const amountDue = Number(tenant.monthly_rent ?? 0)

    const existingLedger = await prisma.rent_ledger.findFirst({
      where: { organization_id: tenant.organization_id, tenant_id: tenant.id, cycle_year: cycleYear, cycle_month: cycleMonth },
      select: { id: true },
    })

    const ledgerData = {
      organization_id: tenant.organization_id,
      owner_id: tenant.owner_id,
      tenant_id: tenant.id,
      property_id: tenant.property_id,
      cycle_year: cycleYear,
      cycle_month: cycleMonth,
      due_date: new Date(dueDateIso),
      amount_due: amountDue,
      amount_paid: isApproved ? amountDue : 0,
      paid_date: isApproved ? new Date(now.toISOString().slice(0, 10)) : null,
      status: nextStatus,
    }

    if (existingLedger) {
      await prisma.rent_ledger.update({ where: { id: existingLedger.id }, data: { ...ledgerData, updated_at: new Date() } })
    } else {
      await prisma.rent_ledger.create({ data: ledgerData })
    }

    if (tenant.payment_status !== nextStatus) {
      await prisma.tenants.update({ where: { id: tenant.id }, data: { payment_status: nextStatus } })
      tenantStatusUpdates += 1
    }

    if (tenant.payment_status !== 'overdue' && nextStatus === 'overdue') {
      await notifyOwnerRentOverdueAlert({
        organizationId: tenant.organization_id,
        ownerId: tenant.owner_id,
        tenantId: tenant.id,
        tenantName: tenant.full_name,
        tenantAccessId: tenant.tenant_access_id,
        propertyName: tenant.properties?.property_name ?? null,
        unitNumber: tenant.properties?.unit_number ?? null,
        dueDateIso,
        amountDue,
        currencyCode: ownerCurrencyById.get(tenant.owner_id) ?? 'INR',
        now,
      })
    }
  }

  const reminderOwnerMap = new Map<string, { ownerId: string; organizationId: string }>()
  for (const tenant of tenants) {
    const enabled = settingsByOwner.get(tenant.owner_id) ?? true
    if (!enabled) continue

    const key = `${tenant.organization_id}:${tenant.owner_id}`
    if (!reminderOwnerMap.has(key)) {
      reminderOwnerMap.set(key, { organizationId: tenant.organization_id, ownerId: tenant.owner_id })
    }
  }

  let ownersProcessed = 0
  for (const ownerContext of reminderOwnerMap.values()) {
    await processOwnerReminders({ ownerId: ownerContext.ownerId, organizationId: ownerContext.organizationId })
    ownersProcessed += 1
  }

  return {
    tenants_scanned: tenants.length,
    tenant_status_updates: tenantStatusUpdates,
    cycle_year: cycleYear,
    cycle_month: cycleMonth,
    paid_count: paidCount,
    pending_count: pendingCount,
    overdue_count: overdueCount,
    reminder_owners_processed: ownersProcessed,
  }
}
