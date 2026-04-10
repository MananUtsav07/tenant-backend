import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/db.js'
import { addDays } from '../utils/date.js'
import { enqueueCashFlowRefreshJob } from './automationEngineService.js'
import { notifyOwnerRentPaymentAwaitingApproval, notifyTenantRentPaymentReviewed } from './notificationService.js'
import { getTenantById } from './tenantService.js'

export type RentPaymentApprovalStatus = 'awaiting_owner_approval' | 'approved' | 'rejected'
export type TenantRentPaymentStateStatus = RentPaymentApprovalStatus | 'eligible' | 'not_available'

type CycleWindow = {
  cycle_year: number
  cycle_month: number
  due_date: Date
  window_starts_at: Date
  is_current_cycle: boolean
}

type RentPaymentApprovalRow = {
  id: string
  organization_id: string
  owner_id: string
  tenant_id: string
  property_id: string
  cycle_year: number
  cycle_month: number
  due_date: string
  amount_paid: number
  status: RentPaymentApprovalStatus
  rejection_reason: string | null
  reviewed_by_owner_id: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

function serializeApproval(row: {
  id: string
  organization_id: string
  owner_id: string | null
  tenant_id: string | null
  property_id: string | null
  cycle_year: number
  cycle_month: number
  due_date: Date | string
  amount_paid: number | { toNumber: () => number } | null
  status: string
  rejection_reason: string | null
  reviewed_by_owner_id: string | null
  reviewed_at: Date | string | null
  created_at: Date | string
  updated_at: Date | string
}): RentPaymentApprovalRow {
  return {
    id: row.id,
    organization_id: row.organization_id,
    owner_id: row.owner_id ?? '',
    tenant_id: row.tenant_id ?? '',
    property_id: row.property_id ?? '',
    cycle_year: row.cycle_year,
    cycle_month: row.cycle_month,
    due_date: row.due_date instanceof Date ? row.due_date.toISOString().slice(0, 10) : String(row.due_date),
    amount_paid: Number(row.amount_paid ?? 0),
    status: row.status as RentPaymentApprovalStatus,
    rejection_reason: row.rejection_reason,
    reviewed_by_owner_id: row.reviewed_by_owner_id,
    reviewed_at: row.reviewed_at instanceof Date ? row.reviewed_at.toISOString() : (row.reviewed_at as string | null),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }
}

function toDueDate(year: number, month: number, paymentDueDay: number): Date {
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const safeDay = Math.max(1, Math.min(paymentDueDay, daysInMonth))
  return new Date(Date.UTC(year, month - 1, safeDay, 9, 0, 0, 0))
}

function resolveCycleWindow(paymentDueDay: number, now: Date): CycleWindow {
  const currentYear = now.getUTCFullYear()
  const currentMonth = now.getUTCMonth() + 1
  const currentCycleDueDate = toDueDate(currentYear, currentMonth, paymentDueDay)
  const currentWindowStartsAt = addDays(currentCycleDueDate, -7)

  if (now >= currentWindowStartsAt) {
    return {
      cycle_year: currentYear,
      cycle_month: currentMonth,
      due_date: currentCycleDueDate,
      window_starts_at: currentWindowStartsAt,
      is_current_cycle: true,
    }
  }

  const previousMonthAnchor = new Date(Date.UTC(currentYear, currentMonth - 2, 1, 9, 0, 0, 0))
  const previousYear = previousMonthAnchor.getUTCFullYear()
  const previousMonth = previousMonthAnchor.getUTCMonth() + 1
  const previousDueDate = toDueDate(previousYear, previousMonth, paymentDueDay)

  return {
    cycle_year: previousYear,
    cycle_month: previousMonth,
    due_date: previousDueDate,
    window_starts_at: addDays(previousDueDate, -7),
    is_current_cycle: false,
  }
}

async function syncApprovedRentLedgerEntry(input: {
  organizationId: string
  ownerId: string
  tenantId: string
  propertyId: string
  cycleYear: number
  cycleMonth: number
  dueDate: string
  amountPaid: number
}) {
  const existing = await prisma.rent_ledger.findFirst({
    where: { organization_id: input.organizationId, tenant_id: input.tenantId, cycle_year: input.cycleYear, cycle_month: input.cycleMonth },
    select: { id: true },
  })

  const ledgerData = {
    organization_id: input.organizationId,
    owner_id: input.ownerId,
    tenant_id: input.tenantId,
    property_id: input.propertyId,
    cycle_year: input.cycleYear,
    cycle_month: input.cycleMonth,
    due_date: new Date(input.dueDate),
    amount_due: input.amountPaid,
    amount_paid: input.amountPaid,
    // Use the later of today or due_date — DB check constraint requires paid_date >= due_date
    paid_date: new Date(Math.max(Date.now(), new Date(input.dueDate).getTime())),
    status: 'paid',
  }

  if (existing) {
    await prisma.rent_ledger.update({ where: { id: existing.id }, data: { ...ledgerData, updated_at: new Date() } })
  } else {
    await prisma.rent_ledger.create({ data: ledgerData })
  }
}

async function findApprovalForCycle(input: {
  organizationId: string
  tenantId: string
  cycleYear: number
  cycleMonth: number
}): Promise<RentPaymentApprovalRow | null> {
  const row = await prisma.rent_payment_approvals.findFirst({
    select: { id: true, organization_id: true, owner_id: true, tenant_id: true, property_id: true, cycle_year: true, cycle_month: true, due_date: true, amount_paid: true, status: true, rejection_reason: true, reviewed_by_owner_id: true, reviewed_at: true, created_at: true, updated_at: true },
    where: { organization_id: input.organizationId, tenant_id: input.tenantId, cycle_year: input.cycleYear, cycle_month: input.cycleMonth },
    orderBy: { created_at: 'desc' },
  })

  return row ? serializeApproval(row) : null
}

async function buildTenantRentPaymentContext(input: {
  tenantId: string
  organizationId: string
  now?: Date
}) {
  const tenant = await getTenantById(input.tenantId, input.organizationId)
  if (!tenant) {
    throw new AppError('Tenant not found in your organization', 404)
  }

  const now = input.now ?? new Date()
  const cycle = resolveCycleWindow(tenant.payment_due_day, now)
  const approval = await findApprovalForCycle({
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    cycleYear: cycle.cycle_year,
    cycleMonth: cycle.cycle_month,
  })

  const unresolvedRow = await prisma.rent_payment_approvals.findFirst({
    select: { id: true, organization_id: true, owner_id: true, tenant_id: true, property_id: true, cycle_year: true, cycle_month: true, due_date: true, amount_paid: true, status: true, rejection_reason: true, reviewed_by_owner_id: true, reviewed_at: true, created_at: true, updated_at: true },
    where: { organization_id: input.organizationId, tenant_id: input.tenantId, status: { in: ['awaiting_owner_approval', 'rejected'] } },
    orderBy: [{ cycle_year: 'desc' }, { cycle_month: 'desc' }, { created_at: 'desc' }],
  })

  const unresolvedApproval = unresolvedRow ? serializeApproval(unresolvedRow) : null

  if (unresolvedApproval) {
    const unresolvedDueDate = new Date(`${unresolvedApproval.due_date}T09:00:00.000Z`)
    const unresolvedCycle: CycleWindow = {
      cycle_year: unresolvedApproval.cycle_year,
      cycle_month: unresolvedApproval.cycle_month,
      due_date: unresolvedDueDate,
      window_starts_at: addDays(unresolvedDueDate, -7),
      is_current_cycle: false,
    }

    return {
      tenant,
      cycle: unresolvedCycle,
      approval: unresolvedApproval,
      isVisible: true,
      status: unresolvedApproval.status,
      canMarkPaid: unresolvedApproval.status === 'rejected',
    }
  }

  const isVisible = cycle.is_current_cycle ? true : Boolean(approval && approval.status !== 'approved')

  let status: TenantRentPaymentStateStatus = 'not_available'
  if (isVisible) {
    if (approval) {
      status = approval.status
    } else {
      status = 'eligible'
    }
  }

  return {
    tenant,
    cycle,
    approval,
    isVisible,
    status,
    canMarkPaid: isVisible && (!approval || approval.status === 'rejected'),
  }
}

export async function getTenantRentPaymentState(input: { tenantId: string; organizationId: string; now?: Date }) {
  const context = await buildTenantRentPaymentContext(input)

  return {
    is_visible: context.isVisible,
    can_mark_paid: context.canMarkPaid,
    status: context.status,
    cycle_year: context.cycle.cycle_year,
    cycle_month: context.cycle.cycle_month,
    due_date: context.cycle.due_date.toISOString(),
    window_starts_at: context.cycle.window_starts_at.toISOString(),
    amount_paid: Number(context.tenant.monthly_rent ?? 0),
    currency_code: context.tenant.organizations?.currency_code ?? 'INR',
    rejection_reason: context.approval?.rejection_reason ?? null,
    approval_id: context.approval?.id ?? null,
    requested_at: context.approval?.created_at ?? null,
    reviewed_at: context.approval?.reviewed_at ?? null,
  }
}

export async function submitTenantRentPayment(input: { tenantId: string; organizationId: string; now?: Date }) {
  const context = await buildTenantRentPaymentContext(input)

  if (!context.isVisible) {
    throw new AppError('Rent payment confirmation is not available yet for this cycle', 400)
  }

  if (context.status === 'awaiting_owner_approval') {
    throw new AppError('Rent payment is already awaiting owner verification', 409)
  }

  if (context.status === 'approved') {
    throw new AppError('Rent payment is already approved for this cycle', 409)
  }

  const select = { id: true, organization_id: true, owner_id: true, tenant_id: true, property_id: true, cycle_year: true, cycle_month: true, due_date: true, amount_paid: true, status: true, rejection_reason: true, reviewed_by_owner_id: true, reviewed_at: true, created_at: true, updated_at: true }

  let approval: RentPaymentApprovalRow
  if (context.approval && context.approval.status === 'rejected') {
    const row = await prisma.rent_payment_approvals.update({
      select,
      where: { id: context.approval.id },
      data: {
        status: 'awaiting_owner_approval',
        rejection_reason: null,
        reviewed_at: null,
        reviewed_by_owner_id: null,
        due_date: context.cycle.due_date,
        amount_paid: context.tenant.monthly_rent,
      },
    })
    approval = serializeApproval(row)
  } else {
    const row = await prisma.rent_payment_approvals.create({
      select,
      data: {
        organization_id: input.organizationId,
        owner_id: context.tenant.owner_id,
        tenant_id: context.tenant.id,
        property_id: context.tenant.property_id,
        cycle_year: context.cycle.cycle_year,
        cycle_month: context.cycle.cycle_month,
        due_date: context.cycle.due_date,
        amount_paid: context.tenant.monthly_rent,
        status: 'awaiting_owner_approval',
      },
    })
    approval = serializeApproval(row)
  }

  await notifyOwnerRentPaymentAwaitingApproval({
    approvalId: approval.id,
    organizationId: input.organizationId,
    ownerId: context.tenant.owner_id,
    tenantId: context.tenant.id,
    tenantName: context.tenant.full_name,
    tenantAccessId: context.tenant.tenant_access_id,
    propertyName: context.tenant.properties?.property_name ?? null,
    unitNumber: context.tenant.properties?.unit_number ?? null,
    dueDateIso: context.cycle.due_date.toISOString(),
    amountPaid: Number(context.tenant.monthly_rent ?? 0),
    currencyCode: context.tenant.organizations?.currency_code ?? 'INR',
  })

  const state = await getTenantRentPaymentState({
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    now: input.now,
  })

  return { approval, state }
}

export async function listOwnerAwaitingRentPaymentApprovals(input: { ownerId: string; organizationId: string }) {
  return prisma.rent_payment_approvals.findMany({
    select: { id: true, organization_id: true, owner_id: true, tenant_id: true, property_id: true, cycle_year: true, cycle_month: true, due_date: true, amount_paid: true, status: true, rejection_reason: true, reviewed_by_owner_id: true, reviewed_at: true, created_at: true, updated_at: true, tenants: { select: { full_name: true, tenant_access_id: true } }, properties: { select: { property_name: true, unit_number: true } } },
    where: { organization_id: input.organizationId, owner_id: input.ownerId, status: 'awaiting_owner_approval' },
    orderBy: { created_at: 'desc' },
  })
}

export async function reviewOwnerRentPaymentApproval(input: {
  approvalId: string
  ownerId: string
  organizationId: string
  action: 'approve' | 'reject'
  rejectionReason?: string
  ownerMessage?: string
}) {
  const existing = await prisma.rent_payment_approvals.findFirst({
    select: { id: true, status: true },
    where: { id: input.approvalId, organization_id: input.organizationId, owner_id: input.ownerId },
  })

  if (!existing) {
    throw new AppError('Rent payment approval item not found in your organization', 404)
  }

  if (existing.status !== 'awaiting_owner_approval') {
    throw new AppError('Only awaiting approvals can be reviewed', 409)
  }

  const reviewPayload =
    input.action === 'approve'
      ? { status: 'approved' as const, rejection_reason: null, reviewed_by_owner_id: input.ownerId, reviewed_at: new Date() }
      : { status: 'rejected' as const, rejection_reason: input.rejectionReason?.trim() || null, reviewed_by_owner_id: input.ownerId, reviewed_at: new Date() }

  const data = await prisma.rent_payment_approvals.update({
    select: { id: true, organization_id: true, owner_id: true, tenant_id: true, property_id: true, cycle_year: true, cycle_month: true, due_date: true, amount_paid: true, status: true, rejection_reason: true, reviewed_by_owner_id: true, reviewed_at: true, created_at: true, updated_at: true, tenants: { select: { full_name: true, tenant_access_id: true, email: true } }, properties: { select: { property_name: true, unit_number: true } } },
    where: { id: input.approvalId },
    data: reviewPayload,
  })

  const reviewedTenant = await getTenantById(data.tenant_id as string, input.organizationId)
  const tenantRelation = data.tenants as { full_name?: string | null; email?: string | null } | null
  const propertyRelation = data.properties as { property_name?: string | null; unit_number?: string | null } | null
  const dueDate = data.due_date instanceof Date ? data.due_date.toISOString().slice(0, 10) : String(data.due_date)
  const rejectionReason = data.rejection_reason

  await notifyTenantRentPaymentReviewed({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    tenantId: data.tenant_id as string,
    tenantEmail: reviewedTenant?.email ?? tenantRelation?.email ?? null,
    tenantName: tenantRelation?.full_name ?? reviewedTenant?.full_name ?? 'Resident',
    propertyName: propertyRelation?.property_name ?? reviewedTenant?.properties?.property_name ?? null,
    unitNumber: propertyRelation?.unit_number ?? reviewedTenant?.properties?.unit_number ?? null,
    dueDateIso: dueDate,
    amountPaid: Number(data.amount_paid ?? 0),
    currencyCode: reviewedTenant?.organizations?.currency_code ?? 'INR',
    status: input.action === 'approve' ? 'approved' : 'rejected',
    rejectionReason: input.action === 'reject' ? rejectionReason ?? null : null,
    ownerMessage: input.ownerMessage?.trim() || null,
  })

  if (input.action === 'approve') {
    // Immediately update tenant payment_status so dashboard reflects paid without waiting for cron
    await prisma.tenants.update({
      where: { id: data.tenant_id as string },
      data: { payment_status: 'paid', updated_at: new Date() },
    })

    await syncApprovedRentLedgerEntry({
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      tenantId: data.tenant_id as string,
      propertyId: data.property_id as string,
      cycleYear: Number(data.cycle_year),
      cycleMonth: Number(data.cycle_month),
      dueDate,
      amountPaid: Number(data.amount_paid ?? 0),
    })

    await enqueueCashFlowRefreshJob({
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      sourceType: 'rent_payment_approval',
      sourceRef: input.approvalId,
      scope: 'current',
    })
  }

  return data
}

export async function countOwnerAwaitingRentPaymentApprovals(input: { ownerId: string; organizationId: string }) {
  return prisma.rent_payment_approvals.count({
    where: { organization_id: input.organizationId, owner_id: input.ownerId, status: 'awaiting_owner_approval' },
  })
}
