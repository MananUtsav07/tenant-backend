import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { resolveCurrencyCode, type SupportedCountryCode } from '../config/countryCurrency.js'
import { generateTenantAccessId } from '../utils/ids.js'
import { getCurrentCycleYearMonth, resolveTenantPaymentStatus, type TenantPaymentStatus } from '../utils/paymentStatus.js'
import { isTicketSummarizationEnabled } from './ai/featureFlags.js'
import { createOrganization, upsertOwnerMembership } from './organizationService.js'

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

type TenantWithPaymentFields = {
  id: string
  organization_id: string
  payment_due_day: number
  payment_status: TenantPaymentStatus
}

async function listApprovedTenantIdsForCurrentCycle(input: {
  organizationId: string
  tenantIds: string[]
  now?: Date
}): Promise<Set<string>> {
  if (input.tenantIds.length === 0) {
    return new Set<string>()
  }

  const { cycleYear, cycleMonth } = getCurrentCycleYearMonth(input.now)
  const { data, error } = await supabaseAdmin
    .from('rent_payment_approvals')
    .select('tenant_id')
    .eq('organization_id', input.organizationId)
    .eq('cycle_year', cycleYear)
    .eq('cycle_month', cycleMonth)
    .eq('status', 'approved')
    .in('tenant_id', input.tenantIds)

  throwIfError(error, 'Failed to load approved rent payments for current cycle')

  return new Set<string>((data ?? []).map((row) => row.tenant_id as string))
}

function applyComputedPaymentStatus<T extends TenantWithPaymentFields>(
  tenants: T[],
  approvedTenantIds: Set<string>,
  now = new Date(),
): Array<T & { payment_status: TenantPaymentStatus }> {
  return tenants.map((tenant) => ({
    ...tenant,
    payment_status: resolveTenantPaymentStatus({
      paymentStatus: tenant.payment_status,
      paymentDueDay: tenant.payment_due_day,
      isCurrentCycleApproved: approvedTenantIds.has(tenant.id),
      now,
    }),
  }))
}

export async function findOwnerByEmail(email: string) {
  const { data, error } = await supabaseAdmin
    .from('owners')
    .select('*, organizations(id, name, slug, plan_code, country_code, currency_code, created_at)')
    .eq('email', email)
    .maybeSingle()

  throwIfError(error, 'Failed to query owner')
  return data
}

export async function createOwner(input: {
  email: string
  password_hash: string
  full_name?: string
  company_name?: string
  support_email?: string
  support_whatsapp?: string
  country_code: SupportedCountryCode
  organization_id?: string
}) {
  const organizationName =
    input.company_name?.trim() || input.full_name?.trim() || `${input.email.split('@')[0] ?? 'Owner'} Organization`

  const organization =
    input.organization_id
      ? { id: input.organization_id }
      : await createOrganization({
          name: organizationName,
          plan_code: 'starter',
          country_code: input.country_code,
          currency_code: resolveCurrencyCode(input.country_code),
        })

  try {
    const { data, error } = await supabaseAdmin
      .from('owners')
      .insert({
        email: input.email,
        password_hash: input.password_hash,
        full_name: input.full_name ?? null,
        company_name: input.company_name ?? null,
        support_email: input.support_email ?? input.email,
        support_whatsapp: input.support_whatsapp ?? null,
        organization_id: organization.id,
      })
      .select('*, organizations(id, name, slug, plan_code, country_code, currency_code, created_at)')
      .single()

    throwIfError(error, 'Failed to create owner')

    await upsertOwnerMembership({
      organization_id: organization.id,
      owner_id: data.id,
      role: 'owner',
    })

    return data
  } catch (error) {
    if (!input.organization_id) {
      await supabaseAdmin.from('organizations').delete().eq('id', organization.id)
    }
    throw error
  }
}

export async function getOwnerById(ownerId: string, organizationId?: string) {
  let request = supabaseAdmin
    .from('owners')
    .select('*, organizations(id, name, slug, plan_code, country_code, currency_code, created_at)')
    .eq('id', ownerId)

  if (organizationId) {
    request = request.eq('organization_id', organizationId)
  }

  const { data, error } = await request.maybeSingle()
  throwIfError(error, 'Failed to fetch owner')
  return data
}

export async function createProperty(args: {
  ownerId: string
  organizationId: string
  input: {
    property_name: string
    address: string
    unit_number?: string
  }
}) {
  const { data, error } = await supabaseAdmin
    .from('properties')
    .insert({
      owner_id: args.ownerId,
      organization_id: args.organizationId,
      property_name: args.input.property_name,
      address: args.input.address,
      unit_number: args.input.unit_number ?? null,
    })
    .select('*')
    .single()

  throwIfError(error, 'Failed to create property')
  return data
}

export async function listProperties(organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('properties')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })

  throwIfError(error, 'Failed to list properties')
  return data ?? []
}

export async function getPropertyForOwner(organizationId: string, propertyId: string) {
  const { data, error } = await supabaseAdmin
    .from('properties')
    .select('*')
    .eq('id', propertyId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  throwIfError(error, 'Failed to fetch property')
  return data
}

export async function updateProperty(organizationId: string, propertyId: string, patch: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin
    .from('properties')
    .update(patch)
    .eq('id', propertyId)
    .eq('organization_id', organizationId)
    .select('*')
    .maybeSingle()

  throwIfError(error, 'Failed to update property')
  return data
}

export async function deleteProperty(organizationId: string, propertyId: string) {
  const { error, count } = await supabaseAdmin
    .from('properties')
    .delete({ count: 'exact' })
    .eq('id', propertyId)
    .eq('organization_id', organizationId)

  throwIfError(error, 'Failed to delete property')
  return count ?? 0
}

async function buildUniqueTenantAccessId(): Promise<string> {
  let attempts = 0

  while (attempts < 8) {
    attempts += 1
    const candidate = generateTenantAccessId()
    const { data, error } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .eq('tenant_access_id', candidate)
      .maybeSingle()

    throwIfError(error, 'Failed to verify tenant access id uniqueness')

    if (!data) {
      return candidate
    }
  }

  throw new AppError('Could not generate unique tenant access id', 500)
}

export async function createTenant(args: {
  ownerId: string
  organizationId: string
  input: {
    property_id: string
    broker_id?: string | null
    full_name: string
    email?: string
    phone?: string
    password_hash: string
    lease_start_date?: string
    lease_end_date?: string
    monthly_rent: number
    payment_due_day: number
    payment_status?: string
    status?: string
  }
}) {
  const tenantAccessId = await buildUniqueTenantAccessId()

  const { data, error } = await supabaseAdmin
    .from('tenants')
    .insert({
      owner_id: args.ownerId,
      organization_id: args.organizationId,
      property_id: args.input.property_id,
      broker_id: args.input.broker_id ?? null,
      full_name: args.input.full_name,
      email: args.input.email ?? null,
      phone: args.input.phone ?? null,
      tenant_access_id: tenantAccessId,
      password_hash: args.input.password_hash,
      lease_start_date: args.input.lease_start_date ?? null,
      lease_end_date: args.input.lease_end_date ?? null,
      monthly_rent: args.input.monthly_rent,
      payment_due_day: args.input.payment_due_day,
      payment_status: args.input.payment_status ?? 'pending',
      status: args.input.status ?? 'active',
    })
    .select('*')
    .single()

  throwIfError(error, 'Failed to create tenant')
  return data
}

export async function listTenants(organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('*, properties(id, property_name, address, unit_number), brokers(id, full_name, email, phone, agency_name, is_active)')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })

  throwIfError(error, 'Failed to list tenants')
  const tenants = (data ?? []) as TenantWithPaymentFields[]
  const now = new Date()
  const approvedTenantIds = await listApprovedTenantIdsForCurrentCycle({
    organizationId,
    tenantIds: tenants.map((tenant) => tenant.id),
    now,
  })

  return applyComputedPaymentStatus(tenants, approvedTenantIds, now)
}

export async function getTenantForOwner(organizationId: string, tenantId: string) {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('*, properties(*), brokers(id, full_name, email, phone, agency_name, is_active)')
    .eq('id', tenantId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  throwIfError(error, 'Failed to fetch tenant')
  if (!data) {
    return null
  }

  const now = new Date()
  const approvedTenantIds = await listApprovedTenantIdsForCurrentCycle({
    organizationId,
    tenantIds: [data.id],
    now,
  })

  return applyComputedPaymentStatus([data as TenantWithPaymentFields], approvedTenantIds, now)[0]
}

export async function updateTenant(organizationId: string, tenantId: string, patch: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .update(patch)
    .eq('id', tenantId)
    .eq('organization_id', organizationId)
    .select('*')
    .maybeSingle()

  throwIfError(error, 'Failed to update tenant')
  return data
}

export async function deleteTenant(organizationId: string, tenantId: string) {
  const { error, count } = await supabaseAdmin
    .from('tenants')
    .delete({ count: 'exact' })
    .eq('id', tenantId)
    .eq('organization_id', organizationId)

  throwIfError(error, 'Failed to delete tenant')
  return count ?? 0
}

export async function getTenantDetailAggregate(organizationId: string, tenantId: string) {
  const tenant = await getTenantForOwner(organizationId, tenantId)

  if (!tenant) {
    return null
  }

  const aiTicketSummariesEnabled = await isTicketSummarizationEnabled(organizationId)
  if (aiTicketSummariesEnabled) {
    // Infrastructure-only hook:
    // Ticket summarization is intentionally disabled in live flows for now.
    // Future rollout will add summary payload fields to this aggregate.
  }

  const [{ data: tickets, error: ticketsError }, { data: reminders, error: remindersError }] = await Promise.all([
    supabaseAdmin
      .from('support_tickets')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('rent_reminders')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('organization_id', organizationId)
      .order('scheduled_for', { ascending: false }),
  ])

  throwIfError(ticketsError, 'Failed to load tenant tickets')
  throwIfError(remindersError, 'Failed to load tenant reminders')

  return {
    tenant,
    tickets: tickets ?? [],
    reminders: reminders ?? [],
  }
}

export async function listOwnerTickets(organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .select('*, tenants(id, full_name, tenant_access_id, property_id, properties(id, property_name))')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })

  throwIfError(error, 'Failed to list owner tickets')
  return data ?? []
}

export async function updateOwnerTicket(organizationId: string, ticketId: string, status: string) {
  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', ticketId)
    .eq('organization_id', organizationId)
    .select('*')
    .maybeSingle()

  throwIfError(error, 'Failed to update ticket')
  return data
}

export async function listOwnerNotifications(organizationId: string, ownerId: string) {
  const { data, error } = await supabaseAdmin
    .from('owner_notifications')
    .select('*, tenants(id, full_name, tenant_access_id)')
    .eq('organization_id', organizationId)
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: false })

  throwIfError(error, 'Failed to list notifications')
  return data ?? []
}

export async function markNotificationRead(organizationId: string, ownerId: string, notificationId: string) {
  const { data, error } = await supabaseAdmin
    .from('owner_notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
    .eq('organization_id', organizationId)
    .eq('owner_id', ownerId)
    .select('*')
    .maybeSingle()

  throwIfError(error, 'Failed to update notification')
  return data
}

export async function markAllNotificationsRead(organizationId: string, ownerId: string) {
  const { data, error } = await supabaseAdmin
    .from('owner_notifications')
    .update({ is_read: true })
    .eq('organization_id', organizationId)
    .eq('owner_id', ownerId)
    .eq('is_read', false)
    .select('id')

  throwIfError(error, 'Failed to mark notifications as read')
  return (data ?? []).length
}

export async function createOwnerNotification(input: {
  organization_id: string
  owner_id: string
  tenant_id?: string | null
  notification_type: string
  title: string
  message: string
}) {
  const { data, error } = await supabaseAdmin
    .from('owner_notifications')
    .insert({
      owner_id: input.owner_id,
      tenant_id: input.tenant_id ?? null,
      notification_type: input.notification_type,
      title: input.title,
      message: input.message,
      organization_id: input.organization_id,
    })
    .select('*')
    .single()

  throwIfError(error, 'Failed to create owner notification')
  return data
}

export async function getOwnerDashboardSummary(organizationId: string, ownerId?: string) {
  const [activeTenantsResult, ticketsResult, remindersResult, unreadNotificationsResult] = await Promise.all([
    supabaseAdmin
      .from('tenants')
      .select('id, payment_due_day, payment_status')
      .eq('organization_id', organizationId)
      .eq('status', 'active'),
    supabaseAdmin
      .from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .in('status', ['open', 'in_progress']),
    supabaseAdmin
      .from('rent_reminders')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('status', 'pending'),
    supabaseAdmin
      .from('owner_notifications')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('owner_id', ownerId ?? '')
      .eq('is_read', false),
  ])

  let awaitingApprovals = 0
  if (ownerId) {
    const awaitingApprovalsResult = await supabaseAdmin
      .from('rent_payment_approvals')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('owner_id', ownerId)
      .eq('status', 'awaiting_owner_approval')
    throwIfError(awaitingApprovalsResult.error, 'Failed to count awaiting rent payment approvals')
    awaitingApprovals = awaitingApprovalsResult.count ?? 0
  }

  throwIfError(activeTenantsResult.error, 'Failed to load active tenants')
  throwIfError(ticketsResult.error, 'Failed to count open tickets')
  throwIfError(remindersResult.error, 'Failed to count pending reminders')
  throwIfError(unreadNotificationsResult.error, 'Failed to count unread notifications')

  const activeTenants = (activeTenantsResult.data ?? []) as TenantWithPaymentFields[]
  const now = new Date()
  const approvedTenantIds = await listApprovedTenantIdsForCurrentCycle({
    organizationId,
    tenantIds: activeTenants.map((tenant) => tenant.id),
    now,
  })
  const overdueCount = applyComputedPaymentStatus(activeTenants, approvedTenantIds, now).filter(
    (tenant) => tenant.payment_status === 'overdue',
  ).length

  return {
    active_tenants: activeTenants.length,
    open_tickets: ticketsResult.count ?? 0,
    overdue_rent: overdueCount,
    reminders_pending: remindersResult.count ?? 0,
    unread_notifications: unreadNotificationsResult.count ?? 0,
    awaiting_approvals: awaitingApprovals,
  }
}
