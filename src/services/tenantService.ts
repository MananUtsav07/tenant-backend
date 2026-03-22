import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { getCurrentCycleYearMonth, resolveTenantPaymentStatus } from '../utils/paymentStatus.js'
import { isTicketClassificationEnabled } from './ai/featureFlags.js'

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

async function hasApprovedRentPaymentForCurrentCycle(input: {
  tenantId: string
  organizationId: string
  now?: Date
}): Promise<boolean> {
  const { cycleYear, cycleMonth } = getCurrentCycleYearMonth(input.now)
  const { data, error } = await supabaseAdmin
    .from('rent_payment_approvals')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('tenant_id', input.tenantId)
    .eq('cycle_year', cycleYear)
    .eq('cycle_month', cycleMonth)
    .eq('status', 'approved')
    .limit(1)

  throwIfError(error, 'Failed to resolve tenant payment approval status')
  return Boolean(data?.length)
}

export async function findTenantByAccessId(tenantAccessId: string) {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('*, owners(*), organizations(id, name, slug, plan_code, country_code, currency_code, created_at)')
    .eq('tenant_access_id', tenantAccessId)
    .maybeSingle()

  throwIfError(error, 'Failed to query tenant')
  return data
}

export async function getTenantById(tenantId: string, organizationId?: string) {
  let request = supabaseAdmin
    .from('tenants')
    .select('*, owners(*), properties(*), organizations(id, name, slug, plan_code, country_code, currency_code, created_at)')
    .eq('id', tenantId)

  if (organizationId) {
    request = request.eq('organization_id', organizationId)
  }

  const { data, error } = await request.maybeSingle()

  throwIfError(error, 'Failed to fetch tenant')
  if (!data) {
    return null
  }

  const now = new Date()
  const approvedForCurrentCycle = await hasApprovedRentPaymentForCurrentCycle({
    tenantId: data.id,
    organizationId: data.organization_id,
    now,
  })

  return {
    ...data,
    payment_status: resolveTenantPaymentStatus({
      paymentStatus: data.payment_status,
      paymentDueDay: data.payment_due_day,
      isCurrentCycleApproved: approvedForCurrentCycle,
      now,
    }),
  }
}

export async function getTenantSummary(tenantId: string, organizationId: string) {
  const [ticketsResult, remindersResult] = await Promise.all([
    supabaseAdmin
      .from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('tenant_id', tenantId)
      .in('status', ['open', 'in_progress']),
    supabaseAdmin
      .from('rent_reminders')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .eq('tenant_id', tenantId)
      .eq('status', 'pending'),
  ])

  throwIfError(ticketsResult.error, 'Failed to count tenant tickets')
  throwIfError(remindersResult.error, 'Failed to count pending reminders')

  return {
    open_tickets: ticketsResult.count ?? 0,
    pending_reminders: remindersResult.count ?? 0,
  }
}

export async function listTenantTickets(tenantId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })

  throwIfError(error, 'Failed to list tenant tickets')
  return data ?? []
}

export async function createTenantTicket(input: {
  organization_id: string
  tenant_id: string
  owner_id: string
  subject: string
  message: string
}) {
  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .insert({
      tenant_id: input.tenant_id,
      owner_id: input.owner_id,
      organization_id: input.organization_id,
      subject: input.subject,
      message: input.message,
      status: 'open',
    })
    .select('*')
    .single()

  throwIfError(error, 'Failed to create ticket')

  // Infrastructure-only hook:
  // The AI module is wired for future intent classification, but this branch
  // intentionally does not execute classification yet.
  const aiTicketClassificationEnabled = await isTicketClassificationEnabled(input.organization_id)
  if (aiTicketClassificationEnabled) {
    // Future rollout point:
    // await classifyTicketIntent(...)
  }

  return data
}

export async function getOwnerContactByTenant(tenantId: string, organizationId: string) {
  const { data: tenant, error: tenantError } = await supabaseAdmin
    .from('tenants')
    .select('id, owner_id')
    .eq('id', tenantId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  throwIfError(tenantError, 'Failed to verify tenant access')
  if (!tenant) {
    throw new AppError('Tenant not found in organization', 404)
  }

  const { data, error } = await supabaseAdmin
    .from('owners')
    .select('id, full_name, company_name, support_email, support_whatsapp, organization_id')
    .eq('id', tenant.owner_id)
    .eq('organization_id', organizationId)
    .maybeSingle()

  throwIfError(error, 'Failed to fetch owner contact')

  if (!data) {
    throw new AppError('Owner contact not found in organization', 404)
  }

  return data
}

export async function createRentReminders(input: {
  organization_id: string
  tenant_id: string
  owner_id: string
  reminder_type: string
  scheduled_for: string
}) {
  const { data, error } = await supabaseAdmin
    .from('rent_reminders')
    .upsert(
      {
        tenant_id: input.tenant_id,
        owner_id: input.owner_id,
        organization_id: input.organization_id,
        reminder_type: input.reminder_type,
        scheduled_for: input.scheduled_for,
        status: 'pending',
      },
      {
        onConflict: 'tenant_id,reminder_type,scheduled_for',
        ignoreDuplicates: true,
      },
    )
    .select('*')

  throwIfError(error, 'Failed to create reminders')
  return data ?? []
}

export async function listAllTenantsForOrganization(organizationId: string) {
  const { data, error } = await supabaseAdmin.from('tenants').select('*').eq('organization_id', organizationId)
  throwIfError(error, 'Failed to list organization tenants')
  return data ?? []
}

export async function listOrganizationReminders(organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('rent_reminders')
    .select('*')
    .eq('organization_id', organizationId)
    .order('scheduled_for', { ascending: true })

  throwIfError(error, 'Failed to list reminders')
  return data ?? []
}

export async function markReminderAsSent(reminderId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('rent_reminders')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', reminderId)
    .eq('organization_id', organizationId)
    .select('*')
    .maybeSingle()

  throwIfError(error, 'Failed to mark reminder as sent')
  return data
}
