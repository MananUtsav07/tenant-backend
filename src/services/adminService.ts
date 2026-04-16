import { prisma } from '../lib/db.js'
import { listAnalyticsEvents, summarizeAnalytics } from './analyticsService.js'
import { getOrganizationById, listOrganizationsBasic } from './organizationService.js'
import type { Prisma } from '@prisma/client'

type SortOrder = 'asc' | 'desc'
type OwnerListSortBy = 'created_at' | 'email' | 'full_name' | 'company_name'
type TenantListSortBy = 'created_at' | 'full_name' | 'payment_status' | 'status'
type PropertyListSortBy = 'created_at' | 'property_name' | 'address'
type TicketListSortBy = 'created_at' | 'status' | 'subject'
type ContactMessageSortBy = 'created_at' | 'name' | 'email'
type AnalyticsSortBy = 'created_at' | 'event_name' | 'user_type'
type OrganizationSortBy = 'created_at' | 'name' | 'slug' | 'plan_code'

type BaseListQuery<TSortBy extends string> = {
  page: number
  page_size: number
  search?: string
  sort_by: TSortBy
  sort_order: SortOrder
  organization_id?: string
}

function escapeSearchTerm(term: string): string {
  return term.replace(/[%_]/g, '').replaceAll(',', ' ').trim()
}

async function countByOrganizationIds(table: keyof typeof prisma, organizationIds: string[]): Promise<Map<string, number>> {
  if (organizationIds.length === 0) return new Map()
  // @ts-expect-error dynamic table access
  const data = await prisma[table].findMany({ select: { organization_id: true }, where: { organization_id: { in: organizationIds } } })
  const counts = new Map<string, number>()
  for (const row of data as Array<{ organization_id?: string | null }>) {
    if (row.organization_id) counts.set(row.organization_id, (counts.get(row.organization_id) ?? 0) + 1)
  }
  return counts
}

export async function findAdminByEmail(email: string) {
  return prisma.admin_users.findFirst({ select: { id: true, email: true, password_hash: true, full_name: true, created_at: true }, where: { email } })
}

export async function getAdminById(adminId: string) {
  return prisma.admin_users.findFirst({ select: { id: true, email: true, full_name: true, created_at: true }, where: { id: adminId } })
}

export async function listAdminOwners(query: BaseListQuery<OwnerListSortBy> & { plan_code?: string }) {
  const skip = (query.page - 1) * query.page_size
  const where: Prisma.ownersWhereInput = {}
  if (query.organization_id) where.organization_id = query.organization_id
  if (query.plan_code) where.organizations = { plan_code: query.plan_code }
  if (query.search?.trim()) {
    const e = escapeSearchTerm(query.search)
    if (e) where.OR = [{ email: { contains: e, mode: 'insensitive' } }, { full_name: { contains: e, mode: 'insensitive' } }, { company_name: { contains: e, mode: 'insensitive' } }]
  }
  const [items, total] = await prisma.$transaction([
    prisma.owners.findMany({ select: { id: true, organization_id: true, email: true, full_name: true, company_name: true, support_email: true, support_whatsapp: true, created_at: true, organizations: { select: { name: true, slug: true, plan_code: true } } }, where, orderBy: { [query.sort_by]: query.sort_order }, skip, take: query.page_size }),
    prisma.owners.count({ where }),
  ])
  return { items, total }
}

export async function listAdminTenants(query: BaseListQuery<TenantListSortBy>) {
  const skip = (query.page - 1) * query.page_size
  const where: Prisma.tenantsWhereInput = {}
  if (query.organization_id) where.organization_id = query.organization_id
  if (query.search?.trim()) {
    const e = escapeSearchTerm(query.search)
    if (e) where.OR = [{ full_name: { contains: e, mode: 'insensitive' } }, { email: { contains: e, mode: 'insensitive' } }, { tenant_access_id: { contains: e, mode: 'insensitive' } }]
  }
  const [items, total] = await prisma.$transaction([
    prisma.tenants.findMany({ select: { id: true, organization_id: true, owner_id: true, property_id: true, full_name: true, email: true, phone: true, tenant_access_id: true, monthly_rent: true, payment_due_day: true, payment_status: true, status: true, created_at: true, owners: { select: { email: true, company_name: true } }, properties: { select: { property_name: true, unit_number: true } }, organizations: { select: { name: true, slug: true, plan_code: true, country_code: true, currency_code: true } } }, where, orderBy: { [query.sort_by]: query.sort_order }, skip, take: query.page_size }),
    prisma.tenants.count({ where }),
  ])
  return { items, total }
}

export async function listAdminProperties(query: BaseListQuery<PropertyListSortBy>) {
  const skip = (query.page - 1) * query.page_size
  const where: Prisma.propertiesWhereInput = {}
  if (query.organization_id) where.organization_id = query.organization_id
  if (query.search?.trim()) {
    const e = escapeSearchTerm(query.search)
    if (e) where.OR = [{ property_name: { contains: e, mode: 'insensitive' } }, { address: { contains: e, mode: 'insensitive' } }, { unit_number: { contains: e, mode: 'insensitive' } }]
  }
  const [items, total] = await prisma.$transaction([
    prisma.properties.findMany({ select: { id: true, organization_id: true, owner_id: true, property_name: true, address: true, unit_number: true, created_at: true, owners: { select: { email: true, company_name: true } }, organizations: { select: { name: true, slug: true, plan_code: true } } }, where, orderBy: { [query.sort_by]: query.sort_order }, skip, take: query.page_size }),
    prisma.properties.count({ where }),
  ])
  return { items, total }
}

export async function listAdminTickets(query: BaseListQuery<TicketListSortBy>) {
  const skip = (query.page - 1) * query.page_size
  const where: Prisma.support_ticketsWhereInput = {}
  if (query.organization_id) where.organization_id = query.organization_id
  if (query.search?.trim()) {
    const e = escapeSearchTerm(query.search)
    if (e) where.OR = [{ subject: { contains: e, mode: 'insensitive' } }, { message: { contains: e, mode: 'insensitive' } }, { status: { contains: e, mode: 'insensitive' } }]
  }
  const [items, total] = await prisma.$transaction([
    prisma.support_tickets.findMany({ select: { id: true, organization_id: true, owner_id: true, tenant_id: true, subject: true, message: true, status: true, created_at: true, updated_at: true, tenants: { select: { full_name: true, tenant_access_id: true } }, owners: { select: { email: true } }, organizations: { select: { name: true, slug: true, plan_code: true } } }, where, orderBy: { [query.sort_by]: query.sort_order }, skip, take: query.page_size }),
    prisma.support_tickets.count({ where }),
  ])
  return { items, total }
}

export async function listAdminContactMessages(query: BaseListQuery<ContactMessageSortBy>) {
  const skip = (query.page - 1) * query.page_size
  const where: Prisma.contact_messagesWhereInput = {}
  if (query.organization_id) where.organization_id = query.organization_id
  if (query.search?.trim()) {
    const e = escapeSearchTerm(query.search)
    if (e) where.OR = [{ name: { contains: e, mode: 'insensitive' } }, { email: { contains: e, mode: 'insensitive' } }, { message: { contains: e, mode: 'insensitive' } }]
  }
  const [items, total] = await prisma.$transaction([
    prisma.contact_messages.findMany({ select: { id: true, organization_id: true, name: true, email: true, message: true, created_at: true, organizations: { select: { name: true, slug: true, plan_code: true } } }, where, orderBy: { [query.sort_by]: query.sort_order }, skip, take: query.page_size }),
    prisma.contact_messages.count({ where }),
  ])
  return { items, total }
}

export async function listAdminAnalytics(query: BaseListQuery<AnalyticsSortBy> & { days: number }) {
  const listed = await listAnalyticsEvents({ page: query.page, page_size: query.page_size, search: query.search, sort_by: query.sort_by, sort_order: query.sort_order, days: query.days })
  const summary = await summarizeAnalytics(query.days)
  return { ...listed, summary }
}

export async function listAdminOrganizations(query: BaseListQuery<OrganizationSortBy>) {
  const listed = await listOrganizationsBasic({ page: query.page, page_size: query.page_size, search: query.search, sort_by: query.sort_by, sort_order: query.sort_order })
  const organizationIds = listed.items.map((o) => o.id)
  const [ownersCounts, tenantsCounts, propertiesCounts, subscriptionsCounts] = await Promise.all([
    countByOrganizationIds('owners', organizationIds),
    countByOrganizationIds('tenants', organizationIds),
    countByOrganizationIds('properties', organizationIds),
    countByOrganizationIds('subscriptions', organizationIds),
  ])
  return { total: listed.total, items: listed.items.map((o) => ({ ...o, counts: { owners: ownersCounts.get(o.id) ?? 0, tenants: tenantsCounts.get(o.id) ?? 0, properties: propertiesCounts.get(o.id) ?? 0, subscriptions: subscriptionsCounts.get(o.id) ?? 0 } })) }
}

export async function getAdminOrganizationDetail(organizationId: string) {
  const organization = await getOrganizationById(organizationId)
  if (!organization) return null

  const [owners, tenants, properties, tickets, subscriptions] = await Promise.all([
    prisma.owners.findMany({ select: { id: true, email: true, full_name: true, company_name: true, support_email: true, support_whatsapp: true, created_at: true }, where: { organization_id: organizationId }, orderBy: { created_at: 'desc' }, take: 50 }),
    prisma.tenants.findMany({ select: { id: true, owner_id: true, property_id: true, full_name: true, email: true, phone: true, tenant_access_id: true, monthly_rent: true, payment_due_day: true, payment_status: true, status: true, created_at: true }, where: { organization_id: organizationId }, orderBy: { created_at: 'desc' }, take: 100 }),
    prisma.properties.findMany({ select: { id: true, owner_id: true, property_name: true, address: true, unit_number: true, created_at: true }, where: { organization_id: organizationId }, orderBy: { created_at: 'desc' }, take: 100 }),
    prisma.support_tickets.findMany({ select: { id: true, owner_id: true, tenant_id: true, subject: true, message: true, status: true, created_at: true, updated_at: true }, where: { organization_id: organizationId }, orderBy: { created_at: 'desc' }, take: 100 }),
    prisma.subscriptions.findMany({ select: { id: true, owner_id: true, organization_id: true, plan_code: true, status: true, current_period_start: true, current_period_end: true, created_at: true }, where: { organization_id: organizationId }, orderBy: { created_at: 'desc' }, take: 20 }),
  ])

  return { organization, owners, tenants, properties, tickets, subscriptions }
}

export async function getAdminDashboardSummary() {
  const [orgCount, ownerCount, tenantCount, propertyCount, openTicketCount, recentContact, recentOwners, recentTenants, analyticsSummary] = await Promise.all([
    prisma.organizations.count(),
    prisma.owners.count(),
    prisma.tenants.count(),
    prisma.properties.count(),
    prisma.support_tickets.count({ where: { status: { in: ['open', 'in_progress'] } } }),
    prisma.contact_messages.findMany({ select: { id: true, organization_id: true, name: true, email: true, message: true, created_at: true, organizations: { select: { name: true, slug: true } } }, orderBy: { created_at: 'desc' }, take: 5 }),
    prisma.owners.findMany({ select: { id: true, organization_id: true, email: true, full_name: true, created_at: true, organizations: { select: { name: true } } }, orderBy: { created_at: 'desc' }, take: 5 }),
    prisma.tenants.findMany({ select: { id: true, organization_id: true, full_name: true, email: true, created_at: true, organizations: { select: { name: true } } }, orderBy: { created_at: 'desc' }, take: 5 }),
    summarizeAnalytics(7),
  ])

  const recentRegistrations = [
    ...recentOwners.map((o) => ({ id: o.id, user_type: 'owner' as const, label: o.full_name ?? o.email, email: o.email, organization_id: o.organization_id, organization_name: (o.organizations as unknown as { name?: string } | null)?.name ?? null, created_at: o.created_at })),
    ...recentTenants.map((t) => ({ id: t.id, user_type: 'tenant' as const, label: t.full_name, email: t.email, organization_id: t.organization_id, organization_name: (t.organizations as unknown as { name?: string } | null)?.name ?? null, created_at: t.created_at })),
  ].sort((a, b) => new Date(b.created_at!).getTime() - new Date(a.created_at!).getTime()).slice(0, 6)

  return { total_organizations: orgCount, total_owners: ownerCount, total_tenants: tenantCount, total_properties: propertyCount, open_tickets: openTicketCount, recent_contact_messages: recentContact, recent_registrations: recentRegistrations, events_last_7_days: analyticsSummary.total_events, top_events: analyticsSummary.by_event.slice(0, 5) }
}

export async function getSystemHealthMetrics() {
  const start = Date.now()
  await prisma.owners.count()
  const dbLatencyMs = Date.now() - start
  return { status: 'ok', uptime_seconds: Math.round(process.uptime()), node_version: process.version, memory: { rss: process.memoryUsage().rss, heap_total: process.memoryUsage().heapTotal, heap_used: process.memoryUsage().heapUsed }, database: { status: 'ok', latency_ms: dbLatencyMs }, generated_at: new Date().toISOString() }
}

export async function listPlans() {
  return prisma.plans.findMany({ select: { plan_code: true, plan_name: true, monthly_price: true }, orderBy: { monthly_price: 'asc' } })
}

export async function patchOrganizationPlan(organizationId: string, planCode: string) {
  const plan = await prisma.plans.findFirst({ where: { plan_code: planCode } })
  if (!plan) return null

  const now = new Date()
  const nextPeriodEnd = new Date(now)
  nextPeriodEnd.setMonth(nextPeriodEnd.getMonth() + 1)

  const isTrial = planCode === 'trial'

  // Update organizations table
  const updated = await prisma.organizations.update({
    where: { id: organizationId },
    data: { plan_code: planCode },
    select: { id: true, name: true, slug: true, plan_code: true },
  })

  // Also sync the subscriptions table so billing state reflects the change
  const existingSub = await prisma.subscriptions.findFirst({ where: { organization_id: organizationId } })
  if (existingSub) {
    await prisma.subscriptions.update({
      where: { id: existingSub.id },
      data: {
        plan_code: planCode,
        status: isTrial ? 'trialing' : 'active',
        current_period_start: isTrial ? existingSub.current_period_start : now,
        current_period_end: isTrial ? existingSub.current_period_end : nextPeriodEnd,
        updated_at: now,
      },
    })
  }

  return updated
}
