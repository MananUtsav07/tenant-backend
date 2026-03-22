import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'
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

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
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
  const { error } = await supabaseAdmin
    .from('rent_ledger')
    .upsert(
      {
        organization_id: input.organizationId,
        owner_id: input.ownerId,
        tenant_id: input.tenantId,
        property_id: input.propertyId,
        cycle_year: input.cycleYear,
        cycle_month: input.cycleMonth,
        due_date: input.dueDate,
        amount_due: input.amountPaid,
        amount_paid: input.amountPaid,
        paid_date: new Date().toISOString().slice(0, 10),
        status: 'paid',
      },
      { onConflict: 'organization_id,tenant_id,cycle_year,cycle_month' },
    )

  throwIfError(error, 'Failed to synchronize approved rent into ledger')
}

async function findApprovalForCycle(input: {
  organizationId: string
  tenantId: string
  cycleYear: number
  cycleMonth: number
}): Promise<RentPaymentApprovalRow | null> {
  const { data, error } = await supabaseAdmin
    .from('rent_payment_approvals')
    .select(
      'id, organization_id, owner_id, tenant_id, property_id, cycle_year, cycle_month, due_date, amount_paid, status, rejection_reason, reviewed_by_owner_id, reviewed_at, created_at, updated_at',
    )
    .eq('organization_id', input.organizationId)
    .eq('tenant_id', input.tenantId)
    .eq('cycle_year', input.cycleYear)
    .eq('cycle_month', input.cycleMonth)
    .order('created_at', { ascending: false })
    .limit(1)

  throwIfError(error, 'Failed to load rent payment state')
  return (data?.[0] as RentPaymentApprovalRow | undefined) ?? null
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

  const { data: unresolvedRows, error: unresolvedError } = await supabaseAdmin
    .from('rent_payment_approvals')
    .select(
      'id, organization_id, owner_id, tenant_id, property_id, cycle_year, cycle_month, due_date, amount_paid, status, rejection_reason, reviewed_by_owner_id, reviewed_at, created_at, updated_at',
    )
    .eq('organization_id', input.organizationId)
    .eq('tenant_id', input.tenantId)
    .in('status', ['awaiting_owner_approval', 'rejected'])
    .order('cycle_year', { ascending: false })
    .order('cycle_month', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)

  throwIfError(unresolvedError, 'Failed to load active rent payment approval')
  const unresolvedApproval = (unresolvedRows?.[0] as RentPaymentApprovalRow | undefined) ?? null

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

  let approval: RentPaymentApprovalRow
  if (context.approval && context.approval.status === 'rejected') {
    const { data, error } = await supabaseAdmin
      .from('rent_payment_approvals')
      .update({
        status: 'awaiting_owner_approval',
        rejection_reason: null,
        reviewed_at: null,
        reviewed_by_owner_id: null,
        due_date: context.cycle.due_date.toISOString().slice(0, 10),
        amount_paid: context.tenant.monthly_rent,
      })
      .eq('id', context.approval.id)
      .eq('organization_id', input.organizationId)
      .eq('tenant_id', input.tenantId)
      .select(
        'id, organization_id, owner_id, tenant_id, property_id, cycle_year, cycle_month, due_date, amount_paid, status, rejection_reason, reviewed_by_owner_id, reviewed_at, created_at, updated_at',
      )
      .single()

    throwIfError(error, 'Failed to submit rent payment for verification')
    approval = data as RentPaymentApprovalRow
  } else {
    const { data, error } = await supabaseAdmin
      .from('rent_payment_approvals')
      .insert({
        organization_id: input.organizationId,
        owner_id: context.tenant.owner_id,
        tenant_id: context.tenant.id,
        property_id: context.tenant.property_id,
        cycle_year: context.cycle.cycle_year,
        cycle_month: context.cycle.cycle_month,
        due_date: context.cycle.due_date.toISOString().slice(0, 10),
        amount_paid: context.tenant.monthly_rent,
        status: 'awaiting_owner_approval',
      })
      .select(
        'id, organization_id, owner_id, tenant_id, property_id, cycle_year, cycle_month, due_date, amount_paid, status, rejection_reason, reviewed_by_owner_id, reviewed_at, created_at, updated_at',
      )
      .single()

    throwIfError(error, 'Failed to submit rent payment for verification')
    approval = data as RentPaymentApprovalRow
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

  return {
    approval,
    state,
  }
}

export async function listOwnerAwaitingRentPaymentApprovals(input: { ownerId: string; organizationId: string }) {
  const { data, error } = await supabaseAdmin
    .from('rent_payment_approvals')
    .select(
      'id, organization_id, owner_id, tenant_id, property_id, cycle_year, cycle_month, due_date, amount_paid, status, rejection_reason, reviewed_by_owner_id, reviewed_at, created_at, updated_at, tenants(full_name, tenant_access_id), properties(property_name, unit_number)',
    )
    .eq('organization_id', input.organizationId)
    .eq('owner_id', input.ownerId)
    .eq('status', 'awaiting_owner_approval')
    .order('created_at', { ascending: false })

  throwIfError(error, 'Failed to list rent payment approvals')
  return data ?? []
}

export async function reviewOwnerRentPaymentApproval(input: {
  approvalId: string
  ownerId: string
  organizationId: string
  action: 'approve' | 'reject'
  rejectionReason?: string
  ownerMessage?: string
}) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('rent_payment_approvals')
    .select(
      'id, organization_id, owner_id, tenant_id, property_id, cycle_year, cycle_month, due_date, amount_paid, status, rejection_reason, reviewed_by_owner_id, reviewed_at, created_at, updated_at',
    )
    .eq('id', input.approvalId)
    .eq('organization_id', input.organizationId)
    .eq('owner_id', input.ownerId)
    .maybeSingle()

  throwIfError(existingError, 'Failed to load rent payment approval')

  if (!existing) {
    throw new AppError('Rent payment approval item not found in your organization', 404)
  }

  if (existing.status !== 'awaiting_owner_approval') {
    throw new AppError('Only awaiting approvals can be reviewed', 409)
  }

  const reviewPayload =
    input.action === 'approve'
      ? {
          status: 'approved' as const,
          rejection_reason: null,
          reviewed_by_owner_id: input.ownerId,
          reviewed_at: new Date().toISOString(),
        }
      : {
          status: 'rejected' as const,
          rejection_reason: input.rejectionReason?.trim() || null,
          reviewed_by_owner_id: input.ownerId,
          reviewed_at: new Date().toISOString(),
        }

  const { data, error } = await supabaseAdmin
    .from('rent_payment_approvals')
    .update(reviewPayload)
    .eq('id', input.approvalId)
    .eq('organization_id', input.organizationId)
    .eq('owner_id', input.ownerId)
    .select(
      'id, organization_id, owner_id, tenant_id, property_id, cycle_year, cycle_month, due_date, amount_paid, status, rejection_reason, reviewed_by_owner_id, reviewed_at, created_at, updated_at, tenants(full_name, tenant_access_id, email), properties(property_name, unit_number)',
    )
    .single()

  throwIfError(error, 'Failed to review rent payment approval')
  if (!data) {
    throw new AppError('Failed to review rent payment approval', 500)
  }

  const reviewedTenant = await getTenantById(data.tenant_id as string, input.organizationId)

  await notifyTenantRentPaymentReviewed({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    tenantId: data.tenant_id as string,
    tenantEmail: reviewedTenant?.email ?? ((data.tenants as { email?: string | null } | null)?.email ?? null),
    tenantName: (data.tenants as { full_name?: string | null } | null)?.full_name ?? reviewedTenant?.full_name ?? 'Resident',
    propertyName:
      (data.properties as { property_name?: string | null } | null)?.property_name ??
      reviewedTenant?.properties?.property_name ??
      null,
    unitNumber:
      (data.properties as { unit_number?: string | null } | null)?.unit_number ??
      reviewedTenant?.properties?.unit_number ??
      null,
    dueDateIso: data.due_date as string,
    amountPaid: Number(data.amount_paid ?? 0),
    currencyCode: reviewedTenant?.organizations?.currency_code ?? 'INR',
    status: input.action === 'approve' ? 'approved' : 'rejected',
    rejectionReason: input.action === 'reject' ? (data.rejection_reason as string | null) ?? null : null,
    ownerMessage: input.ownerMessage?.trim() || null,
  })

  if (input.action === 'approve') {
    await syncApprovedRentLedgerEntry({
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      tenantId: data.tenant_id as string,
      propertyId: data.property_id as string,
      cycleYear: Number(data.cycle_year),
      cycleMonth: Number(data.cycle_month),
      dueDate: data.due_date as string,
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
  const { count, error } = await supabaseAdmin
    .from('rent_payment_approvals')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', input.organizationId)
    .eq('owner_id', input.ownerId)
    .eq('status', 'awaiting_owner_approval')

  throwIfError(error, 'Failed to count awaiting rent payment approvals')
  return count ?? 0
}
