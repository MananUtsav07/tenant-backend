import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'

const LEASE_RENEWAL_WINDOW_DAYS = 90

type TenantLeaseRenewalContext = {
  id: string
  organization_id: string
  owner_id: string
  property_id: string | null
  broker_id: string | null
  full_name: string
  tenant_access_id: string
  lease_end_date: string | null
  owners:
    | {
        id: string
        email: string
        full_name: string | null
        company_name: string | null
        support_email: string | null
      }
    | null
  properties:
    | {
        property_name: string | null
        unit_number: string | null
      }
    | null
  brokers:
    | {
        id: string
        full_name: string
        email: string
        agency_name: string | null
      }
    | null
}

type LeaseRenewalIntentRow = {
  id: string
  organization_id: string
  owner_id: string
  tenant_id: string
  property_id: string | null
  broker_id: string | null
  lease_end_date: string
  response: 'yes' | 'no'
  source: string
  responded_at: string
  created_at: string
  updated_at: string
}

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null
  }
  if (Array.isArray(value)) {
    return value[0] ?? null
  }
  return value
}

function toUtcDateStart(input: string | Date): Date {
  if (input instanceof Date) {
    return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()))
  }
  const [year, month, day] = input.slice(0, 10).split('-').map((part) => Number(part))
  return new Date(Date.UTC(year, month - 1, day))
}

function calculateDaysRemaining(leaseEndDate: string, now = new Date()): number {
  const leaseEndUtc = toUtcDateStart(leaseEndDate)
  const todayUtc = toUtcDateStart(now)
  return Math.ceil((leaseEndUtc.getTime() - todayUtc.getTime()) / 86400000)
}

async function getTenantLeaseRenewalContext(input: {
  tenantId: string
  organizationId: string
}): Promise<TenantLeaseRenewalContext> {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select(`
      id,
      organization_id,
      owner_id,
      property_id,
      broker_id,
      full_name,
      tenant_access_id,
      lease_end_date,
      owners(id, email, full_name, company_name, support_email),
      properties(property_name, unit_number),
      brokers(id, full_name, email, agency_name)
    `)
    .eq('id', input.tenantId)
    .eq('organization_id', input.organizationId)
    .maybeSingle()

  throwIfError(error, 'Failed to load tenant lease renewal context')
  if (!data) {
    throw new AppError('Tenant not found', 404)
  }

  const row = data as Record<string, unknown>
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    owner_id: String(row.owner_id),
    property_id: (row.property_id as string | null) ?? null,
    broker_id: (row.broker_id as string | null) ?? null,
    full_name: String(row.full_name),
    tenant_access_id: String(row.tenant_access_id),
    lease_end_date: (row.lease_end_date as string | null) ?? null,
    owners: normalizeRelation(row.owners as TenantLeaseRenewalContext['owners']),
    properties: normalizeRelation(row.properties as TenantLeaseRenewalContext['properties']),
    brokers: normalizeRelation(row.brokers as TenantLeaseRenewalContext['brokers']),
  }
}

async function getExistingIntent(input: { tenantId: string; leaseEndDate: string }) {
  const { data, error } = await supabaseAdmin
    .from('lease_renewal_intents')
    .select('*')
    .eq('tenant_id', input.tenantId)
    .eq('lease_end_date', input.leaseEndDate)
    .maybeSingle()

  throwIfError(error, 'Failed to load lease renewal preference')
  return (data as LeaseRenewalIntentRow | null) ?? null
}

export async function getTenantLeaseRenewalIntentState(input: {
  tenantId: string
  organizationId: string
  now?: Date
}) {
  const context = await getTenantLeaseRenewalContext({
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  })

  if (!context.lease_end_date) {
    return {
      eligible: false,
      lease_end_date: null,
      days_remaining: null,
      window_days: LEASE_RENEWAL_WINDOW_DAYS,
      already_responded: false,
      current_response: null as 'yes' | 'no' | null,
      responded_at: null as string | null,
    }
  }

  const daysRemaining = calculateDaysRemaining(context.lease_end_date, input.now)
  const isInsideWindow = daysRemaining <= LEASE_RENEWAL_WINDOW_DAYS && daysRemaining >= 0
  const intent = await getExistingIntent({
    tenantId: context.id,
    leaseEndDate: context.lease_end_date,
  })

  return {
    eligible: isInsideWindow,
    lease_end_date: context.lease_end_date,
    days_remaining: daysRemaining,
    window_days: LEASE_RENEWAL_WINDOW_DAYS,
    already_responded: Boolean(intent),
    current_response: intent?.response ?? null,
    responded_at: intent?.responded_at ?? null,
  }
}

export async function submitTenantLeaseRenewalIntent(input: {
  tenantId: string
  organizationId: string
  decision: 'yes' | 'no'
  now?: Date
}) {
  const context = await getTenantLeaseRenewalContext({
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  })

  if (!context.lease_end_date) {
    throw new AppError('Lease end date is not set for this tenant', 400)
  }

  const daysRemaining = calculateDaysRemaining(context.lease_end_date, input.now)
  if (daysRemaining > LEASE_RENEWAL_WINDOW_DAYS || daysRemaining < 0) {
    throw new AppError(
      `Lease preference can be submitted only within ${LEASE_RENEWAL_WINDOW_DAYS} days before lease end`,
      400,
    )
  }

  const existingIntent = await getExistingIntent({
    tenantId: context.id,
    leaseEndDate: context.lease_end_date,
  })
  if (existingIntent) {
    throw new AppError('Lease preference is already submitted and cannot be changed', 409)
  }

  const respondedAt = (input.now ?? new Date()).toISOString()
  const { data, error } = await supabaseAdmin
    .from('lease_renewal_intents')
    .insert({
      organization_id: context.organization_id,
      owner_id: context.owner_id,
      tenant_id: context.id,
      property_id: context.property_id,
      broker_id: context.broker_id,
      lease_end_date: context.lease_end_date,
      response: input.decision,
      source: 'tenant_dashboard',
      responded_at: respondedAt,
    })
    .select('*')
    .single()

  throwIfError(error, 'Failed to save lease renewal preference')

  return {
    intent: data as LeaseRenewalIntentRow,
    context,
    days_remaining: daysRemaining,
  }
}
