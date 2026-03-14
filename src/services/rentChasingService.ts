import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { processOwnerReminders } from './reminderService.js'

type ActiveTenantRow = {
  id: string
  organization_id: string
  owner_id: string
  property_id: string
  monthly_rent: number
  payment_due_day: number
  payment_status: 'pending' | 'paid' | 'overdue' | 'partial'
  status: string
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

function toCycle(now: Date): { year: number; month: number } {
  return {
    year: now.getUTCFullYear(),
    month: now.getUTCMonth() + 1,
  }
}

async function loadRentChasingSettings(ownerIds: string[]) {
  if (ownerIds.length === 0) {
    return new Map<string, boolean>()
  }

  const { data, error } = await supabaseAdmin
    .from('owner_automation_settings')
    .select('owner_id, rent_chasing_enabled')
    .in('owner_id', ownerIds)

  throwIfError(error, 'Failed to load owner rent chasing settings')

  const map = new Map<string, boolean>()
  for (const row of data ?? []) {
    map.set(row.owner_id as string, Boolean(row.rent_chasing_enabled))
  }

  return map
}

async function loadApprovedTenantIds(input: {
  organizationIds: string[]
  tenantIds: string[]
  cycleYear: number
  cycleMonth: number
}) {
  if (input.tenantIds.length === 0) {
    return new Set<string>()
  }

  const { data, error } = await supabaseAdmin
    .from('rent_payment_approvals')
    .select('tenant_id')
    .in('organization_id', input.organizationIds)
    .in('tenant_id', input.tenantIds)
    .eq('cycle_year', input.cycleYear)
    .eq('cycle_month', input.cycleMonth)
    .eq('status', 'approved')

  throwIfError(error, 'Failed to load approved rent payment entries')

  return new Set<string>((data ?? []).map((row) => row.tenant_id as string))
}

export async function runRentChasing(now = new Date()) {
  const { year: cycleYear, month: cycleMonth } = toCycle(now)

  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id, organization_id, owner_id, property_id, monthly_rent, payment_due_day, payment_status, status')
    .eq('status', 'active')

  throwIfError(error, 'Failed to load active tenants for rent chasing')

  const tenants = (data ?? []) as ActiveTenantRow[]
  const approvedTenantIds = await loadApprovedTenantIds({
    organizationIds: Array.from(new Set(tenants.map((tenant) => tenant.organization_id))),
    tenantIds: tenants.map((tenant) => tenant.id),
    cycleYear,
    cycleMonth,
  })

  const settingsByOwner = await loadRentChasingSettings(Array.from(new Set(tenants.map((tenant) => tenant.owner_id))))

  let paidCount = 0
  let pendingCount = 0
  let overdueCount = 0
  let tenantStatusUpdates = 0

  for (const tenant of tenants) {
    const dueDate = toDueDate(cycleYear, cycleMonth, tenant.payment_due_day)
    const dueDateIso = dueDate.toISOString().slice(0, 10)
    const isApproved = approvedTenantIds.has(tenant.id)

    const nextStatus: 'pending' | 'paid' | 'overdue' = isApproved ? 'paid' : now > dueDate ? 'overdue' : 'pending'

    if (nextStatus === 'paid') {
      paidCount += 1
    } else if (nextStatus === 'overdue') {
      overdueCount += 1
    } else {
      pendingCount += 1
    }

    const amountDue = Number(tenant.monthly_rent ?? 0)
    await supabaseAdmin.from('rent_ledger').upsert(
      {
        organization_id: tenant.organization_id,
        owner_id: tenant.owner_id,
        tenant_id: tenant.id,
        property_id: tenant.property_id,
        cycle_year: cycleYear,
        cycle_month: cycleMonth,
        due_date: dueDateIso,
        amount_due: amountDue,
        amount_paid: isApproved ? amountDue : 0,
        paid_date: isApproved ? now.toISOString().slice(0, 10) : null,
        status: nextStatus,
      },
      {
        onConflict: 'organization_id,tenant_id,cycle_year,cycle_month',
      },
    )

    if (tenant.payment_status !== nextStatus) {
      const { error: updateError } = await supabaseAdmin
        .from('tenants')
        .update({
          payment_status: nextStatus,
        })
        .eq('id', tenant.id)
        .eq('organization_id', tenant.organization_id)

      throwIfError(updateError, 'Failed to update tenant payment status')
      tenantStatusUpdates += 1
    }
  }

  const reminderOwnerMap = new Map<string, { ownerId: string; organizationId: string }>()
  for (const tenant of tenants) {
    const enabled = settingsByOwner.get(tenant.owner_id) ?? true
    if (!enabled) {
      continue
    }

    const key = `${tenant.organization_id}:${tenant.owner_id}`
    if (!reminderOwnerMap.has(key)) {
      reminderOwnerMap.set(key, {
        organizationId: tenant.organization_id,
        ownerId: tenant.owner_id,
      })
    }
  }

  let ownersProcessed = 0
  for (const ownerContext of reminderOwnerMap.values()) {
    await processOwnerReminders({
      ownerId: ownerContext.ownerId,
      organizationId: ownerContext.organizationId,
    })
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
