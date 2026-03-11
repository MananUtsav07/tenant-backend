import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { listAnalyticsEvents, summarizeAnalytics } from './analyticsService.js'
import { getOrganizationById, listOrganizationsBasic } from './organizationService.js'

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

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

function escapeSearchTerm(term: string): string {
  return term.replace(/[%_]/g, '').replaceAll(',', ' ').trim()
}

function toRange(page: number, pageSize: number) {
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  return { from, to }
}

function applyOrganizationFilter<T extends { eq: (column: string, value: string) => T }>(request: T, organizationId?: string) {
  if (!organizationId) {
    return request
  }
  return request.eq('organization_id', organizationId)
}

async function countByOrganizationIds(table: string, organizationIds: string[]): Promise<Map<string, number>> {
  if (organizationIds.length === 0) {
    return new Map()
  }

  const { data, error } = await supabaseAdmin
    .from(table)
    .select('organization_id')
    .in('organization_id', organizationIds)
  throwIfError(error, `Failed to load organization counts from ${table}`)

  const counts = new Map<string, number>()
  for (const row of data ?? []) {
    const organizationId = (row as { organization_id?: string | null }).organization_id
    if (!organizationId) {
      continue
    }
    counts.set(organizationId, (counts.get(organizationId) ?? 0) + 1)
  }

  return counts
}

export async function findAdminByEmail(email: string) {
  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .select('id, email, password_hash, full_name, created_at')
    .eq('email', email)
    .maybeSingle()

  throwIfError(error, 'Failed to query admin user')
  return data
}

export async function getAdminById(adminId: string) {
  const { data, error } = await supabaseAdmin
    .from('admin_users')
    .select('id, email, full_name, created_at')
    .eq('id', adminId)
    .maybeSingle()

  throwIfError(error, 'Failed to query admin user')
  return data
}

export async function listAdminOwners(query: BaseListQuery<OwnerListSortBy>) {
  const { from, to } = toRange(query.page, query.page_size)
  let request = supabaseAdmin
    .from('owners')
    .select(
      'id, organization_id, email, full_name, company_name, support_email, support_whatsapp, created_at, organizations(name, slug, plan_code)',
      {
        count: 'exact',
      },
    )
    .order(query.sort_by, { ascending: query.sort_order === 'asc' })
    .range(from, to)

  request = applyOrganizationFilter(request, query.organization_id)

  if (query.search && query.search.trim().length > 0) {
    const escaped = escapeSearchTerm(query.search)
    if (escaped.length > 0) {
      request = request.or(`email.ilike.%${escaped}%,full_name.ilike.%${escaped}%,company_name.ilike.%${escaped}%`)
    }
  }

  const { data, error, count } = await request
  throwIfError(error, 'Failed to list owners')
  return { items: data ?? [], total: count ?? 0 }
}

export async function listAdminTenants(query: BaseListQuery<TenantListSortBy>) {
  const { from, to } = toRange(query.page, query.page_size)
  let request = supabaseAdmin
    .from('tenants')
    .select(
      'id, organization_id, owner_id, property_id, full_name, email, phone, tenant_access_id, monthly_rent, payment_due_day, payment_status, status, created_at, owners(email, company_name), properties(property_name, unit_number), organizations(name, slug, plan_code, country_code, currency_code)',
      { count: 'exact' },
    )
    .order(query.sort_by, { ascending: query.sort_order === 'asc' })
    .range(from, to)

  request = applyOrganizationFilter(request, query.organization_id)

  if (query.search && query.search.trim().length > 0) {
    const escaped = escapeSearchTerm(query.search)
    if (escaped.length > 0) {
      request = request.or(`full_name.ilike.%${escaped}%,email.ilike.%${escaped}%,tenant_access_id.ilike.%${escaped}%`)
    }
  }

  const { data, error, count } = await request
  throwIfError(error, 'Failed to list tenants')
  return { items: data ?? [], total: count ?? 0 }
}

export async function listAdminProperties(query: BaseListQuery<PropertyListSortBy>) {
  const { from, to } = toRange(query.page, query.page_size)
  let request = supabaseAdmin
    .from('properties')
    .select(
      'id, organization_id, owner_id, property_name, address, unit_number, created_at, owners(email, company_name), organizations(name, slug, plan_code)',
      { count: 'exact' },
    )
    .order(query.sort_by, { ascending: query.sort_order === 'asc' })
    .range(from, to)

  request = applyOrganizationFilter(request, query.organization_id)

  if (query.search && query.search.trim().length > 0) {
    const escaped = escapeSearchTerm(query.search)
    if (escaped.length > 0) {
      request = request.or(`property_name.ilike.%${escaped}%,address.ilike.%${escaped}%,unit_number.ilike.%${escaped}%`)
    }
  }

  const { data, error, count } = await request
  throwIfError(error, 'Failed to list properties')
  return { items: data ?? [], total: count ?? 0 }
}

export async function listAdminTickets(query: BaseListQuery<TicketListSortBy>) {
  const { from, to } = toRange(query.page, query.page_size)
  let request = supabaseAdmin
    .from('support_tickets')
    .select(
      'id, organization_id, owner_id, tenant_id, subject, message, status, created_at, updated_at, tenants(full_name, tenant_access_id), owners(email), organizations(name, slug, plan_code)',
      { count: 'exact' },
    )
    .order(query.sort_by, { ascending: query.sort_order === 'asc' })
    .range(from, to)

  request = applyOrganizationFilter(request, query.organization_id)

  if (query.search && query.search.trim().length > 0) {
    const escaped = escapeSearchTerm(query.search)
    if (escaped.length > 0) {
      request = request.or(`subject.ilike.%${escaped}%,message.ilike.%${escaped}%,status.ilike.%${escaped}%`)
    }
  }

  const { data, error, count } = await request
  throwIfError(error, 'Failed to list tickets')
  return { items: data ?? [], total: count ?? 0 }
}

export async function listAdminContactMessages(query: BaseListQuery<ContactMessageSortBy>) {
  const { from, to } = toRange(query.page, query.page_size)
  let request = supabaseAdmin
    .from('contact_messages')
    .select('id, organization_id, name, email, message, created_at, organizations(name, slug, plan_code)', {
      count: 'exact',
    })
    .order(query.sort_by, { ascending: query.sort_order === 'asc' })
    .range(from, to)

  request = applyOrganizationFilter(request, query.organization_id)

  if (query.search && query.search.trim().length > 0) {
    const escaped = escapeSearchTerm(query.search)
    if (escaped.length > 0) {
      request = request.or(`name.ilike.%${escaped}%,email.ilike.%${escaped}%,message.ilike.%${escaped}%`)
    }
  }

  const { data, error, count } = await request
  throwIfError(error, 'Failed to list contact messages')
  return { items: data ?? [], total: count ?? 0 }
}

export async function listAdminAnalytics(
  query: BaseListQuery<AnalyticsSortBy> & {
    days: number
  },
) {
  const listed = await listAnalyticsEvents({
    page: query.page,
    page_size: query.page_size,
    search: query.search,
    sort_by: query.sort_by,
    sort_order: query.sort_order,
    days: query.days,
  })

  const summary = await summarizeAnalytics(query.days)
  return {
    ...listed,
    summary,
  }
}

export async function listAdminOrganizations(query: BaseListQuery<OrganizationSortBy>) {
  const listed = await listOrganizationsBasic({
    page: query.page,
    page_size: query.page_size,
    search: query.search,
    sort_by: query.sort_by,
    sort_order: query.sort_order,
  })

  const organizationIds = listed.items.map((organization) => organization.id)

  const [ownersCounts, tenantsCounts, propertiesCounts, subscriptionsCounts] = await Promise.all([
    countByOrganizationIds('owners', organizationIds),
    countByOrganizationIds('tenants', organizationIds),
    countByOrganizationIds('properties', organizationIds),
    countByOrganizationIds('subscriptions', organizationIds),
  ])

  return {
    total: listed.total,
    items: listed.items.map((organization) => ({
      ...organization,
      counts: {
        owners: ownersCounts.get(organization.id) ?? 0,
        tenants: tenantsCounts.get(organization.id) ?? 0,
        properties: propertiesCounts.get(organization.id) ?? 0,
        subscriptions: subscriptionsCounts.get(organization.id) ?? 0,
      },
    })),
  }
}

export async function getAdminOrganizationDetail(organizationId: string) {
  const organization = await getOrganizationById(organizationId)
  if (!organization) {
    return null
  }

  const [ownersResult, tenantsResult, propertiesResult, ticketsResult, subscriptionsResult] = await Promise.all([
    applyOrganizationFilter(
      supabaseAdmin
        .from('owners')
        .select('id, email, full_name, company_name, support_email, support_whatsapp, created_at')
        .order('created_at', { ascending: false })
        .limit(50),
      organizationId,
    ),
    applyOrganizationFilter(
      supabaseAdmin
        .from('tenants')
        .select(
          'id, owner_id, property_id, full_name, email, phone, tenant_access_id, monthly_rent, payment_due_day, payment_status, status, created_at',
        )
        .order('created_at', { ascending: false })
        .limit(100),
      organizationId,
    ),
    applyOrganizationFilter(
      supabaseAdmin
        .from('properties')
        .select('id, owner_id, property_name, address, unit_number, created_at')
        .order('created_at', { ascending: false })
        .limit(100),
      organizationId,
    ),
    applyOrganizationFilter(
      supabaseAdmin
        .from('support_tickets')
        .select('id, owner_id, tenant_id, subject, message, status, created_at, updated_at')
        .order('created_at', { ascending: false })
        .limit(100),
      organizationId,
    ),
    applyOrganizationFilter(
      supabaseAdmin
        .from('subscriptions')
        .select(
          'id, owner_id, organization_id, plan_code, status, current_period_start, current_period_end, created_at',
        )
        .order('created_at', { ascending: false })
        .limit(20),
      organizationId,
    ),
  ])

  throwIfError(ownersResult.error, 'Failed to load organization owners')
  throwIfError(tenantsResult.error, 'Failed to load organization tenants')
  throwIfError(propertiesResult.error, 'Failed to load organization properties')
  throwIfError(ticketsResult.error, 'Failed to load organization tickets')
  throwIfError(subscriptionsResult.error, 'Failed to load organization subscriptions')

  return {
    organization,
    owners: ownersResult.data ?? [],
    tenants: tenantsResult.data ?? [],
    properties: propertiesResult.data ?? [],
    tickets: ticketsResult.data ?? [],
    subscriptions: subscriptionsResult.data ?? [],
  }
}

export async function getAdminDashboardSummary() {
  const [organizationsResult, ownersResult, tenantsResult, propertiesResult, openTicketsResult, recentContactResult, ownersRecentResult, tenantsRecentResult, analyticsSummary] =
    await Promise.all([
      supabaseAdmin.from('organizations').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('owners').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('tenants').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('properties').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('support_tickets').select('id', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
      supabaseAdmin
        .from('contact_messages')
        .select('id, organization_id, name, email, message, created_at, organizations(name, slug)')
        .order('created_at', { ascending: false })
        .limit(5),
      supabaseAdmin
        .from('owners')
        .select('id, organization_id, email, full_name, created_at, organizations(name)')
        .order('created_at', { ascending: false })
        .limit(5),
      supabaseAdmin
        .from('tenants')
        .select('id, organization_id, full_name, email, created_at, organizations(name)')
        .order('created_at', { ascending: false })
        .limit(5),
      summarizeAnalytics(7),
    ])

  throwIfError(organizationsResult.error, 'Failed to count organizations')
  throwIfError(ownersResult.error, 'Failed to count owners')
  throwIfError(tenantsResult.error, 'Failed to count tenants')
  throwIfError(propertiesResult.error, 'Failed to count properties')
  throwIfError(openTicketsResult.error, 'Failed to count open tickets')
  throwIfError(recentContactResult.error, 'Failed to load recent contact messages')
  throwIfError(ownersRecentResult.error, 'Failed to load owner registrations')
  throwIfError(tenantsRecentResult.error, 'Failed to load tenant registrations')

  const recentRegistrations = [
    ...((ownersRecentResult.data ?? []) as Array<Record<string, any>>).map((owner) => ({
      id: owner.id,
      user_type: 'owner' as const,
      label: owner.full_name ?? owner.email,
      email: owner.email,
      organization_id: owner.organization_id,
      organization_name: Array.isArray(owner.organizations) ? owner.organizations[0]?.name ?? null : owner.organizations?.name ?? null,
      created_at: owner.created_at,
    })),
    ...((tenantsRecentResult.data ?? []) as Array<Record<string, any>>).map((tenant) => ({
      id: tenant.id,
      user_type: 'tenant' as const,
      label: tenant.full_name,
      email: tenant.email,
      organization_id: tenant.organization_id,
      organization_name: Array.isArray(tenant.organizations) ? tenant.organizations[0]?.name ?? null : tenant.organizations?.name ?? null,
      created_at: tenant.created_at,
    })),
  ]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 6)

  return {
    total_organizations: organizationsResult.count ?? 0,
    total_owners: ownersResult.count ?? 0,
    total_tenants: tenantsResult.count ?? 0,
    total_properties: propertiesResult.count ?? 0,
    open_tickets: openTicketsResult.count ?? 0,
    recent_contact_messages: recentContactResult.data ?? [],
    recent_registrations: recentRegistrations,
    events_last_7_days: analyticsSummary.total_events,
    top_events: analyticsSummary.by_event.slice(0, 5),
  }
}

export async function getSystemHealthMetrics() {
  const start = Date.now()
  const dbProbe = await supabaseAdmin.from('owners').select('id', { count: 'exact', head: true })
  const dbLatencyMs = Date.now() - start

  throwIfError(dbProbe.error, 'Failed to check database health')

  return {
    status: 'ok',
    uptime_seconds: Math.round(process.uptime()),
    node_version: process.version,
    memory: {
      rss: process.memoryUsage().rss,
      heap_total: process.memoryUsage().heapTotal,
      heap_used: process.memoryUsage().heapUsed,
    },
    database: {
      status: 'ok',
      latency_ms: dbLatencyMs,
    },
    generated_at: new Date().toISOString(),
  }
}
