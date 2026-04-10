import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/db.js'
import { upsertTenantWhatsAppLink } from './whatsappLinkService.js'
import { getCurrentCycleYearMonth, resolveTenantPaymentStatus } from '../utils/paymentStatus.js'

async function hasApprovedRentPaymentForCurrentCycle(input: {
  tenantId: string
  organizationId: string
  now?: Date
}): Promise<boolean> {
  const { cycleYear, cycleMonth } = getCurrentCycleYearMonth(input.now)
  const data = await prisma.rent_payment_approvals.findFirst({
    select: { id: true },
    where: {
      organization_id: input.organizationId,
      tenant_id: input.tenantId,
      cycle_year: cycleYear,
      cycle_month: cycleMonth,
      status: 'approved',
    },
  })
  return Boolean(data)
}

export async function findTenantByAccessId(tenantAccessId: string) {
  return prisma.tenants.findFirst({
    where: { tenant_access_id: tenantAccessId },
    include: {
      owners: true,
      organizations: { select: { id: true, name: true, slug: true, plan_code: true, country_code: true, currency_code: true, created_at: true } },
    },
  })
}

export async function getTenantById(tenantId: string, organizationId?: string) {
  const data = await prisma.tenants.findFirst({
    where: { id: tenantId, ...(organizationId ? { organization_id: organizationId } : {}) },
    include: {
      owners: true,
      properties: true,
      brokers: { select: { id: true, full_name: true, email: true, phone: true, agency_name: true, is_active: true } },
      organizations: { select: { id: true, name: true, slug: true, plan_code: true, country_code: true, currency_code: true, created_at: true } },
    },
  })

  if (!data) return null

  const now = new Date()
  const approvedForCurrentCycle = await hasApprovedRentPaymentForCurrentCycle({ tenantId: data.id, organizationId: data.organization_id, now })

  return {
    ...data,
    payment_status: resolveTenantPaymentStatus({
      paymentStatus: data.payment_status as import('../utils/paymentStatus.js').TenantPaymentStatus,
      paymentDueDay: data.payment_due_day,
      isCurrentCycleApproved: approvedForCurrentCycle,
      now,
    }),
  }
}

export async function getTenantSummary(tenantId: string, organizationId: string) {
  const [openTicketsCount, pendingRemindersCount] = await Promise.all([
    prisma.support_tickets.count({ where: { organization_id: organizationId, tenant_id: tenantId, status: { in: ['open', 'in_progress'] } } }),
    prisma.rent_reminders.count({ where: { organization_id: organizationId, tenant_id: tenantId, status: 'pending' } }),
  ])

  return { open_tickets: openTicketsCount, pending_reminders: pendingRemindersCount }
}

export async function listTenantTickets(tenantId: string, organizationId: string) {
  return prisma.support_tickets.findMany({ where: { organization_id: organizationId, tenant_id: tenantId }, orderBy: { created_at: 'desc' } })
}

export async function createTenantTicket(input: {
  organization_id: string
  tenant_id: string
  owner_id: string
  subject: string
  message: string
}) {
  const data = await prisma.support_tickets.create({
    data: {
      tenant_id: input.tenant_id,
      owner_id: input.owner_id,
      organization_id: input.organization_id,
      subject: input.subject,
      message: input.message,
      status: 'open',
    },
  })

  return data
}

export async function getOwnerContactByTenant(tenantId: string, organizationId: string) {
  const tenant = await prisma.tenants.findFirst({ select: { id: true, owner_id: true }, where: { id: tenantId, organization_id: organizationId } })
  if (!tenant) throw new AppError('Tenant not found in organization', 404)

  const owner = await prisma.owners.findFirst({
    select: { id: true, full_name: true, company_name: true, support_email: true, support_whatsapp: true, organization_id: true },
    where: { id: tenant.owner_id, organization_id: organizationId },
  })
  if (!owner) throw new AppError('Owner contact not found in organization', 404)

  return owner
}

export async function createRentReminders(input: {
  organization_id: string
  tenant_id: string
  owner_id: string
  reminder_type: string
  scheduled_for: string
}) {
  await prisma.rent_reminders.upsert({
    where: { tenant_id_reminder_type_scheduled_for: { tenant_id: input.tenant_id, reminder_type: input.reminder_type, scheduled_for: new Date(input.scheduled_for) } },
    create: {
      tenant_id: input.tenant_id,
      owner_id: input.owner_id,
      organization_id: input.organization_id,
      reminder_type: input.reminder_type,
      scheduled_for: new Date(input.scheduled_for),
      status: 'pending',
    },
    update: {},
  })
  return []
}

export async function listAllTenantsForOrganization(organizationId: string) {
  return prisma.tenants.findMany({ where: { organization_id: organizationId } })
}

export async function listOrganizationReminders(organizationId: string) {
  return prisma.rent_reminders.findMany({ where: { organization_id: organizationId }, orderBy: { scheduled_for: 'asc' } })
}

export async function updateTenantPhone(input: { tenantId: string; organizationId: string; phone: string | null }) {
  const data = await prisma.tenants.update({ where: { id: input.tenantId }, data: { phone: input.phone } })
  await upsertTenantWhatsAppLink({ organizationId: input.organizationId, tenantId: input.tenantId, ownerId: data.owner_id ?? null, phoneNumber: input.phone, linkedVia: 'tenant_phone' })
  return data
}

export async function markReminderAsSent(reminderId: string, organizationId: string) {
  return prisma.rent_reminders.update({ where: { id: reminderId }, data: { status: 'sent', sent_at: new Date() } })
}
