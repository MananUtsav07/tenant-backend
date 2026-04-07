import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/db.js'
import { resolveCurrencyCode, type SupportedCountryCode } from '../config/countryCurrency.js'
import { generateTenantAccessId } from '../utils/ids.js'
import { getCurrentCycleYearMonth, resolveTenantPaymentStatus, type TenantPaymentStatus } from '../utils/paymentStatus.js'
import { isTicketSummarizationEnabled } from './ai/featureFlags.js'
import { createOrganization, upsertOwnerMembership } from './organizationService.js'
import { upsertOwnerWhatsAppLink, upsertTenantWhatsAppLink } from './whatsappLinkService.js'

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
  if (input.tenantIds.length === 0) return new Set<string>()

  const { cycleYear, cycleMonth } = getCurrentCycleYearMonth(input.now)
  const data = await prisma.rent_payment_approvals.findMany({
    select: { tenant_id: true },
    where: {
      organization_id: input.organizationId,
      cycle_year: cycleYear,
      cycle_month: cycleMonth,
      status: 'approved',
      tenant_id: { in: input.tenantIds },
    },
  })

  return new Set<string>(data.map((row) => row.tenant_id as string))
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
  return prisma.owners.findFirst({
    where: { email },
    include: { organizations: { select: { id: true, name: true, slug: true, plan_code: true, country_code: true, currency_code: true, created_at: true } } },
  })
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
    const data = await prisma.owners.create({
      data: {
        email: input.email,
        password_hash: input.password_hash,
        full_name: input.full_name ?? null,
        company_name: input.company_name ?? null,
        support_email: input.support_email ?? input.email,
        support_whatsapp: input.support_whatsapp ?? null,
        organization_id: organization.id,
      },
      include: { organizations: { select: { id: true, name: true, slug: true, plan_code: true, country_code: true, currency_code: true, created_at: true } } },
    })

    await upsertOwnerMembership({ organization_id: organization.id, owner_id: data.id, role: 'owner' })
    await upsertOwnerWhatsAppLink({ organizationId: organization.id, ownerId: data.id, phoneNumber: input.support_whatsapp ?? null, linkedVia: 'owner_profile' })

    return data
  } catch (error) {
    if (!input.organization_id) {
      await prisma.organizations.delete({ where: { id: organization.id } }).catch(() => {})
    }
    throw error
  }
}

export async function getOwnerById(ownerId: string, organizationId?: string) {
  return prisma.owners.findFirst({
    where: { id: ownerId, ...(organizationId ? { organization_id: organizationId } : {}) },
    include: { organizations: { select: { id: true, name: true, slug: true, plan_code: true, country_code: true, currency_code: true, created_at: true } } },
  })
}

export async function updateOwnerById(input: {
  ownerId: string
  organizationId?: string
  patch: Partial<{ support_email: string | null; support_whatsapp: string | null }>
}) {
  const data = await prisma.owners.update({
    where: { id: input.ownerId },
    data: { ...input.patch, updated_at: new Date() },
    include: { organizations: { select: { id: true, name: true, slug: true, plan_code: true, country_code: true, currency_code: true, created_at: true } } },
  })

  if (Object.prototype.hasOwnProperty.call(input.patch, 'support_whatsapp')) {
    await upsertOwnerWhatsAppLink({ organizationId: data.organization_id, ownerId: data.id, phoneNumber: input.patch.support_whatsapp ?? null, linkedVia: 'owner_profile' })
  }
  return data
}

export async function createProperty(args: {
  ownerId: string
  organizationId: string
  input: { property_name: string; address: string; unit_number?: string }
}) {
  return prisma.properties.create({
    data: {
      owner_id: args.ownerId,
      organization_id: args.organizationId,
      property_name: args.input.property_name,
      address: args.input.address,
      unit_number: args.input.unit_number ?? null,
    },
  })
}

export async function listProperties(organizationId: string) {
  return prisma.properties.findMany({ where: { organization_id: organizationId }, orderBy: { created_at: 'desc' } })
}

export async function getPropertyForOwner(organizationId: string, propertyId: string) {
  return prisma.properties.findFirst({ where: { id: propertyId, organization_id: organizationId } })
}

export async function updateProperty(organizationId: string, propertyId: string, patch: Record<string, unknown>) {
  return prisma.properties.update({ where: { id: propertyId }, data: patch })
}

export async function deleteProperty(organizationId: string, propertyId: string) {
  const existing = await prisma.properties.findFirst({ where: { id: propertyId, organization_id: organizationId }, select: { id: true } })
  if (!existing) return 0

  const activeTenantCount = await prisma.tenants.count({
    where: { property_id: propertyId, organization_id: organizationId, status: { in: ['active', 'inactive'] } },
  })
  if (activeTenantCount > 0) {
    throw new AppError(`Cannot delete property: ${activeTenantCount} tenant(s) are still assigned to it. Terminate or reassign them first.`, 409)
  }

  await prisma.properties.delete({ where: { id: propertyId } })
  return 1
}

async function buildUniqueTenantAccessId(): Promise<string> {
  for (let attempts = 0; attempts < 8; attempts++) {
    const candidate = generateTenantAccessId()
    const existing = await prisma.tenants.findFirst({ where: { tenant_access_id: candidate }, select: { id: true } })
    if (!existing) return candidate
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

  const data = await prisma.tenants.create({
    data: {
      owner_id: args.ownerId,
      organization_id: args.organizationId,
      property_id: args.input.property_id,
      broker_id: args.input.broker_id ?? null,
      full_name: args.input.full_name,
      email: args.input.email ?? null,
      phone: args.input.phone ?? null,
      tenant_access_id: tenantAccessId,
      password_hash: args.input.password_hash,
      lease_start_date: args.input.lease_start_date ? new Date(args.input.lease_start_date) : null,
      lease_end_date: args.input.lease_end_date ? new Date(args.input.lease_end_date) : null,
      monthly_rent: args.input.monthly_rent,
      payment_due_day: args.input.payment_due_day,
      payment_status: args.input.payment_status ?? 'pending',
      status: args.input.status ?? 'active',
    },
  })

  await upsertTenantWhatsAppLink({ organizationId: args.organizationId, tenantId: data.id, ownerId: args.ownerId, phoneNumber: args.input.phone ?? null, linkedVia: 'tenant_phone' })
  return data
}

export async function listTenants(organizationId: string) {
  const data = await prisma.tenants.findMany({
    where: { organization_id: organizationId },
    include: { properties: { select: { id: true, property_name: true, address: true, unit_number: true } }, brokers: { select: { id: true, full_name: true, email: true, phone: true, agency_name: true, is_active: true } } },
    orderBy: { created_at: 'desc' },
  })

  const tenants = data as unknown as TenantWithPaymentFields[]
  const now = new Date()
  const approvedTenantIds = await listApprovedTenantIdsForCurrentCycle({ organizationId, tenantIds: tenants.map((t) => t.id), now })
  return applyComputedPaymentStatus(data as unknown as TenantWithPaymentFields[], approvedTenantIds, now)
}

export async function getTenantForOwner(organizationId: string, tenantId: string) {
  const data = await prisma.tenants.findFirst({
    where: { id: tenantId, organization_id: organizationId },
    include: { properties: true, brokers: { select: { id: true, full_name: true, email: true, phone: true, agency_name: true, is_active: true } } },
  })

  if (!data) return null

  const now = new Date()
  const approvedTenantIds = await listApprovedTenantIdsForCurrentCycle({ organizationId, tenantIds: [data.id], now })
  return applyComputedPaymentStatus([data as unknown as TenantWithPaymentFields], approvedTenantIds, now)[0]
}

export async function updateTenant(organizationId: string, tenantId: string, patch: Record<string, unknown>) {
  return prisma.tenants.update({ where: { id: tenantId }, data: patch })
}

export async function deleteTenant(organizationId: string, tenantId: string) {
  const existing = await prisma.tenants.findFirst({ where: { id: tenantId, organization_id: organizationId }, select: { id: true } })
  if (!existing) return 0
  await prisma.tenants.delete({ where: { id: tenantId } })
  return 1
}

export async function getTenantDetailAggregate(organizationId: string, tenantId: string) {
  const tenant = await getTenantForOwner(organizationId, tenantId)
  if (!tenant) return null

  await isTicketSummarizationEnabled(organizationId)

  const [tickets, reminders] = await Promise.all([
    prisma.support_tickets.findMany({ where: { tenant_id: tenantId, organization_id: organizationId }, orderBy: { created_at: 'desc' } }),
    prisma.rent_reminders.findMany({ where: { tenant_id: tenantId, organization_id: organizationId }, orderBy: { scheduled_for: 'desc' } }),
  ])

  return { tenant, tickets, reminders }
}

export async function listOwnerTickets(organizationId: string) {
  return prisma.support_tickets.findMany({
    where: { organization_id: organizationId },
    include: { tenants: { select: { id: true, full_name: true, tenant_access_id: true, property_id: true, properties: { select: { id: true, property_name: true } } } } },
    orderBy: { created_at: 'desc' },
  })
}

export async function updateOwnerTicket(organizationId: string, ticketId: string, status: string) {
  return prisma.support_tickets.update({ where: { id: ticketId }, data: { status, updated_at: new Date() } })
}

export async function listOwnerNotifications(organizationId: string, ownerId: string) {
  return prisma.owner_notifications.findMany({
    where: { organization_id: organizationId, owner_id: ownerId },
    include: { tenants: { select: { id: true, full_name: true, tenant_access_id: true } } },
    orderBy: { created_at: 'desc' },
  })
}

export async function markNotificationRead(organizationId: string, ownerId: string, notificationId: string) {
  return prisma.owner_notifications.update({ where: { id: notificationId }, data: { is_read: true } })
}

export async function markAllNotificationsRead(organizationId: string, ownerId: string) {
  const result = await prisma.owner_notifications.updateMany({ where: { organization_id: organizationId, owner_id: ownerId, is_read: false }, data: { is_read: true } })
  return result.count
}

export async function createOwnerNotification(input: {
  organization_id: string
  owner_id: string
  tenant_id?: string | null
  notification_type: string
  title: string
  message: string
}) {
  return prisma.owner_notifications.create({
    data: {
      owner_id: input.owner_id,
      tenant_id: input.tenant_id ?? null,
      notification_type: input.notification_type,
      title: input.title,
      message: input.message,
      organization_id: input.organization_id,
    },
  })
}

export async function getOwnerDashboardSummary(organizationId: string, ownerId?: string) {
  const [activeTenants, openTicketsCount, pendingRemindersCount, unreadNotificationsCount] = await Promise.all([
    prisma.tenants.findMany({ select: { id: true, payment_due_day: true, payment_status: true }, where: { organization_id: organizationId, status: 'active' } }),
    prisma.support_tickets.count({ where: { organization_id: organizationId, status: { in: ['open', 'in_progress'] } } }),
    prisma.rent_reminders.count({ where: { organization_id: organizationId, status: 'pending' } }),
    prisma.owner_notifications.count({ where: { organization_id: organizationId, owner_id: ownerId ?? '', is_read: false } }),
  ])

  let awaitingApprovals = 0
  if (ownerId) {
    awaitingApprovals = await prisma.rent_payment_approvals.count({ where: { organization_id: organizationId, owner_id: ownerId, status: 'awaiting_owner_approval' } })
  }

  const now = new Date()
  const approvedTenantIds = await listApprovedTenantIdsForCurrentCycle({ organizationId, tenantIds: activeTenants.map((t) => t.id), now })
  const overdueCount = applyComputedPaymentStatus(activeTenants as unknown as TenantWithPaymentFields[], approvedTenantIds, now).filter((t) => t.payment_status === 'overdue').length

  return {
    active_tenants: activeTenants.length,
    open_tickets: openTicketsCount,
    overdue_rent: overdueCount,
    reminders_pending: pendingRemindersCount,
    unread_notifications: unreadNotificationsCount,
    awaiting_approvals: awaitingApprovals,
  }
}
