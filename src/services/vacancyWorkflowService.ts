import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/db.js'
import { getOwnerAutomationSettings } from './ownerAutomationService.js'
import { createOwnerNotification } from './ownerService.js'
import { getAutomationProviderRegistry } from './automation/providers/providerRegistry.js'
import { deliverOwnerAutomationMessage } from './automation/providers/messageProvider.js'
import { ensureMoveOutConditionReport } from './conditionReportService.js'

type VacancySourceType = 'tenant_notice' | 'lease_expiry' | 'manual'
type PropertyOccupancyStatus = 'occupied' | 'pre_vacant' | 'vacant' | 'relisting_in_progress'
type VacancyCampaignStatus = 'owner_review' | 'approved' | 'relisting_in_progress' | 'listed' | 'leased' | 'cancelled'
type VacancyListingSyncStatus = 'pending_approval' | 'not_configured' | 'queued' | 'published' | 'failed'
type VacancyLeadStatus = 'new' | 'qualified' | 'viewing_scheduled' | 'application_submitted' | 'inactive'
type VacancyViewingStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show'
type VacancyApplicationStatus = 'submitted' | 'under_review' | 'approved' | 'rejected'

type PropertyContextRow = {
  id: string
  organization_id: string
  owner_id: string
  property_name: string
  address: string
  unit_number: string | null
  occupancy_status: PropertyOccupancyStatus
  expected_vacancy_date: string | null
}

type TenantContextRow = {
  id: string
  organization_id: string
  owner_id: string
  property_id: string
  full_name: string
  email: string | null
  phone: string | null
  lease_end_date: string | null
  monthly_rent: number
  status: string
}

type VacancyCampaignRow = {
  id: string
  organization_id: string
  owner_id: string
  property_id: string
  tenant_id: string | null
  source_type: VacancySourceType
  campaign_status: VacancyCampaignStatus
  vacancy_state: Exclude<PropertyOccupancyStatus, 'occupied'>
  expected_vacancy_date: string
  actual_vacancy_date: string | null
  trigger_reference: string | null
  trigger_notes: string | null
  listing_title: string | null
  listing_description: string | null
  listing_features: unknown
  availability_label: string | null
  draft_source: 'template' | 'ai'
  draft_generation_status: 'ready' | 'skipped' | 'failed'
  draft_generated_at: string | null
  owner_approved_at: string | null
  approved_by_owner_id: string | null
  listing_sync_status: VacancyListingSyncStatus
  listing_provider: string | null
  listing_external_id: string | null
  listing_url: string | null
  enquiry_count: number
  scheduled_viewings_count: number
  applications_count: number
  last_status_digest_at: string | null
  created_at: string
  updated_at: string
  properties?: PropertyContextRow | null
  tenants?: TenantContextRow | null
  owners?: {
    full_name?: string | null
    company_name?: string | null
    email?: string | null
  } | null
  organizations?: {
    name?: string | null
    slug?: string | null
  } | null
}

type VacancyCampaignEventRow = {
  id: string
  vacancy_campaign_id: string
  event_type: string
  title: string
  message: string
  metadata: Record<string, unknown>
  created_at: string
}

type VacancyLeadRow = {
  id: string
  vacancy_campaign_id: string
  property_id: string
  owner_id: string
  full_name: string
  email: string | null
  phone: string | null
  source: string
  status: VacancyLeadStatus
  notes: string | null
  created_at: string
  updated_at: string
}

type VacancyViewingRow = {
  id: string
  vacancy_campaign_id: string
  property_id: string
  owner_id: string
  lead_id: string | null
  scheduled_start_at: string
  scheduled_end_at: string | null
  booking_status: VacancyViewingStatus
  notes: string | null
  calendar_event_id: string | null
  created_at: string
  updated_at: string
}

type VacancyApplicationRow = {
  id: string
  vacancy_campaign_id: string
  property_id: string
  owner_id: string
  lead_id: string | null
  applicant_name: string
  desired_move_in_date: string | null
  monthly_salary: number | null
  status: VacancyApplicationStatus
  notes: string | null
  created_at: string
  updated_at: string
}

export type VacancyCampaignOverview = {
  id: string
  organization_id: string
  owner_id: string
  property_id: string
  tenant_id: string | null
  source_type: VacancySourceType
  campaign_status: VacancyCampaignStatus
  vacancy_state: Exclude<PropertyOccupancyStatus, 'occupied'>
  expected_vacancy_date: string
  actual_vacancy_date: string | null
  trigger_reference: string | null
  trigger_notes: string | null
  listing_title: string | null
  listing_description: string | null
  listing_features: string[]
  availability_label: string | null
  draft_source: 'template' | 'ai'
  draft_generation_status: 'ready' | 'skipped' | 'failed'
  draft_generated_at: string | null
  owner_approved_at: string | null
  listing_sync_status: VacancyListingSyncStatus
  listing_provider: string | null
  listing_external_id: string | null
  listing_url: string | null
  enquiry_count: number
  scheduled_viewings_count: number
  applications_count: number
  last_status_digest_at: string | null
  created_at: string
  updated_at: string
  days_until_vacancy: number
  next_action: string
  property: PropertyContextRow | null
  tenant: TenantContextRow | null
  events: VacancyCampaignEventRow[]
  leads: VacancyLeadRow[]
  viewings: VacancyViewingRow[]
  applications: VacancyApplicationRow[]
  owner?: VacancyCampaignRow['owners']
  organization?: VacancyCampaignRow['organizations']
}

export type OwnerVacancyCampaignOverview = {
  summary: {
    active_campaign_count: number
    pre_vacant_count: number
    vacant_count: number
    relisting_in_progress_count: number
    listed_count: number
    enquiries_count: number
    scheduled_viewings_count: number
    applications_count: number
  }
  campaigns: VacancyCampaignOverview[]
}

export type AdminVacancyCampaignOverview = {
  summary: {
    active_campaign_count: number
    listed_count: number
    leased_count: number
    cancelled_count: number
  }
  campaigns: VacancyCampaignOverview[]
}

export type VacancyIntentSignal = {
  isVacancyNotice: boolean
  confidence: 'high' | 'medium' | 'low'
  reason: string
  suggestedExpectedVacancyDate: string | null
}

const activeVacancyCampaignStatuses: VacancyCampaignStatus[] = ['owner_review', 'approved', 'relisting_in_progress', 'listed']
const vacancyNoticePhrases = [
  'notice to vacate',
  'vacating',
  'vacate',
  'move out',
  'move-out',
  'not renewing',
  'lease ending',
  'lease end',
  'ending my lease',
]

function toISO(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

function toISODate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()))
}

function addDays(value: Date, days: number) {
  const next = new Date(value)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10)
}

function dateDiffInDays(targetDate: string, now = new Date()) {
  const start = startOfUtcDay(now)
  const target = startOfUtcDay(new Date(`${targetDate}T00:00:00.000Z`))
  return Math.round((target.getTime() - start.getTime()) / 86400000)
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[]
  }

  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item.length > 0)
}

function normalizeUnitLabel(unitNumber: string | null | undefined) {
  return unitNumber?.trim() ? `Unit ${unitNumber.trim()}` : 'Unit not specified'
}

function normalizePropertyLabel(property: { property_name: string; unit_number: string | null }) {
  return `${property.property_name}${property.unit_number ? ` (${property.unit_number})` : ''}`
}

function defaultVacancyState(expectedVacancyDate: string, now = new Date()): Exclude<PropertyOccupancyStatus, 'occupied'> {
  return dateDiffInDays(expectedVacancyDate, now) <= 0 ? 'vacant' : 'pre_vacant'
}

function activePropertyStatusForCampaign(input: {
  campaignStatus: VacancyCampaignStatus
  vacancyState: Exclude<PropertyOccupancyStatus, 'occupied'>
}): PropertyOccupancyStatus {
  if (input.campaignStatus === 'relisting_in_progress' || input.campaignStatus === 'listed') {
    return 'relisting_in_progress'
  }

  return input.vacancyState
}

function buildCampaignNextAction(campaign: VacancyCampaignRow) {
  switch (campaign.campaign_status) {
    case 'owner_review':
      return 'Review the listing draft, confirm timing, and approve the re-letting plan.'
    case 'approved':
      return 'Approval captured. Publish or continue internal re-letting coordination.'
    case 'relisting_in_progress':
      return 'Track enquiries, confirm viewings, and move qualified leads to application.'
    case 'listed':
      return 'Monitor listing response and keep viewings/applications moving.'
    case 'leased':
      return 'Campaign complete. Prepare onboarding for the incoming resident.'
    case 'cancelled':
      return 'Campaign is paused. Re-open only if vacancy risk returns.'
    default:
      return 'Review the campaign and confirm the next operational step.'
  }
}

function buildFallbackListingDraft(input: {
  property: PropertyContextRow
  tenant: TenantContextRow | null
  expectedVacancyDate: string
  ownerCompanyName?: string | null
}) {
  const propertyLabel = normalizePropertyLabel(input.property)
  const availabilityLabel = dateDiffInDays(input.expectedVacancyDate) <= 0 ? 'Available now' : `Available from ${input.expectedVacancyDate}`
  const title = `${propertyLabel} ready for the next resident`
  const descriptionLines = [
    `${propertyLabel} is entering the Prophives re-letting workflow with ${availabilityLabel.toLowerCase()}.`,
    input.tenant?.full_name
      ? 'Current resident status has been marked for transition, and the handover sequence is being coordinated.'
      : 'The property team is preparing this residence for a new tenancy cycle.',
    input.ownerCompanyName ? `Managed by ${input.ownerCompanyName} through Prophives.` : 'Managed through Prophives.',
  ]

  const features = [
    input.property.property_name,
    normalizeUnitLabel(input.property.unit_number),
    availabilityLabel,
    'Professional tenancy coordination',
    'Owner-reviewed listing workflow',
  ]

  return {
    title,
    description: descriptionLines.join(' '),
    features,
    availabilityLabel,
    source: 'template' as const,
    generationStatus: 'ready' as const,
  }
}

async function generateListingDraft(input: {
  organizationId: string
  property: PropertyContextRow
  tenant: TenantContextRow | null
  expectedVacancyDate: string
  ownerCompanyName?: string | null
}) {
  const fallback = buildFallbackListingDraft(input)
  const providers = getAutomationProviderRegistry()
  const aiResult = await providers.ai.generateText({
    organizationId: input.organizationId,
    systemPrompt:
      'You generate concise premium residential listing copy for a property operations platform. Keep claims factual, avoid inventing amenities, and write in professional English.',
    prompt: [
      `Property: ${input.property.property_name}`,
      `Unit: ${input.property.unit_number ?? 'Not specified'}`,
      `Address: ${input.property.address}`,
      `Expected vacancy date: ${input.expectedVacancyDate}`,
      `Current resident name: ${input.tenant?.full_name ?? 'Not available'}`,
      'Return one short polished listing description only.',
    ].join('\n'),
    metadata: {
      property_id: input.property.id,
      flow: 'vacancy_reletting',
    },
  })

  if (aiResult.status === 'generated' && aiResult.output?.trim()) {
    return {
      ...fallback,
      description: aiResult.output.trim(),
      source: 'ai' as const,
      generationStatus: 'ready' as const,
    }
  }

  return {
    ...fallback,
    source: aiResult.status === 'failed' ? ('template' as const) : fallback.source,
    generationStatus: aiResult.status === 'failed' ? ('failed' as const) : fallback.generationStatus,
  }
}
async function loadPropertyContext(organizationId: string, propertyId: string) {
  const data = await prisma.properties.findFirst({
    select: { id: true, organization_id: true, owner_id: true, property_name: true, address: true, unit_number: true, occupancy_status: true, expected_vacancy_date: true },
    where: { organization_id: organizationId, id: propertyId },
  })
  if (!data) return null
  return { ...data, expected_vacancy_date: toISODate(data.expected_vacancy_date as Date | null) } as PropertyContextRow
}

async function loadTenantContext(input: { organizationId: string; propertyId: string; tenantId?: string | null }) {
  const where: Record<string, unknown> = { organization_id: input.organizationId, property_id: input.propertyId }
  if (input.tenantId) {
    where.id = input.tenantId
  } else {
    where.status = 'active'
  }

  const data = await prisma.tenants.findFirst({
    select: { id: true, organization_id: true, owner_id: true, property_id: true, full_name: true, email: true, phone: true, lease_end_date: true, monthly_rent: true, status: true },
    where,
    orderBy: input.tenantId ? undefined : { lease_end_date: 'asc' },
  })
  if (!data) return null
  return {
    ...data,
    monthly_rent: Number(data.monthly_rent ?? 0),
    lease_end_date: toISODate(data.lease_end_date as Date | null),
  } as TenantContextRow
}

async function loadActiveVacancyCampaignForProperty(input: { organizationId: string; propertyId: string }) {
  const data = await prisma.vacancy_campaigns.findFirst({
    where: { organization_id: input.organizationId, property_id: input.propertyId, campaign_status: { in: activeVacancyCampaignStatuses } },
    orderBy: { created_at: 'desc' },
  })
  if (!data) return null
  return serializeVacancyCampaignRow(data as unknown as Record<string, unknown>) as VacancyCampaignRow
}

function serializeVacancyCampaignRow(row: Record<string, unknown>): VacancyCampaignRow {
  const tenants = row.tenants as Record<string, unknown> | null
  const properties = row.properties as Record<string, unknown> | null
  return {
    ...(row as VacancyCampaignRow),
    expected_vacancy_date: toISODate(row.expected_vacancy_date as Date | null) ?? '',
    actual_vacancy_date: toISODate(row.actual_vacancy_date as Date | null),
    draft_generated_at: toISO(row.draft_generated_at as Date | null),
    owner_approved_at: toISO(row.owner_approved_at as Date | null),
    last_status_digest_at: toISO(row.last_status_digest_at as Date | null),
    created_at: toISO(row.created_at as Date) ?? '',
    updated_at: toISO(row.updated_at as Date) ?? '',
    tenants: tenants ? { ...tenants, lease_end_date: toISODate(tenants.lease_end_date as Date | null), monthly_rent: Number(tenants.monthly_rent ?? 0) } as TenantContextRow : null,
    properties: properties ? { ...properties, expected_vacancy_date: toISODate(properties.expected_vacancy_date as Date | null) } as PropertyContextRow : null,
    owners: row.owners_vacancy_campaigns_owner_idToowners as VacancyCampaignRow['owners'] | null ?? (row.owners as VacancyCampaignRow['owners'] | null),
    organizations: row.organizations as VacancyCampaignRow['organizations'] | null,
  }
}

async function createVacancyCampaignEvent(input: {
  organizationId: string
  campaignId: string
  eventType: VacancyCampaignEventRow['event_type']
  title: string
  message: string
  metadata?: Record<string, unknown>
}) {
  const created = await prisma.vacancy_campaign_events.create({
    data: {
      organization_id: input.organizationId,
      vacancy_campaign_id: input.campaignId,
      event_type: input.eventType,
      title: input.title,
      message: input.message,
      metadata: (input.metadata ?? {}) as object,
    },
  })
  return { ...created, created_at: toISO(created.created_at) ?? '' } as unknown as VacancyCampaignEventRow
}

async function updatePropertyVacancyState(input: {
  organizationId: string
  propertyId: string
  occupancyStatus: PropertyOccupancyStatus
  expectedVacancyDate?: string | null
  vacancyMarkedAt?: string | null
  availabilityNotes?: string | null
}) {
  const patchData: Record<string, unknown> = { occupancy_status: input.occupancyStatus, updated_at: new Date() }

  if (typeof input.expectedVacancyDate !== 'undefined') {
    patchData.expected_vacancy_date = input.expectedVacancyDate ? new Date(`${input.expectedVacancyDate}T00:00:00.000Z`) : null
  }
  if (typeof input.vacancyMarkedAt !== 'undefined') {
    patchData.vacancy_marked_at = input.vacancyMarkedAt
  }
  if (typeof input.availabilityNotes !== 'undefined') {
    patchData.availability_notes = input.availabilityNotes
  }

  await prisma.properties.update({ where: { id: input.propertyId }, data: patchData })
}

function groupByCampaignId<T extends { vacancy_campaign_id: string }>(rows: T[]) {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const existing = map.get(row.vacancy_campaign_id) ?? []
    existing.push(row)
    map.set(row.vacancy_campaign_id, existing)
  }
  return map
}

async function loadVacancyCampaignRelations(campaignIds: string[]) {
  if (campaignIds.length === 0) {
    return {
      eventsByCampaign: new Map<string, VacancyCampaignEventRow[]>(),
      leadsByCampaign: new Map<string, VacancyLeadRow[]>(),
      viewingsByCampaign: new Map<string, VacancyViewingRow[]>(),
      applicationsByCampaign: new Map<string, VacancyApplicationRow[]>(),
    }
  }

  const [events, leads, viewings, applications] = await Promise.all([
    prisma.vacancy_campaign_events.findMany({
      select: { id: true, vacancy_campaign_id: true, event_type: true, title: true, message: true, metadata: true, created_at: true },
      where: { vacancy_campaign_id: { in: campaignIds } },
      orderBy: { created_at: 'desc' },
    }),
    prisma.vacancy_leads.findMany({
      select: { id: true, vacancy_campaign_id: true, property_id: true, owner_id: true, full_name: true, email: true, phone: true, source: true, status: true, notes: true, created_at: true, updated_at: true },
      where: { vacancy_campaign_id: { in: campaignIds } },
      orderBy: { created_at: 'desc' },
    }),
    prisma.vacancy_viewings.findMany({
      select: { id: true, vacancy_campaign_id: true, property_id: true, owner_id: true, lead_id: true, scheduled_start_at: true, scheduled_end_at: true, booking_status: true, notes: true, calendar_event_id: true, created_at: true, updated_at: true },
      where: { vacancy_campaign_id: { in: campaignIds } },
      orderBy: { scheduled_start_at: 'asc' },
    }),
    prisma.vacancy_applications.findMany({
      select: { id: true, vacancy_campaign_id: true, property_id: true, owner_id: true, lead_id: true, applicant_name: true, desired_move_in_date: true, monthly_salary: true, status: true, notes: true, created_at: true, updated_at: true },
      where: { vacancy_campaign_id: { in: campaignIds } },
      orderBy: { created_at: 'desc' },
    }),
  ])

  return {
    eventsByCampaign: groupByCampaignId(events.map((e) => ({ ...e, created_at: toISO(e.created_at) ?? '', metadata: e.metadata as Record<string, unknown> })) as VacancyCampaignEventRow[]),
    leadsByCampaign: groupByCampaignId(leads.map((l) => ({ ...l, created_at: toISO(l.created_at) ?? '', updated_at: toISO(l.updated_at) ?? '' })) as VacancyLeadRow[]),
    viewingsByCampaign: groupByCampaignId(viewings.map((v) => ({ ...v, scheduled_start_at: toISO(v.scheduled_start_at) ?? '', scheduled_end_at: toISO(v.scheduled_end_at as Date | null), created_at: toISO(v.created_at) ?? '', updated_at: toISO(v.updated_at) ?? '' })) as VacancyViewingRow[]),
    applicationsByCampaign: groupByCampaignId(applications.map((a) => ({ ...a, desired_move_in_date: toISODate(a.desired_move_in_date as Date | null), monthly_salary: a.monthly_salary != null ? Number(a.monthly_salary) : null, created_at: toISO(a.created_at) ?? '', updated_at: toISO(a.updated_at) ?? '' })) as VacancyApplicationRow[]),
  }
}

function mapVacancyCampaignOverview(
  campaign: VacancyCampaignRow,
  relations: {
    eventsByCampaign: Map<string, VacancyCampaignEventRow[]>
    leadsByCampaign: Map<string, VacancyLeadRow[]>
    viewingsByCampaign: Map<string, VacancyViewingRow[]>
    applicationsByCampaign: Map<string, VacancyApplicationRow[]>
  },
): VacancyCampaignOverview {
  return {
    id: campaign.id,
    organization_id: campaign.organization_id,
    owner_id: campaign.owner_id,
    property_id: campaign.property_id,
    tenant_id: campaign.tenant_id,
    source_type: campaign.source_type,
    campaign_status: campaign.campaign_status,
    vacancy_state: campaign.vacancy_state,
    expected_vacancy_date: campaign.expected_vacancy_date,
    actual_vacancy_date: campaign.actual_vacancy_date,
    trigger_reference: campaign.trigger_reference,
    trigger_notes: campaign.trigger_notes,
    listing_title: campaign.listing_title,
    listing_description: campaign.listing_description,
    listing_features: parseStringArray(campaign.listing_features),
    availability_label: campaign.availability_label,
    draft_source: campaign.draft_source,
    draft_generation_status: campaign.draft_generation_status,
    draft_generated_at: campaign.draft_generated_at,
    owner_approved_at: campaign.owner_approved_at,
    listing_sync_status: campaign.listing_sync_status,
    listing_provider: campaign.listing_provider,
    listing_external_id: campaign.listing_external_id,
    listing_url: campaign.listing_url,
    enquiry_count: campaign.enquiry_count,
    scheduled_viewings_count: campaign.scheduled_viewings_count,
    applications_count: campaign.applications_count,
    last_status_digest_at: campaign.last_status_digest_at,
    created_at: campaign.created_at,
    updated_at: campaign.updated_at,
    days_until_vacancy: dateDiffInDays(campaign.expected_vacancy_date),
    next_action: buildCampaignNextAction(campaign),
    property: campaign.properties ?? null,
    tenant: campaign.tenants ?? null,
    events: relations.eventsByCampaign.get(campaign.id) ?? [],
    leads: relations.leadsByCampaign.get(campaign.id) ?? [],
    viewings: relations.viewingsByCampaign.get(campaign.id) ?? [],
    applications: relations.applicationsByCampaign.get(campaign.id) ?? [],
    owner: campaign.owners ?? null,
    organization: campaign.organizations ?? null,
  }
}

async function loadVacancyCampaignOverviewRows(input: {
  organizationId: string
  ownerId?: string
  campaignId?: string
  propertyId?: string
  includeAdminContext?: boolean
}) {
  const where: Record<string, unknown> = { organization_id: input.organizationId }
  if (input.ownerId) where.owner_id = input.ownerId
  if (input.campaignId) where.id = input.campaignId
  if (input.propertyId) where.property_id = input.propertyId

  const rows = await prisma.vacancy_campaigns.findMany({
    select: {
      id: true, organization_id: true, owner_id: true, property_id: true, tenant_id: true, source_type: true, campaign_status: true, vacancy_state: true, expected_vacancy_date: true, actual_vacancy_date: true, trigger_reference: true, trigger_notes: true, listing_title: true, listing_description: true, listing_features: true, availability_label: true, draft_source: true, draft_generation_status: true, draft_generated_at: true, owner_approved_at: true, approved_by_owner_id: true, listing_sync_status: true, listing_provider: true, listing_external_id: true, listing_url: true, enquiry_count: true, scheduled_viewings_count: true, applications_count: true, last_status_digest_at: true, created_at: true, updated_at: true,
      properties: { select: { id: true, organization_id: true, owner_id: true, property_name: true, address: true, unit_number: true, occupancy_status: true, expected_vacancy_date: true } },
      tenants: { select: { id: true, organization_id: true, owner_id: true, property_id: true, full_name: true, email: true, phone: true, lease_end_date: true, monthly_rent: true, status: true } },
      owners_vacancy_campaigns_owner_idToowners: { select: { full_name: true, company_name: true, email: true } },
      organizations: { select: { name: true, slug: true } },
    },
    where,
    orderBy: { created_at: 'desc' },
  })
  return rows.map((row) => serializeVacancyCampaignRow(row as unknown as Record<string, unknown>))
}

async function loadVacancyCampaignDetail(input: { organizationId: string; campaignId: string; ownerId?: string; includeAdminContext?: boolean }) {
  const rows = await loadVacancyCampaignOverviewRows({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    campaignId: input.campaignId,
    includeAdminContext: input.includeAdminContext,
  })

  const campaign = rows[0] ?? null
  if (!campaign) {
    return null
  }

  const relations = await loadVacancyCampaignRelations([campaign.id])
  return mapVacancyCampaignOverview(campaign, relations)
}

async function refreshVacancyCampaignCounts(input: { organizationId: string; campaignId: string }) {
  const [leadCount, viewingCount, applicationCount] = await Promise.all([
    prisma.vacancy_leads.count({ where: { organization_id: input.organizationId, vacancy_campaign_id: input.campaignId } }),
    prisma.vacancy_viewings.count({ where: { organization_id: input.organizationId, vacancy_campaign_id: input.campaignId, booking_status: 'scheduled' } }),
    prisma.vacancy_applications.count({ where: { organization_id: input.organizationId, vacancy_campaign_id: input.campaignId } }),
  ])

  await prisma.vacancy_campaigns.updateMany({
    where: { organization_id: input.organizationId, id: input.campaignId },
    data: {
      enquiry_count: leadCount,
      scheduled_viewings_count: viewingCount,
      applications_count: applicationCount,
    },
  })
}

function pickExpectedVacancyDate(input: {
  explicitDate?: string | null
  tenantLeaseEndDate?: string | null
  subject: string
  message: string
  now?: Date
}) {
  if (input.explicitDate) {
    return input.explicitDate
  }

  const text = `${input.subject} ${input.message}`
  const isoMatch = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)
  if (isoMatch?.[1]) {
    return isoMatch[1]
  }

  const dmyMatch = text.match(/\b(\d{2})\/(\d{2})\/(20\d{2})\b/)
  if (dmyMatch) {
    return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`
  }

  if (input.tenantLeaseEndDate) {
    return input.tenantLeaseEndDate
  }

  return toIsoDate(addDays(input.now ?? new Date(), 30))
}

export function detectVacancyIntentFromTicket(input: {
  subject: string
  message: string
  tenantLeaseEndDate?: string | null
  now?: Date
}): VacancyIntentSignal {
  const normalized = `${input.subject} ${input.message}`.toLowerCase()
  const matchedPhrase = vacancyNoticePhrases.find((phrase) => normalized.includes(phrase))
  if (!matchedPhrase) {
    return {
      isVacancyNotice: false,
      confidence: 'low',
      reason: 'No vacancy notice phrasing detected in the ticket content.',
      suggestedExpectedVacancyDate: null,
    }
  }

  return {
    isVacancyNotice: true,
    confidence: matchedPhrase === 'notice to vacate' || matchedPhrase === 'not renewing' ? 'high' : 'medium',
    reason: `Detected vacancy phrasing: "${matchedPhrase}".`,
    suggestedExpectedVacancyDate: pickExpectedVacancyDate({
      subject: input.subject,
      message: input.message,
      tenantLeaseEndDate: input.tenantLeaseEndDate,
      now: input.now,
    }),
  }
}
async function notifyOwnerVacancyCampaignStarted(input: {
  organizationId: string
  ownerId: string
  tenantId?: string | null
  property: PropertyContextRow
  tenant: TenantContextRow | null
  expectedVacancyDate: string
  sourceType: VacancySourceType
  nextAction: string
}) {
  const sourceLabel = input.sourceType === 'tenant_notice' ? 'Tenant notice received' : input.sourceType === 'lease_expiry' ? 'Lease expiry detected' : 'Vacancy campaign opened'
  const propertyLabel = normalizePropertyLabel(input.property)
  const title = `${sourceLabel}: ${propertyLabel}`
  const message = `${propertyLabel} is now in the re-letting pipeline. Expected vacancy date: ${input.expectedVacancyDate}. ${input.nextAction}`

  await createOwnerNotification({
    organization_id: input.organizationId,
    owner_id: input.ownerId,
    tenant_id: input.tenantId ?? null,
    notification_type: 'vacancy_campaign_started',
    title,
    message,
  })

  await deliverOwnerAutomationMessage({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    templateKey: 'vacancy_campaign_started',
    templateVariables: {
      property: {
        property_name: input.property.property_name,
        unit_number: input.property.unit_number ?? '',
      },
      tenant: {
        full_name: input.tenant?.full_name ?? '',
      },
      campaign: {
        expected_vacancy_date: input.expectedVacancyDate,
        next_action: input.nextAction,
      },
    },
    email: {
      subject: title,
      preheader: 'A Prophives vacancy campaign has been opened for one of your properties.',
      eyebrow: 'Vacancy Watch',
      title,
      intro: ['A vacancy trigger has been detected and the internal re-letting workflow is now active.'],
      details: [
        { label: 'Property', value: input.property.property_name },
        { label: 'Unit', value: input.property.unit_number ?? '-' },
        { label: 'Source', value: sourceLabel },
        { label: 'Expected Vacancy', value: input.expectedVacancyDate, emphasize: true },
        { label: 'Resident', value: input.tenant?.full_name ?? 'Not attached' },
      ],
      body: [message],
      note: {
        title: 'Next step',
        body: input.nextAction,
        tone: 'info',
      },
    },
    telegram: {
      fallbackText: [
        'Vacancy campaign started',
        `Property: ${propertyLabel}`,
        `Expected vacancy: ${input.expectedVacancyDate}`,
        `Next action: ${input.nextAction}`,
      ].join('\n'),
    },
    whatsapp: {
      fallbackText: `${propertyLabel} has entered the vacancy workflow. Expected vacancy: ${input.expectedVacancyDate}. ${input.nextAction}`,
    },
  })
}

function mapListingPublishResult(result: Awaited<ReturnType<ReturnType<typeof getAutomationProviderRegistry>['listings']['publishListing']>>) {
  if (result.status === 'failed') {
    return {
      listingSyncStatus: 'failed' as const,
      campaignStatus: 'approved' as const,
    }
  }

  if (result.status === 'skipped') {
    return {
      listingSyncStatus: 'not_configured' as const,
      campaignStatus: 'relisting_in_progress' as const,
    }
  }

  if (result.status === 'scheduled' || result.status === 'generated' || result.status === 'stored') {
    return {
      listingSyncStatus: 'queued' as const,
      campaignStatus: 'relisting_in_progress' as const,
    }
  }

  return {
    listingSyncStatus: 'published' as const,
    campaignStatus: 'listed' as const,
  }
}

export async function createOrRefreshVacancyCampaign(input: {
  organizationId: string
  ownerId: string
  propertyId: string
  tenantId?: string | null
  sourceType: VacancySourceType
  expectedVacancyDate: string
  vacancyState?: Exclude<PropertyOccupancyStatus, 'occupied'>
  triggerReference?: string | null
  triggerNotes?: string | null
  now?: Date
  sendOwnerMessage?: boolean
}) {
  const now = input.now ?? new Date()
  const property = await loadPropertyContext(input.organizationId, input.propertyId)
  if (!property) {
    throw new AppError('Property not found in organization', 404)
  }

  const tenant = await loadTenantContext({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    tenantId: input.tenantId,
  })

  const existingCampaign = await loadActiveVacancyCampaignForProperty({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
  })

  const vacancyState = input.vacancyState ?? defaultVacancyState(input.expectedVacancyDate, now)
  const listingDraft = await generateListingDraft({
    organizationId: input.organizationId,
    property,
    tenant,
    expectedVacancyDate: input.expectedVacancyDate,
  })

  let campaignId = existingCampaign?.id ?? null
  const created = !existingCampaign

  if (!existingCampaign) {
    const newCampaign = await prisma.vacancy_campaigns.create({
      data: {
        organization_id: input.organizationId,
        owner_id: input.ownerId,
        property_id: input.propertyId,
        tenant_id: tenant?.id ?? input.tenantId ?? null,
        source_type: input.sourceType,
        campaign_status: 'owner_review',
        vacancy_state: vacancyState,
        expected_vacancy_date: new Date(`${input.expectedVacancyDate}T00:00:00.000Z`),
        actual_vacancy_date: vacancyState === 'vacant' ? new Date(`${input.expectedVacancyDate}T00:00:00.000Z`) : null,
        trigger_reference: input.triggerReference ?? null,
        trigger_notes: input.triggerNotes ?? null,
        listing_title: listingDraft.title,
        listing_description: listingDraft.description,
        listing_features: listingDraft.features,
        availability_label: listingDraft.availabilityLabel,
        draft_source: listingDraft.source,
        draft_generation_status: listingDraft.generationStatus,
        draft_generated_at: now,
      },
      select: { id: true },
    })

    if (!newCampaign?.id) {
      throw new AppError('Vacancy campaign id was not returned after creation', 500)
    }
    campaignId = newCampaign.id as string

    await createVacancyCampaignEvent({
      organizationId: input.organizationId,
      campaignId,
      eventType: 'campaign_created',
      title: 'Vacancy campaign opened',
      message: `${normalizePropertyLabel(property)} has entered the re-letting workflow from ${input.sourceType.replaceAll('_', ' ')}.`,
      metadata: {
        expected_vacancy_date: input.expectedVacancyDate,
        source_type: input.sourceType,
        tenant_id: tenant?.id ?? null,
      },
    })
  } else {
    const draftPatch: Record<string, unknown> = {
      source_type: input.sourceType,
      expected_vacancy_date: input.expectedVacancyDate,
      vacancy_state: vacancyState,
      trigger_reference: input.triggerReference ?? existingCampaign.trigger_reference,
      trigger_notes: input.triggerNotes ?? existingCampaign.trigger_notes,
      tenant_id: tenant?.id ?? existingCampaign.tenant_id,
    }

    if (!existingCampaign.listing_title) {
      draftPatch.listing_title = listingDraft.title
    }
    if (!existingCampaign.listing_description) {
      draftPatch.listing_description = listingDraft.description
    }
    if (!parseStringArray(existingCampaign.listing_features).length) {
      draftPatch.listing_features = listingDraft.features
    }
    if (!existingCampaign.availability_label) {
      draftPatch.availability_label = listingDraft.availabilityLabel
    }

    await prisma.vacancy_campaigns.updateMany({
      where: { organization_id: input.organizationId, id: existingCampaign.id },
      data: {
        ...draftPatch,
        expected_vacancy_date: new Date(`${input.expectedVacancyDate}T00:00:00.000Z`),
      },
    })
    campaignId = existingCampaign.id
  }

  await createVacancyCampaignEvent({
    organizationId: input.organizationId,
    campaignId,
    eventType: 'listing_draft_generated',
    title: created ? 'Listing draft prepared' : 'Listing draft refreshed',
    message: `${normalizePropertyLabel(property)} now has a ${listingDraft.source === 'ai' ? 'provider-assisted' : 'structured'} draft ready for owner review.`,
    metadata: {
      draft_source: listingDraft.source,
      draft_generation_status: listingDraft.generationStatus,
      availability_label: listingDraft.availabilityLabel,
    },
  })

  await updatePropertyVacancyState({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    occupancyStatus: activePropertyStatusForCampaign({
      campaignStatus: 'owner_review',
      vacancyState,
    }),
    expectedVacancyDate: input.expectedVacancyDate,
    vacancyMarkedAt: now.toISOString(),
    availabilityNotes: input.triggerNotes ?? property.address,
  })

  const overview = await loadVacancyCampaignDetail({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    campaignId,
  })

  if (!overview) {
    throw new AppError('Vacancy campaign could not be loaded after write', 500)
  }

  if (input.sendOwnerMessage ?? created) {
    await notifyOwnerVacancyCampaignStarted({
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      tenantId: tenant?.id ?? null,
      property,
      tenant,
      expectedVacancyDate: input.expectedVacancyDate,
      sourceType: input.sourceType,
      nextAction: overview.next_action,
    })
  }

  if (input.sourceType === 'tenant_notice' || input.sourceType === 'lease_expiry' || input.sourceType === 'manual') {
    void ensureMoveOutConditionReport({
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      propertyId: input.propertyId,
      tenantId: tenant?.id ?? input.tenantId ?? null,
      vacancyCampaignId: campaignId,
      triggerReference: input.triggerReference ?? campaignId,
    }).catch((error) => {
      console.error('[createOrRefreshVacancyCampaign] move-out condition report initialization failed', {
        campaignId,
        propertyId: input.propertyId,
        tenantId: tenant?.id ?? input.tenantId ?? null,
        error,
      })
    })
  }

  return {
    overview,
    created,
  }
}

export async function updateVacancyCampaignDraft(input: {
  organizationId: string
  ownerId: string
  campaignId: string
  patch: {
    listing_title?: string
    listing_description?: string
    listing_features?: string[]
    availability_label?: string | null
    expected_vacancy_date?: string
    vacancy_state?: Exclude<PropertyOccupancyStatus, 'occupied'>
    trigger_notes?: string | null
  }
}) {
  const current = await loadVacancyCampaignDetail({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    campaignId: input.campaignId,
  })
  if (!current) {
    throw new AppError('Vacancy campaign not found in your organization', 404)
  }

  const patch: Record<string, unknown> = { ...input.patch }
  if (input.patch.listing_features) {
    patch.listing_features = input.patch.listing_features
  }

  await prisma.vacancy_campaigns.updateMany({
    where: { organization_id: input.organizationId, owner_id: input.ownerId, id: input.campaignId },
    data: {
      ...patch,
      ...(patch.expected_vacancy_date ? { expected_vacancy_date: new Date(`${patch.expected_vacancy_date}T00:00:00.000Z`) } : {}),
    },
  })

  if (input.patch.expected_vacancy_date || input.patch.vacancy_state) {
    await updatePropertyVacancyState({
      organizationId: input.organizationId,
      propertyId: current.property_id,
      occupancyStatus: activePropertyStatusForCampaign({
        campaignStatus: current.campaign_status,
        vacancyState: input.patch.vacancy_state ?? current.vacancy_state,
      }),
      expectedVacancyDate: input.patch.expected_vacancy_date ?? current.expected_vacancy_date,
    })
  }

  await createVacancyCampaignEvent({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    eventType: 'campaign_state_changed',
    title: 'Vacancy campaign updated',
    message: 'The owner adjusted the listing draft or vacancy timing.',
    metadata: input.patch,
  })

  const refreshed = await loadVacancyCampaignDetail({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    campaignId: input.campaignId,
  })

  if (!refreshed) {
    throw new AppError('Vacancy campaign not found after update', 404)
  }

  return refreshed
}
export async function approveVacancyCampaign(input: {
  organizationId: string
  ownerId: string
  campaignId: string
  patch?: {
    listing_title?: string
    listing_description?: string
    listing_features?: string[]
    availability_label?: string | null
  }
  now?: Date
}) {
  const now = input.now ?? new Date()
  const current = await loadVacancyCampaignDetail({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    campaignId: input.campaignId,
  })
  if (!current) {
    throw new AppError('Vacancy campaign not found in your organization', 404)
  }

  const listingTitle = input.patch?.listing_title ?? current.listing_title
  const listingDescription = input.patch?.listing_description ?? current.listing_description
  const listingFeatures = input.patch?.listing_features ?? current.listing_features
  const availabilityLabel = typeof input.patch?.availability_label !== 'undefined' ? input.patch.availability_label : current.availability_label

  const providers = getAutomationProviderRegistry()
  const publishResult = await providers.listings.publishListing({
    organizationId: input.organizationId,
    propertyId: current.property_id,
    payload: {
      title: listingTitle,
      description: listingDescription,
      features: listingFeatures,
      availability: availabilityLabel,
      property_name: current.property?.property_name,
      unit_number: current.property?.unit_number,
      expected_vacancy_date: current.expected_vacancy_date,
    },
  })

  const listingStatus = mapListingPublishResult(publishResult)
  const listingUrl = typeof publishResult.url === 'string' ? publishResult.url : null
  const listingId = typeof publishResult.listingId === 'string' ? publishResult.listingId : null

  await prisma.vacancy_campaigns.updateMany({
    where: { organization_id: input.organizationId, owner_id: input.ownerId, id: input.campaignId },
    data: {
      listing_title: listingTitle,
      listing_description: listingDescription,
      listing_features: listingFeatures,
      availability_label: availabilityLabel,
      campaign_status: listingStatus.campaignStatus,
      vacancy_state: listingStatus.campaignStatus === 'listed' || listingStatus.campaignStatus === 'relisting_in_progress' ? 'relisting_in_progress' : current.vacancy_state,
      owner_approved_at: now,
      approved_by_owner_id: input.ownerId,
      listing_sync_status: listingStatus.listingSyncStatus,
      listing_provider: publishResult.provider,
      listing_external_id: listingId,
      listing_url: listingUrl,
    },
  })

  await updatePropertyVacancyState({
    organizationId: input.organizationId,
    propertyId: current.property_id,
    occupancyStatus: 'relisting_in_progress',
    expectedVacancyDate: current.expected_vacancy_date,
  })

  await createVacancyCampaignEvent({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    eventType: 'owner_approved',
    title: 'Owner approved re-letting campaign',
    message: 'The listing draft was approved and the campaign moved forward.',
    metadata: {
      listing_sync_status: listingStatus.listingSyncStatus,
      provider: publishResult.provider,
      external_id: listingId,
      url: listingUrl,
    },
  })

  await createVacancyCampaignEvent({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    eventType: 'listing_publish_attempted',
    title: 'Listing publish attempted',
    message: `Listing provider result: ${publishResult.status}${publishResult.reason ? ` (${publishResult.reason})` : ''}.`,
    metadata: {
      provider: publishResult.provider,
      status: publishResult.status,
      reason: publishResult.reason ?? null,
      url: listingUrl,
    },
  })

  const refreshed = await loadVacancyCampaignDetail({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    campaignId: input.campaignId,
  })
  if (!refreshed) {
    throw new AppError('Vacancy campaign not found after approval', 404)
  }

  return refreshed
}

export async function addVacancyLead(input: {
  organizationId: string
  ownerId: string
  campaignId: string
  payload: {
    full_name: string
    email?: string | null
    phone?: string | null
    source: string
    status: VacancyLeadStatus
    notes?: string | null
  }
}) {
  const campaign = await loadVacancyCampaignDetail({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    campaignId: input.campaignId,
  })
  if (!campaign) {
    throw new AppError('Vacancy campaign not found in your organization', 404)
  }

  const newLead = await prisma.vacancy_leads.create({
    data: {
      organization_id: input.organizationId,
      vacancy_campaign_id: input.campaignId,
      property_id: campaign.property_id,
      owner_id: input.ownerId,
      full_name: input.payload.full_name,
      email: input.payload.email ?? null,
      phone: input.payload.phone ?? null,
      source: input.payload.source,
      status: input.payload.status,
      notes: input.payload.notes ?? null,
    },
  })

  await refreshVacancyCampaignCounts({ organizationId: input.organizationId, campaignId: input.campaignId })
  await createVacancyCampaignEvent({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    eventType: 'lead_recorded',
    title: 'New enquiry recorded',
    message: `${input.payload.full_name} was added to the vacancy campaign pipeline.`,
    metadata: {
      lead_id: newLead.id,
      status: newLead.status,
      source: newLead.source,
    },
  })

  const refreshed = await loadVacancyCampaignDetail({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    campaignId: input.campaignId,
  })
  if (!refreshed) {
    throw new AppError('Vacancy campaign not found after adding lead', 404)
  }

  return refreshed
}

export async function addVacancyViewing(input: {
  organizationId: string
  ownerId: string
  campaignId: string
  payload: {
    lead_id?: string | null
    scheduled_start_at: string
    scheduled_end_at?: string | null
    booking_status: VacancyViewingStatus
    notes?: string | null
  }
}) {
  const campaign = await loadVacancyCampaignDetail({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    campaignId: input.campaignId,
  })
  if (!campaign) {
    throw new AppError('Vacancy campaign not found in your organization', 404)
  }

  const providers = getAutomationProviderRegistry()
  const calendarResult = await providers.calendar.scheduleEvent({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    title: `Viewing: ${campaign.property?.property_name ?? 'Property'}`,
    startsAt: input.payload.scheduled_start_at,
    endsAt: input.payload.scheduled_end_at ?? addDays(new Date(input.payload.scheduled_start_at), 1 / 24).toISOString(),
    metadata: {
      vacancy_campaign_id: input.campaignId,
      property_id: campaign.property_id,
      lead_id: input.payload.lead_id ?? null,
    },
  })

  const newViewing = await prisma.vacancy_viewings.create({
    data: {
      organization_id: input.organizationId,
      vacancy_campaign_id: input.campaignId,
      property_id: campaign.property_id,
      owner_id: input.ownerId,
      lead_id: input.payload.lead_id ?? null,
      scheduled_start_at: new Date(input.payload.scheduled_start_at),
      scheduled_end_at: input.payload.scheduled_end_at ? new Date(input.payload.scheduled_end_at) : null,
      booking_status: input.payload.booking_status,
      notes: input.payload.notes ?? null,
      calendar_event_id: (calendarResult as { eventId?: string | null }).eventId ?? null,
    },
  })

  await refreshVacancyCampaignCounts({ organizationId: input.organizationId, campaignId: input.campaignId })
  await createVacancyCampaignEvent({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    eventType: 'viewing_recorded',
    title: 'Viewing scheduled',
    message: `A viewing was scheduled for ${input.payload.scheduled_start_at}.`,
    metadata: {
      viewing_id: newViewing.id,
      calendar_provider_status: calendarResult.status,
      calendar_provider: calendarResult.provider,
      calendar_event_id: (calendarResult as { eventId?: string | null }).eventId ?? null,
    },
  })

  const refreshed = await loadVacancyCampaignDetail({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    campaignId: input.campaignId,
  })
  if (!refreshed) {
    throw new AppError('Vacancy campaign not found after adding viewing', 404)
  }

  return refreshed
}

export async function addVacancyApplication(input: {
  organizationId: string
  ownerId: string
  campaignId: string
  payload: {
    lead_id?: string | null
    applicant_name: string
    desired_move_in_date?: string | null
    monthly_salary?: number | null
    status: VacancyApplicationStatus
    notes?: string | null
  }
}) {
  const campaign = await loadVacancyCampaignDetail({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    campaignId: input.campaignId,
  })
  if (!campaign) {
    throw new AppError('Vacancy campaign not found in your organization', 404)
  }

  const newApplication = await prisma.vacancy_applications.create({
    data: {
      organization_id: input.organizationId,
      vacancy_campaign_id: input.campaignId,
      property_id: campaign.property_id,
      owner_id: input.ownerId,
      lead_id: input.payload.lead_id ?? null,
      applicant_name: input.payload.applicant_name,
      desired_move_in_date: input.payload.desired_move_in_date ? new Date(input.payload.desired_move_in_date) : null,
      monthly_salary: input.payload.monthly_salary ?? null,
      status: input.payload.status,
      notes: input.payload.notes ?? null,
    },
  })

  await refreshVacancyCampaignCounts({ organizationId: input.organizationId, campaignId: input.campaignId })

  if (input.payload.status === 'approved') {
    await prisma.vacancy_campaigns.updateMany({
      where: { organization_id: input.organizationId, id: input.campaignId },
      data: { campaign_status: 'leased' },
    })

    await updatePropertyVacancyState({
      organizationId: input.organizationId,
      propertyId: campaign.property_id,
      occupancyStatus: 'occupied',
      expectedVacancyDate: null,
      availabilityNotes: null,
    })
  }

  await createVacancyCampaignEvent({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    eventType: 'application_recorded',
    title: 'Application recorded',
    message: `${input.payload.applicant_name} was added to the application pipeline.`,
    metadata: {
      application_id: newApplication.id,
      status: newApplication.status,
      desired_move_in_date: toISODate(newApplication.desired_move_in_date as Date | null),
    },
  })

  const refreshed = await loadVacancyCampaignDetail({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    campaignId: input.campaignId,
  })
  if (!refreshed) {
    throw new AppError('Vacancy campaign not found after adding application', 404)
  }

  return refreshed
}

export async function getOwnerVacancyCampaignOverview(ownerId: string, organizationId: string): Promise<OwnerVacancyCampaignOverview> {
  const rows = await loadVacancyCampaignOverviewRows({
    organizationId,
    ownerId,
  })
  const relations = await loadVacancyCampaignRelations(rows.map((row) => row.id))
  const campaigns = rows.map((row) => mapVacancyCampaignOverview(row, relations))

  return {
    summary: {
      active_campaign_count: campaigns.filter((campaign) => activeVacancyCampaignStatuses.includes(campaign.campaign_status)).length,
      pre_vacant_count: campaigns.filter((campaign) => campaign.vacancy_state === 'pre_vacant').length,
      vacant_count: campaigns.filter((campaign) => campaign.vacancy_state === 'vacant').length,
      relisting_in_progress_count: campaigns.filter((campaign) => campaign.campaign_status === 'relisting_in_progress').length,
      listed_count: campaigns.filter((campaign) => campaign.campaign_status === 'listed').length,
      enquiries_count: campaigns.reduce((total, campaign) => total + campaign.enquiry_count, 0),
      scheduled_viewings_count: campaigns.reduce((total, campaign) => total + campaign.scheduled_viewings_count, 0),
      applications_count: campaigns.reduce((total, campaign) => total + campaign.applications_count, 0),
    },
    campaigns,
  }
}

export async function getOwnerVacancyCampaignDetail(ownerId: string, organizationId: string, campaignId: string) {
  return loadVacancyCampaignDetail({
    organizationId,
    ownerId,
    campaignId,
  })
}

export async function getAdminVacancyCampaignOverview(input: { organizationId?: string }): Promise<AdminVacancyCampaignOverview> {
  const rawRows = await prisma.vacancy_campaigns.findMany({
    select: {
      id: true, organization_id: true, owner_id: true, property_id: true, tenant_id: true, source_type: true, campaign_status: true, vacancy_state: true, expected_vacancy_date: true, actual_vacancy_date: true, trigger_reference: true, trigger_notes: true, listing_title: true, listing_description: true, listing_features: true, availability_label: true, draft_source: true, draft_generation_status: true, draft_generated_at: true, owner_approved_at: true, approved_by_owner_id: true, listing_sync_status: true, listing_provider: true, listing_external_id: true, listing_url: true, enquiry_count: true, scheduled_viewings_count: true, applications_count: true, last_status_digest_at: true, created_at: true, updated_at: true,
      properties: { select: { id: true, organization_id: true, owner_id: true, property_name: true, address: true, unit_number: true, occupancy_status: true, expected_vacancy_date: true } },
      tenants: { select: { id: true, organization_id: true, owner_id: true, property_id: true, full_name: true, email: true, phone: true, lease_end_date: true, monthly_rent: true, status: true } },
      owners_vacancy_campaigns_owner_idToowners: { select: { full_name: true, company_name: true, email: true } },
      organizations: { select: { name: true, slug: true } },
    },
    where: input.organizationId ? { organization_id: input.organizationId } : undefined,
    orderBy: { created_at: 'desc' },
    take: 20,
  })

  const rows = rawRows.map((row) => serializeVacancyCampaignRow(row as unknown as Record<string, unknown>))
  const relations = await loadVacancyCampaignRelations(rows.map((row) => row.id))
  const campaigns = rows.map((row) => mapVacancyCampaignOverview(row, relations))

  return {
    summary: {
      active_campaign_count: campaigns.filter((campaign) => activeVacancyCampaignStatuses.includes(campaign.campaign_status)).length,
      listed_count: campaigns.filter((campaign) => campaign.campaign_status === 'listed').length,
      leased_count: campaigns.filter((campaign) => campaign.campaign_status === 'leased').length,
      cancelled_count: campaigns.filter((campaign) => campaign.campaign_status === 'cancelled').length,
    },
    campaigns,
  }
}
async function buildDailyVacancyStatusDigest(ownerId: string, organizationId: string, campaigns: VacancyCampaignOverview[]) {
  const settings = await getOwnerAutomationSettings(ownerId, organizationId)
  if (!settings.daily_digest_enabled) {
    return {
      sent: false,
      reason: 'daily_digest_disabled',
    }
  }

  const activeCampaigns = campaigns.filter((campaign) => activeVacancyCampaignStatuses.includes(campaign.campaign_status))
  if (activeCampaigns.length === 0) {
    return {
      sent: false,
      reason: 'no_active_campaigns',
    }
  }

  const summary = {
    active_campaigns: activeCampaigns.length,
    vacant_count: activeCampaigns.filter((campaign) => campaign.vacancy_state === 'vacant').length,
    viewings_count: activeCampaigns.reduce((total, campaign) => total + campaign.scheduled_viewings_count, 0),
    applications_count: activeCampaigns.reduce((total, campaign) => total + campaign.applications_count, 0),
  }

  const title = `Vacancy pipeline update: ${summary.active_campaigns} active campaign${summary.active_campaigns === 1 ? '' : 's'}`
  const message = activeCampaigns
    .slice(0, 3)
    .map((campaign) => `${campaign.property?.property_name ?? 'Property'} ${campaign.property?.unit_number ? `(${campaign.property.unit_number})` : ''}: ${campaign.campaign_status.replaceAll('_', ' ')}, ${campaign.enquiry_count} enquiries, ${campaign.scheduled_viewings_count} viewings`)
    .join(' | ')

  await createOwnerNotification({
    organization_id: organizationId,
    owner_id: ownerId,
    notification_type: 'vacancy_daily_status_update',
    title,
    message,
  })

  await deliverOwnerAutomationMessage({
    organizationId,
    ownerId,
    templateKey: 'vacancy_daily_status_update',
    templateVariables: {
      summary,
    },
    email: {
      subject: title,
      preheader: 'Your Prophives vacancy workflow update is ready.',
      eyebrow: 'Vacancy Daily Update',
      title,
      intro: ['Here is today\'s re-letting status across active vacancy campaigns.'],
      details: [
        { label: 'Active Campaigns', value: String(summary.active_campaigns), emphasize: true },
        { label: 'Currently Vacant', value: String(summary.vacant_count) },
        { label: 'Scheduled Viewings', value: String(summary.viewings_count) },
        { label: 'Applications', value: String(summary.applications_count) },
      ],
      body: activeCampaigns.slice(0, 4).map((campaign) => {
        const propertyLabel = campaign.property ? normalizePropertyLabel(campaign.property) : 'Property'
        return `${propertyLabel}: ${campaign.campaign_status.replaceAll('_', ' ')}. ${campaign.enquiry_count} enquiries, ${campaign.scheduled_viewings_count} viewings, ${campaign.applications_count} applications.`
      }),
      note: {
        title: 'Operational focus',
        body: activeCampaigns[0]?.next_action ?? 'Keep the re-letting pipeline moving with owner review and viewing coordination.',
        tone: 'info',
      },
    },
    telegram: {
      fallbackText: [title, ...activeCampaigns.slice(0, 4).map((campaign) => `${campaign.property?.property_name ?? 'Property'}: ${campaign.campaign_status}`)].join('\n'),
    },
    whatsapp: {
      fallbackText: `${title}. Vacant: ${summary.vacant_count}. Viewings: ${summary.viewings_count}. Applications: ${summary.applications_count}.`,
    },
  })

  const nowTs = new Date()
  const campaignIds = activeCampaigns.map((campaign) => campaign.id)

  await prisma.vacancy_campaigns.updateMany({
    where: { organization_id: organizationId, id: { in: campaignIds } },
    data: { last_status_digest_at: nowTs },
  })

  await Promise.all(
    campaignIds.map((campaignId) =>
      createVacancyCampaignEvent({
        organizationId,
        campaignId,
        eventType: 'status_update_sent',
        title: 'Daily status update sent',
        message: title,
        metadata: summary,
      }),
    ),
  )

  return {
    sent: true,
    summary,
    campaign_ids: campaignIds,
  }
}

async function detectLeaseExpiryVacancyCandidates(now: Date) {
  const todayKey = toIsoDate(now)
  const horizonKey = toIsoDate(addDays(now, 90))
  const fallbackHorizonKey = toIsoDate(addDays(now, 30))

  const [legalRows, tenantRows, renewedRows] = await Promise.all([
    prisma.legal_dates.findMany({
      select: { organization_id: true, owner_id: true, property_id: true, tenant_id: true, contract_end: true, renewal_status: true },
      where: {
        contract_end: { not: null, gte: new Date(`${todayKey}T00:00:00.000Z`), lte: new Date(`${horizonKey}T00:00:00.000Z`) },
        renewal_status: { in: ['not_renewed', 'vacating'] },
      },
    }),
    prisma.tenants.findMany({
      select: { id: true, organization_id: true, owner_id: true, property_id: true, lease_end_date: true, status: true },
      where: {
        status: 'active',
        lease_end_date: { not: null, gte: new Date(`${todayKey}T00:00:00.000Z`), lte: new Date(`${fallbackHorizonKey}T00:00:00.000Z`) },
      },
    }),
    prisma.legal_dates.findMany({
      select: { tenant_id: true, property_id: true },
      where: { renewal_status: 'renewed' },
    }),
  ])

  const candidates = new Map<string, {
    organizationId: string
    ownerId: string
    propertyId: string
    tenantId: string | null
    expectedVacancyDate: string
    sourceType: VacancySourceType
    triggerReference: string
    triggerNotes: string
  }>()

  for (const row of legalRows) {
    const contractEnd = toISODate(row.contract_end as Date | null)
    if (!contractEnd) {
      continue
    }

    const propertyId = row.property_id
    candidates.set(`legal:${propertyId}`, {
      organizationId: row.organization_id,
      ownerId: row.owner_id,
      propertyId,
      tenantId: row.tenant_id ?? null,
      expectedVacancyDate: contractEnd,
      sourceType: 'lease_expiry',
      triggerReference: `legal_date:${propertyId}:${contractEnd}`,
      triggerNotes: 'Lease end is approaching without a confirmed renewal.',
    })
  }

  const renewedTenantKeys = new Set(
    renewedRows.map((row) => `${row.tenant_id ?? 'none'}:${row.property_id}`),
  )

  for (const row of tenantRows) {
    const tenantId = row.id
    const propertyId = row.property_id
    const renewedKey = `${tenantId}:${propertyId}`
    if (renewedTenantKeys.has(renewedKey)) {
      continue
    }

    if (candidates.has(`legal:${propertyId}`)) {
      continue
    }

    candidates.set(`tenant:${propertyId}`, {
      organizationId: row.organization_id,
      ownerId: row.owner_id,
      propertyId,
      tenantId,
      expectedVacancyDate: toISODate(row.lease_end_date as Date | null) ?? '',
      sourceType: 'lease_expiry',
      triggerReference: `tenant_lease:${tenantId}`,
      triggerNotes: 'Active lease end is approaching and should be reviewed for re-letting readiness.',
    })
  }

  return Array.from(candidates.values())
}

export async function runVacancyCampaignRefresh(input: {
  organizationId: string
  ownerId: string
  propertyId: string
  tenantId?: string | null
  sourceType: VacancySourceType
  expectedVacancyDate: string
  triggerReference?: string | null
  triggerNotes?: string | null
  vacancyState?: Exclude<PropertyOccupancyStatus, 'occupied'>
  now?: Date
  automationJobId?: string
}) {
  const result = await createOrRefreshVacancyCampaign({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    propertyId: input.propertyId,
    tenantId: input.tenantId,
    sourceType: input.sourceType,
    expectedVacancyDate: input.expectedVacancyDate,
    vacancyState: input.vacancyState,
    triggerReference: input.triggerReference,
    triggerNotes: input.triggerNotes,
    now: input.now,
    sendOwnerMessage: input.sourceType !== 'manual',
  })

  return {
    created: result.created,
    campaign_id: result.overview.id,
    property_id: result.overview.property_id,
    source_type: input.sourceType,
    automation_job_id: input.automationJobId ?? null,
  }
}

export async function runDailyVacancyReletting(now = new Date(), input?: { jobId?: string }) {
  const candidates = await detectLeaseExpiryVacancyCandidates(now)
  let campaignsCreated = 0
  let campaignsRefreshed = 0
  let dailyUpdatesSent = 0

  for (const candidate of candidates) {
    const result = await createOrRefreshVacancyCampaign({
      organizationId: candidate.organizationId,
      ownerId: candidate.ownerId,
      propertyId: candidate.propertyId,
      tenantId: candidate.tenantId,
      sourceType: candidate.sourceType,
      expectedVacancyDate: candidate.expectedVacancyDate,
      triggerReference: candidate.triggerReference,
      triggerNotes: candidate.triggerNotes,
      now,
      sendOwnerMessage: true,
    })

    if (result.created) {
      campaignsCreated += 1
    } else {
      campaignsRefreshed += 1
    }
  }

  const dueCampaignRaw = await prisma.vacancy_campaigns.findMany({
    select: { id: true, organization_id: true, owner_id: true, property_id: true, campaign_status: true, vacancy_state: true, expected_vacancy_date: true },
    where: {
      campaign_status: { in: activeVacancyCampaignStatuses },
      expected_vacancy_date: { lt: new Date(`${toIsoDate(addDays(now, 1))}T00:00:00.000Z`) },
    },
  })

  for (const row of dueCampaignRaw) {
    const campaign = {
      id: row.id,
      organization_id: row.organization_id,
      owner_id: row.owner_id,
      property_id: row.property_id,
      campaign_status: row.campaign_status as VacancyCampaignStatus,
      vacancy_state: row.vacancy_state as Exclude<PropertyOccupancyStatus, 'occupied'>,
      expected_vacancy_date: toISODate(row.expected_vacancy_date as Date | null) ?? '',
    }

    if (campaign.vacancy_state !== 'vacant') {
      const nextState = campaign.campaign_status === 'listed' || campaign.campaign_status === 'relisting_in_progress' ? 'relisting_in_progress' : 'vacant'

      await prisma.vacancy_campaigns.updateMany({
        where: { organization_id: campaign.organization_id, id: campaign.id },
        data: {
          vacancy_state: nextState,
          actual_vacancy_date: new Date(`${campaign.expected_vacancy_date}T00:00:00.000Z`),
        },
      })

      await updatePropertyVacancyState({
        organizationId: campaign.organization_id,
        propertyId: campaign.property_id,
        occupancyStatus: activePropertyStatusForCampaign({
          campaignStatus: campaign.campaign_status,
          vacancyState: nextState,
        }),
        expectedVacancyDate: campaign.expected_vacancy_date,
      })

      await createVacancyCampaignEvent({
        organizationId: campaign.organization_id,
        campaignId: campaign.id,
        eventType: 'campaign_state_changed',
        title: 'Vacancy date reached',
        message: 'The expected vacancy date has been reached and the campaign state was advanced.',
        metadata: {
          expected_vacancy_date: campaign.expected_vacancy_date,
          vacancy_state: nextState,
        },
      })
    }
  }

  const allActiveRaw = await prisma.vacancy_campaigns.findMany({
    select: {
      id: true, organization_id: true, owner_id: true, property_id: true, tenant_id: true, source_type: true, campaign_status: true, vacancy_state: true, expected_vacancy_date: true, actual_vacancy_date: true, trigger_reference: true, trigger_notes: true, listing_title: true, listing_description: true, listing_features: true, availability_label: true, draft_source: true, draft_generation_status: true, draft_generated_at: true, owner_approved_at: true, approved_by_owner_id: true, listing_sync_status: true, listing_provider: true, listing_external_id: true, listing_url: true, enquiry_count: true, scheduled_viewings_count: true, applications_count: true, last_status_digest_at: true, created_at: true, updated_at: true,
      properties: { select: { id: true, organization_id: true, owner_id: true, property_name: true, address: true, unit_number: true, occupancy_status: true, expected_vacancy_date: true } },
      tenants: { select: { id: true, organization_id: true, owner_id: true, property_id: true, full_name: true, email: true, phone: true, lease_end_date: true, monthly_rent: true, status: true } },
    },
    where: { campaign_status: { in: activeVacancyCampaignStatuses } },
    orderBy: { created_at: 'desc' },
  })

  const allActiveRows = allActiveRaw.map((row) => serializeVacancyCampaignRow(row as unknown as Record<string, unknown>))
  const relations = await loadVacancyCampaignRelations(allActiveRows.map((row) => row.id))
  const allActiveCampaigns = allActiveRows.map((row) => mapVacancyCampaignOverview(row, relations))
  const campaignsByOwner = new Map<string, VacancyCampaignOverview[]>()

  for (const campaign of allActiveCampaigns) {
    const existing = campaignsByOwner.get(campaign.owner_id) ?? []
    existing.push(campaign)
    campaignsByOwner.set(campaign.owner_id, existing)
  }

  for (const [ownerId, ownerCampaigns] of campaignsByOwner.entries()) {
    const campaignsDueForDigest = ownerCampaigns.filter((campaign) => campaign.last_status_digest_at?.slice(0, 10) !== toIsoDate(now))
    if (campaignsDueForDigest.length === 0) {
      continue
    }

    const result = await buildDailyVacancyStatusDigest(ownerId, ownerCampaigns[0].organization_id, campaignsDueForDigest)
    if (result.sent) {
      dailyUpdatesSent += 1
    }
  }

  return {
    automation_job_id: input?.jobId ?? null,
    candidates_detected: candidates.length,
    campaigns_created: campaignsCreated,
    campaigns_refreshed: campaignsRefreshed,
    daily_updates_sent: dailyUpdatesSent,
    active_campaign_count: allActiveCampaigns.length,
  }
}
