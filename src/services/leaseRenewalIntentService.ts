import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/db.js'

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
  owners: { id: string; email: string; full_name: string | null; company_name: string | null; support_email: string | null } | null
  properties: { property_name: string | null; unit_number: string | null } | null
  brokers: { id: string; full_name: string; email: string; agency_name: string | null } | null
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

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null
  if (Array.isArray(value)) return value[0] ?? null
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

function serializeIntent(row: {
  id: string
  organization_id: string
  owner_id: string | null
  tenant_id: string | null
  property_id: string | null
  broker_id: string | null
  lease_end_date: Date | string
  response: string
  source: string
  responded_at: Date | string
  created_at: Date | string
  updated_at: Date | string
}): LeaseRenewalIntentRow {
  return {
    id: row.id,
    organization_id: row.organization_id,
    owner_id: row.owner_id ?? '',
    tenant_id: row.tenant_id ?? '',
    property_id: row.property_id,
    broker_id: row.broker_id,
    lease_end_date: row.lease_end_date instanceof Date ? row.lease_end_date.toISOString().slice(0, 10) : String(row.lease_end_date),
    response: row.response as 'yes' | 'no',
    source: row.source,
    responded_at: row.responded_at instanceof Date ? row.responded_at.toISOString() : String(row.responded_at),
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  }
}

async function getTenantLeaseRenewalContext(input: { tenantId: string; organizationId: string }): Promise<TenantLeaseRenewalContext> {
  const row = await prisma.tenants.findFirst({
    select: {
      id: true,
      organization_id: true,
      owner_id: true,
      property_id: true,
      broker_id: true,
      full_name: true,
      tenant_access_id: true,
      lease_end_date: true,
      owners: { select: { id: true, email: true, full_name: true, company_name: true, support_email: true } },
      properties: { select: { property_name: true, unit_number: true } },
      brokers: { select: { id: true, full_name: true, email: true, agency_name: true } },
    },
    where: { id: input.tenantId, organization_id: input.organizationId },
  })

  if (!row) throw new AppError('Tenant not found', 404)

  return {
    id: row.id,
    organization_id: row.organization_id,
    owner_id: row.owner_id ?? '',
    property_id: row.property_id,
    broker_id: row.broker_id,
    full_name: row.full_name,
    tenant_access_id: row.tenant_access_id,
    lease_end_date: row.lease_end_date instanceof Date ? row.lease_end_date.toISOString().slice(0, 10) : (row.lease_end_date as string | null),
    owners: normalizeRelation(row.owners as TenantLeaseRenewalContext['owners'] | TenantLeaseRenewalContext['owners'][]),
    properties: normalizeRelation(row.properties as TenantLeaseRenewalContext['properties'] | TenantLeaseRenewalContext['properties'][]),
    brokers: normalizeRelation(row.brokers as TenantLeaseRenewalContext['brokers'] | TenantLeaseRenewalContext['brokers'][]),
  }
}

async function getExistingIntent(input: { tenantId: string; leaseEndDate: string }) {
  const row = await prisma.lease_renewal_intents.findFirst({
    where: { tenant_id: input.tenantId, lease_end_date: new Date(input.leaseEndDate) },
  })
  return row ? serializeIntent(row) : null
}

export async function getTenantLeaseRenewalIntentState(input: { tenantId: string; organizationId: string; now?: Date }) {
  const context = await getTenantLeaseRenewalContext({ tenantId: input.tenantId, organizationId: input.organizationId })

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
  const intent = await getExistingIntent({ tenantId: context.id, leaseEndDate: context.lease_end_date })

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

export async function submitTenantLeaseRenewalIntent(input: { tenantId: string; organizationId: string; decision: 'yes' | 'no'; now?: Date }) {
  const context = await getTenantLeaseRenewalContext({ tenantId: input.tenantId, organizationId: input.organizationId })

  if (!context.lease_end_date) {
    throw new AppError('Lease end date is not set for this tenant', 400)
  }

  const daysRemaining = calculateDaysRemaining(context.lease_end_date, input.now)
  if (daysRemaining > LEASE_RENEWAL_WINDOW_DAYS || daysRemaining < 0) {
    throw new AppError(`Lease preference can be submitted only within ${LEASE_RENEWAL_WINDOW_DAYS} days before lease end`, 400)
  }

  const existingIntent = await getExistingIntent({ tenantId: context.id, leaseEndDate: context.lease_end_date })
  if (existingIntent) {
    throw new AppError('Lease preference is already submitted and cannot be changed', 409)
  }

  const respondedAt = input.now ?? new Date()
  const row = await prisma.lease_renewal_intents.create({
    data: {
      organization_id: context.organization_id,
      owner_id: context.owner_id,
      tenant_id: context.id,
      property_id: context.property_id,
      broker_id: context.broker_id,
      lease_end_date: new Date(context.lease_end_date),
      response: input.decision,
      source: 'tenant_dashboard',
      responded_at: respondedAt,
    },
  })

  return { intent: serializeIntent(row), context, days_remaining: daysRemaining }
}
