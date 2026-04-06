import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/db.js'
import { getAutomationProviderRegistry } from './automation/providers/providerRegistry.js'

export const conditionReportRoomDefinitions = [
  { key: 'bedroom', label: 'Bedroom', displayOrder: 10 },
  { key: 'bathroom', label: 'Bathroom', displayOrder: 20 },
  { key: 'kitchen', label: 'Kitchen', displayOrder: 30 },
  { key: 'living_area', label: 'Living Area', displayOrder: 40 },
  { key: 'balcony', label: 'Balcony', displayOrder: 50 },
  { key: 'ac_unit', label: 'AC Unit', displayOrder: 60 },
  { key: 'water_heater', label: 'Water Heater', displayOrder: 70 },
  { key: 'hallway', label: 'Hallway', displayOrder: 80 },
  { key: 'storage', label: 'Storage', displayOrder: 90 },
  { key: 'other', label: 'Other', displayOrder: 100 },
] as const

const roomDefinitionMap = new Map(conditionReportRoomDefinitions.map((entry) => [entry.key, entry]))
const roomRatingOrder = { not_reviewed: 0, good: 1, fair: 2, poor: 3 } as const

export type ConditionReportType = 'move_in' | 'move_out'
export type ConditionRoomLabel = (typeof conditionReportRoomDefinitions)[number]['key']
type ConditionWorkflowStatus = 'draft' | 'collecting_evidence' | 'ready_for_confirmation' | 'confirmation_in_progress' | 'confirmed' | 'cancelled'
type ConditionComparisonStatus = 'not_applicable' | 'baseline_missing' | 'pending_review' | 'matched' | 'changes_detected'
type ConditionConfirmationStatus = 'pending' | 'confirmed' | 'disputed'
type ConditionRoomRating = 'not_reviewed' | 'good' | 'fair' | 'poor'
type ConditionRoomComparisonResult = 'not_applicable' | 'pending_review' | 'matched' | 'changed' | 'attention_required'
type ConditionMediaKind = 'photo' | 'video' | 'document' | 'other'
type ConditionTriggerSource = 'tenant_created' | 'tenant_activated' | 'vacancy_campaign' | 'manual_owner' | 'manual_admin'
type ConditionAiStatus = 'not_requested' | 'pending_provider' | 'analyzed' | 'failed'
type ConditionDocumentStatus = 'not_generated' | 'pending_provider' | 'generated' | 'failed'
type ActorRole = 'owner' | 'tenant' | 'admin' | 'system'

type PropertyRow = {
  id: string
  organization_id: string
  owner_id: string
  property_name: string
  address: string
  unit_number: string | null
}

type TenantRow = {
  id: string
  organization_id: string
  owner_id: string
  property_id: string | null
  full_name: string
  email: string | null
  phone: string | null
  tenant_access_id: string
  lease_start_date: string | null
  lease_end_date: string | null
  status: 'active' | 'inactive' | 'terminated'
}

type OwnerRow = {
  id: string
  full_name: string | null
  company_name: string | null
  email: string
}

type OrganizationRow = {
  id?: string
  name: string | null
  slug: string | null
}

type ConditionReportRow = {
  id: string
  organization_id: string
  owner_id: string
  property_id: string
  tenant_id: string | null
  vacancy_campaign_id: string | null
  baseline_report_id: string | null
  report_type: ConditionReportType
  workflow_status: ConditionWorkflowStatus
  trigger_source: ConditionTriggerSource
  trigger_reference: string | null
  report_label: string
  report_summary: string | null
  comparison_status: ConditionComparisonStatus
  comparison_summary: string | null
  ai_analysis_status: ConditionAiStatus
  ai_analysis_payload: Record<string, unknown> | null
  generated_document_status: ConditionDocumentStatus
  generated_document_format: 'pdf' | 'html' | null
  generated_document_provider: string | null
  generated_document_url: string | null
  generated_document_payload: Record<string, unknown> | null
  owner_confirmation_status: ConditionConfirmationStatus
  owner_confirmation_note: string | null
  owner_confirmed_at: string | null
  tenant_confirmation_status: ConditionConfirmationStatus
  tenant_confirmation_note: string | null
  tenant_confirmed_at: string | null
  last_summary_refreshed_at: string | null
  created_at: string
  updated_at: string
  properties?: PropertyRow | PropertyRow[] | null
  tenants?: TenantRow | TenantRow[] | null
  owners?: OwnerRow | OwnerRow[] | null
  organizations?: OrganizationRow | OrganizationRow[] | null
}

type ConditionReportRoomEntryRow = {
  id: string
  condition_report_id: string
  organization_id: string
  room_label: ConditionRoomLabel
  display_order: number
  condition_rating: ConditionRoomRating
  condition_notes: string | null
  comparison_result: ConditionRoomComparisonResult
  comparison_notes: string | null
  created_at: string
  updated_at: string
}

type ConditionReportMediaRow = {
  id: string
  condition_report_id: string
  room_entry_id: string | null
  organization_id: string
  room_label: ConditionRoomLabel
  media_kind: ConditionMediaKind
  media_url: string | null
  storage_path: string | null
  mime_type: string | null
  caption: string | null
  captured_by_role: ActorRole
  ai_analysis_status: ConditionAiStatus
  ai_analysis_payload: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

type ConditionReportEventRow = {
  id: string
  condition_report_id: string
  organization_id: string
  actor_role: ActorRole
  actor_owner_id: string | null
  actor_tenant_id: string | null
  actor_admin_id: string | null
  event_type:
    | 'report_created'
    | 'room_updated'
    | 'media_added'
    | 'comparison_refreshed'
    | 'document_refreshed'
    | 'owner_confirmed'
    | 'tenant_confirmed'
    | 'status_updated'
  title: string
  message: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export type ConditionReportRoomEntry = ConditionReportRoomEntryRow & {
  room_label_display: string
  media_count: number
}

export type ConditionReportMedia = ConditionReportMediaRow
export type ConditionReportEvent = ConditionReportEventRow

export type ConditionReportOverview = Omit<ConditionReportRow, 'properties' | 'tenants' | 'owners' | 'organizations'> & {
  property: PropertyRow | null
  tenant: TenantRow | null
  owner: OwnerRow | null
  organization: OrganizationRow | null
  room_completion: {
    total_rooms: number
    assessed_rooms: number
    media_items: number
  }
}

export type ConditionReportDetail = ConditionReportOverview & {
  rooms: ConditionReportRoomEntry[]
  media: ConditionReportMedia[]
  events: ConditionReportEvent[]
  baseline_report: {
    id: string
    report_type: ConditionReportType
    report_label: string
    comparison_status: ConditionComparisonStatus
    created_at: string
    generated_document_status: ConditionDocumentStatus
    generated_document_url: string | null
  } | null
}

export type OwnerConditionReportOverview = {
  summary: {
    total_reports: number
    move_in_count: number
    move_out_count: number
    awaiting_owner_confirmation_count: number
    awaiting_tenant_confirmation_count: number
    confirmed_count: number
  }
  reports: ConditionReportOverview[]
}

export type TenantConditionReportOverview = OwnerConditionReportOverview

export type AdminConditionReportOverview = {
  summary: {
    total_reports: number
    move_in_count: number
    move_out_count: number
    pending_confirmations_count: number
    generated_document_count: number
  }
  reports: ConditionReportOverview[]
  total: number
  page: number
  page_size: number
}

function toISO(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

function toISODate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null
}

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null
  }
  return Array.isArray(value) ? value[0] ?? null : value
}

function asNullableString(value: string | null | undefined) {
  const normalized = value?.trim() ?? ''
  return normalized.length ? normalized : null
}

function roomLabelDisplay(label: ConditionRoomLabel) {
  return roomDefinitionMap.get(label)?.label ?? label.replaceAll('_', ' ')
}

function propertyLabel(property: PropertyRow | null) {
  if (!property) {
    return 'Selected property'
  }

  return property.unit_number ? `${property.property_name} (${property.unit_number})` : property.property_name
}

function reportTypeLabel(reportType: ConditionReportType) {
  return reportType === 'move_in' ? 'Move-in condition report' : 'Move-out condition report'
}

function buildReportLabel(reportType: ConditionReportType, property: PropertyRow | null) {
  return property ? `${reportTypeLabel(reportType)} · ${propertyLabel(property)}` : reportTypeLabel(reportType)
}

async function loadPropertyContext(organizationId: string, propertyId: string) {
  const data = await prisma.properties.findFirst({
    select: { id: true, organization_id: true, owner_id: true, property_name: true, address: true, unit_number: true },
    where: { organization_id: organizationId, id: propertyId },
  })
  return data as PropertyRow | null
}

async function loadTenantContext(organizationId: string, tenantId: string) {
  const data = await prisma.tenants.findFirst({
    select: { id: true, organization_id: true, owner_id: true, property_id: true, full_name: true, email: true, phone: true, tenant_access_id: true, lease_start_date: true, lease_end_date: true, status: true },
    where: { organization_id: organizationId, id: tenantId },
  })
  if (!data) return null
  return {
    ...data,
    lease_start_date: toISODate(data.lease_start_date as Date | null),
    lease_end_date: toISODate(data.lease_end_date as Date | null),
  } as TenantRow
}

const conditionReportSelect = {
  id: true, organization_id: true, owner_id: true, property_id: true, tenant_id: true,
  vacancy_campaign_id: true, baseline_report_id: true, report_type: true, workflow_status: true,
  trigger_source: true, trigger_reference: true, report_label: true, report_summary: true,
  comparison_status: true, comparison_summary: true, ai_analysis_status: true, ai_analysis_payload: true,
  generated_document_status: true, generated_document_format: true, generated_document_provider: true,
  generated_document_url: true, generated_document_payload: true, owner_confirmation_status: true,
  owner_confirmation_note: true, owner_confirmed_at: true, tenant_confirmation_status: true,
  tenant_confirmation_note: true, tenant_confirmed_at: true, last_summary_refreshed_at: true,
  created_at: true, updated_at: true,
  properties: { select: { id: true, organization_id: true, owner_id: true, property_name: true, address: true, unit_number: true } },
  tenants: { select: { id: true, organization_id: true, owner_id: true, property_id: true, full_name: true, email: true, phone: true, tenant_access_id: true, lease_start_date: true, lease_end_date: true, status: true } },
  owners: { select: { id: true, full_name: true, company_name: true, email: true } },
  organizations: { select: { id: true, name: true, slug: true } },
} as const

function serializeConditionReportRow(row: Record<string, unknown>): ConditionReportRow {
  const tenants = row.tenants as Record<string, unknown> | null
  return {
    ...(row as ConditionReportRow),
    owner_confirmed_at: toISO(row.owner_confirmed_at as Date | null),
    tenant_confirmed_at: toISO(row.tenant_confirmed_at as Date | null),
    last_summary_refreshed_at: toISO(row.last_summary_refreshed_at as Date | null),
    created_at: toISO(row.created_at as Date) ?? '',
    updated_at: toISO(row.updated_at as Date) ?? '',
    tenants: tenants ? { ...tenants, lease_start_date: toISODate(tenants.lease_start_date as Date | null), lease_end_date: toISODate(tenants.lease_end_date as Date | null) } as TenantRow : null,
  }
}

async function loadConditionReportRow(input: {
  reportId: string
  organizationId: string
  ownerId?: string
  tenantId?: string
}) {
  const where: Record<string, unknown> = { organization_id: input.organizationId, id: input.reportId }
  if (input.ownerId) where.owner_id = input.ownerId
  if (input.tenantId) where.tenant_id = input.tenantId

  const data = await prisma.condition_reports.findFirst({ select: conditionReportSelect, where })
  if (!data) return null
  return serializeConditionReportRow(data as unknown as Record<string, unknown>)
}

async function loadConditionReportRooms(conditionReportId: string, organizationId: string) {
  const data = await prisma.condition_report_room_entries.findMany({
    where: { organization_id: organizationId, condition_report_id: conditionReportId },
    orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
  })
  return data.map((row) => ({
    ...row,
    created_at: toISO(row.created_at) ?? '',
    updated_at: toISO(row.updated_at) ?? '',
  })) as unknown as ConditionReportRoomEntryRow[]
}

async function loadConditionReportMedia(conditionReportId: string, organizationId: string) {
  const data = await prisma.condition_report_media.findMany({
    where: { organization_id: organizationId, condition_report_id: conditionReportId },
    orderBy: { created_at: 'desc' },
  })
  return data.map((row) => ({
    ...row,
    created_at: toISO(row.created_at) ?? '',
    updated_at: toISO(row.updated_at) ?? '',
  })) as unknown as ConditionReportMediaRow[]
}

async function loadConditionReportEvents(conditionReportId: string, organizationId: string) {
  const data = await prisma.condition_report_events.findMany({
    where: { organization_id: organizationId, condition_report_id: conditionReportId },
    orderBy: { created_at: 'desc' },
  })

  return data.map((row) => ({
    ...row,
    created_at: toISO(row.created_at) ?? '',
  })) as unknown as ConditionReportEventRow[]
}

async function createConditionReportEvent(input: {
  organizationId: string
  conditionReportId: string
  actorRole: ActorRole
  actorOwnerId?: string | null
  actorTenantId?: string | null
  actorAdminId?: string | null
  eventType: ConditionReportEventRow['event_type']
  title: string
  message: string
  metadata?: Record<string, unknown>
}) {
  await prisma.condition_report_events.create({
    data: {
      condition_report_id: input.conditionReportId,
      organization_id: input.organizationId,
      actor_role: input.actorRole,
      actor_owner_id: input.actorRole === 'owner' ? input.actorOwnerId ?? null : null,
      actor_tenant_id: input.actorRole === 'tenant' ? input.actorTenantId ?? null : null,
      actor_admin_id: input.actorRole === 'admin' ? input.actorAdminId ?? null : null,
      event_type: input.eventType,
      title: input.title,
      message: input.message,
      metadata: (input.metadata ?? {}) as object,
    },
  })
}

async function seedDefaultRooms(conditionReportId: string, organizationId: string) {
  await prisma.condition_report_room_entries.createMany({
    data: conditionReportRoomDefinitions.map((entry) => ({
      condition_report_id: conditionReportId,
      organization_id: organizationId,
      room_label: entry.key,
      display_order: entry.displayOrder,
      condition_rating: 'not_reviewed',
      comparison_result: 'not_applicable',
    })),
  })
}

function summarizeRoomCompletion(rooms: ConditionReportRoomEntryRow[], media: ConditionReportMediaRow[]) {
  const mediaByRoom = new Set(media.map((entry) => entry.room_entry_id).filter((value): value is string => Boolean(value)))
  const assessedRooms = rooms.filter(
    (room) =>
      room.condition_rating !== 'not_reviewed' ||
      Boolean(asNullableString(room.condition_notes)) ||
      mediaByRoom.has(room.id),
  ).length

  return {
    total_rooms: rooms.length,
    assessed_rooms: assessedRooms,
    media_items: media.length,
  }
}

function mapOverview(
  row: ConditionReportRow,
  roomCompletion = {
    total_rooms: 0,
    assessed_rooms: 0,
    media_items: 0,
  },
) {
  return {
    ...row,
    property: normalizeRelation(row.properties),
    tenant: normalizeRelation(row.tenants),
    owner: normalizeRelation(row.owners),
    organization: normalizeRelation(row.organizations),
    room_completion: roomCompletion,
  } satisfies ConditionReportOverview
}

async function loadConditionReportDetail(input: {
  reportId: string
  organizationId: string
  ownerId?: string
  tenantId?: string
}) {
  const report = await loadConditionReportRow(input)
  if (!report) {
    return null
  }

  const [rooms, media, events, baseline] = await Promise.all([
    loadConditionReportRooms(report.id, report.organization_id),
    loadConditionReportMedia(report.id, report.organization_id),
    loadConditionReportEvents(report.id, report.organization_id),
    report.baseline_report_id
      ? loadConditionReportRow({
          reportId: report.baseline_report_id,
          organizationId: report.organization_id,
        })
      : Promise.resolve(null),
  ])

  const mediaCountByRoom = new Map<string, number>()
  for (const entry of media) {
    if (!entry.room_entry_id) {
      continue
    }
    mediaCountByRoom.set(entry.room_entry_id, (mediaCountByRoom.get(entry.room_entry_id) ?? 0) + 1)
  }

  const roomCompletion = summarizeRoomCompletion(rooms, media)

  return {
    ...mapOverview(report, roomCompletion),
    rooms: rooms.map((room) => ({
      ...room,
      room_label_display: roomLabelDisplay(room.room_label),
      media_count: mediaCountByRoom.get(room.id) ?? 0,
    })),
    media,
    events,
    baseline_report: baseline
      ? {
          id: baseline.id,
          report_type: baseline.report_type,
          report_label: baseline.report_label,
          comparison_status: baseline.comparison_status,
          created_at: baseline.created_at,
          generated_document_status: baseline.generated_document_status,
          generated_document_url: baseline.generated_document_url,
        }
      : null,
  } satisfies ConditionReportDetail
}

async function loadLatestBaselineMoveInReport(input: {
  organizationId: string
  propertyId: string
  tenantId?: string | null
}) {
  const where: Record<string, unknown> = {
    organization_id: input.organizationId,
    property_id: input.propertyId,
    report_type: 'move_in',
  }
  if (input.tenantId) where.tenant_id = input.tenantId

  const data = await prisma.condition_reports.findFirst({
    select: conditionReportSelect,
    where,
    orderBy: { created_at: 'desc' },
  })
  if (!data) return null
  return serializeConditionReportRow(data as unknown as Record<string, unknown>)
}

function computeMoveOutComparison(input: {
  report: ConditionReportRow
  rooms: ConditionReportRoomEntryRow[]
  baselineRooms: ConditionReportRoomEntryRow[]
}) {
  const roomPatch = new Map<string, { comparison_result: ConditionRoomComparisonResult; comparison_notes: string | null }>()

  if (input.report.report_type !== 'move_out') {
    return {
      comparisonStatus: 'not_applicable' as const,
      comparisonSummary: null,
      roomPatch,
    }
  }

  if (input.baselineRooms.length === 0) {
    for (const room of input.rooms) {
      roomPatch.set(room.id, {
        comparison_result: 'not_applicable',
        comparison_notes: 'No baseline move-in report is linked to this report.',
      })
    }

    return {
      comparisonStatus: 'baseline_missing' as const,
      comparisonSummary: 'No move-in baseline was found, so deposit review should rely on the captured evidence directly.',
      roomPatch,
    }
  }

  const baselineByRoom = new Map(input.baselineRooms.map((room) => [room.room_label, room]))
  let matchedCount = 0
  let changedCount = 0
  let pendingCount = 0

  for (const room of input.rooms) {
    const baseline = baselineByRoom.get(room.room_label)
    if (!baseline || room.condition_rating === 'not_reviewed' || baseline.condition_rating === 'not_reviewed') {
      pendingCount += 1
      roomPatch.set(room.id, {
        comparison_result: 'pending_review',
        comparison_notes: baseline ? 'One side of the comparison is still not fully rated.' : 'This room is not present in the move-in baseline.',
      })
      continue
    }

    const currentRating = roomRatingOrder[room.condition_rating]
    const baselineRating = roomRatingOrder[baseline.condition_rating]
    const notesChanged =
      asNullableString(room.condition_notes) !== asNullableString(baseline.condition_notes) && Boolean(asNullableString(room.condition_notes))

    if (currentRating > baselineRating) {
      changedCount += 1
      roomPatch.set(room.id, {
        comparison_result: 'attention_required',
        comparison_notes: `Condition declined from ${baseline.condition_rating} to ${room.condition_rating}.`,
      })
      continue
    }

    if (currentRating < baselineRating || notesChanged) {
      changedCount += 1
      roomPatch.set(room.id, {
        comparison_result: 'changed',
        comparison_notes: currentRating < baselineRating ? `Condition changed from ${baseline.condition_rating} to ${room.condition_rating}.` : 'Condition notes differ from the move-in baseline.',
      })
      continue
    }

    matchedCount += 1
    roomPatch.set(room.id, {
      comparison_result: 'matched',
      comparison_notes: 'No material change detected against the move-in baseline.',
    })
  }

  if (changedCount > 0) {
    return {
      comparisonStatus: 'changes_detected' as const,
      comparisonSummary: `${changedCount} room zone${changedCount === 1 ? '' : 's'} differ from the move-in baseline and should be reviewed before deposit release.`,
      roomPatch,
    }
  }

  if (pendingCount > 0) {
    return {
      comparisonStatus: 'pending_review' as const,
      comparisonSummary: `${matchedCount} room zone${matchedCount === 1 ? '' : 's'} align so far, while ${pendingCount} still need review.`,
      roomPatch,
    }
  }

  return {
      comparisonStatus: 'matched' as const,
      comparisonSummary: 'The move-out report aligns with the move-in baseline across the documented rooms.',
      roomPatch,
    }
}

function deriveWorkflowStatus(input: {
  report: ConditionReportRow
  roomCompletion: {
    total_rooms: number
    assessed_rooms: number
    media_items: number
  }
}) {
  if (input.report.workflow_status === 'cancelled') {
    return 'cancelled' as const
  }

  if (input.report.owner_confirmation_status === 'confirmed' && input.report.tenant_confirmation_status === 'confirmed') {
    return 'confirmed' as const
  }

  if (input.report.owner_confirmation_status !== 'pending' || input.report.tenant_confirmation_status !== 'pending') {
    return 'confirmation_in_progress' as const
  }

  if (input.roomCompletion.assessed_rooms === 0 && input.roomCompletion.media_items === 0) {
    return 'draft' as const
  }

  if (input.roomCompletion.assessed_rooms < input.roomCompletion.total_rooms) {
    return 'collecting_evidence' as const
  }

  return 'ready_for_confirmation' as const
}

async function refreshConditionReportArtifacts(input: {
  reportId: string
  organizationId: string
}) {
  const report = await loadConditionReportRow({
    reportId: input.reportId,
    organizationId: input.organizationId,
  })
  if (!report) {
    throw new AppError('Condition report not found', 404)
  }

  const [rooms, media, baselineReport] = await Promise.all([
    loadConditionReportRooms(report.id, report.organization_id),
    loadConditionReportMedia(report.id, report.organization_id),
    report.baseline_report_id
      ? loadConditionReportRow({
          reportId: report.baseline_report_id,
          organizationId: report.organization_id,
        })
      : Promise.resolve(null),
  ])

  const baselineRooms = baselineReport ? await loadConditionReportRooms(baselineReport.id, baselineReport.organization_id) : []
  const roomCompletion = summarizeRoomCompletion(rooms, media)
  const comparison = computeMoveOutComparison({
    report,
    rooms,
    baselineRooms,
  })

  if (comparison.roomPatch.size > 0) {
    await Promise.all(
      Array.from(comparison.roomPatch.entries()).map(([roomId, patch]) =>
        prisma.condition_report_room_entries.update({
          where: { id: roomId },
          data: { ...patch, updated_at: new Date() },
        }),
      ),
    )
  }

  const summaryText =
    report.report_type === 'move_out'
      ? `${roomCompletion.assessed_rooms} of ${roomCompletion.total_rooms} room zones documented with ${roomCompletion.media_items} evidence item${roomCompletion.media_items === 1 ? '' : 's'}. ${comparison.comparisonSummary ?? ''}`.trim()
      : `${roomCompletion.assessed_rooms} of ${roomCompletion.total_rooms} room zones documented with ${roomCompletion.media_items} evidence item${roomCompletion.media_items === 1 ? '' : 's'}.`

  const nextReport = {
    ...report,
    report_summary: summaryText,
    comparison_status: comparison.comparisonStatus,
    comparison_summary: comparison.comparisonSummary,
  }

  const workflowStatus = deriveWorkflowStatus({
    report: nextReport,
    roomCompletion,
  })

  const providers = getAutomationProviderRegistry()
  const payload = {
    report: {
      id: report.id,
      report_type: report.report_type,
      report_label: report.report_label,
      workflow_status: workflowStatus,
      report_summary: summaryText,
      comparison_status: comparison.comparisonStatus,
      comparison_summary: comparison.comparisonSummary,
      owner_confirmation_status: report.owner_confirmation_status,
      tenant_confirmation_status: report.tenant_confirmation_status,
      created_at: report.created_at,
      updated_at: report.updated_at,
    },
    property: normalizeRelation(report.properties),
    tenant: normalizeRelation(report.tenants),
    rooms: rooms.map((room) => ({
      room_label: room.room_label,
      room_label_display: roomLabelDisplay(room.room_label),
      condition_rating: room.condition_rating,
      condition_notes: room.condition_notes,
      comparison_result: comparison.roomPatch.get(room.id)?.comparison_result ?? room.comparison_result,
      comparison_notes: comparison.roomPatch.get(room.id)?.comparison_notes ?? room.comparison_notes,
    })),
    media: media.map((entry) => ({
      room_label: entry.room_label,
      media_kind: entry.media_kind,
      media_url: entry.media_url,
      storage_path: entry.storage_path,
      mime_type: entry.mime_type,
      caption: entry.caption,
      captured_by_role: entry.captured_by_role,
      created_at: entry.created_at,
    })),
  }

  const rendered = await providers.documents.renderDocument({
    templateKey: 'condition_report_summary',
    organizationId: report.organization_id,
    payload,
    format: 'html',
  })

  const documentStatus =
    rendered.status === 'sent' || rendered.status === 'generated' || rendered.status === 'stored' || rendered.status === 'linked'
      ? 'generated'
      : rendered.status === 'failed'
        ? 'failed'
        : 'pending_provider'

  await prisma.condition_reports.update({
    where: { id: report.id },
    data: {
      workflow_status: workflowStatus,
      report_summary: summaryText,
      comparison_status: comparison.comparisonStatus,
      comparison_summary: comparison.comparisonSummary,
      ai_analysis_status: 'not_requested',
      ai_analysis_payload: {
        note: 'AI room scoring and visual comparison can be connected later through the provider registry.',
      },
      generated_document_status: documentStatus,
      generated_document_provider: rendered.provider,
      generated_document_format: 'html',
      generated_document_url: rendered.documentUrl ?? null,
      generated_document_payload: payload as object,
      last_summary_refreshed_at: new Date(),
      updated_at: new Date(),
    },
  })

  return loadConditionReportDetail({
    reportId: report.id,
    organizationId: report.organization_id,
  })
}

async function findExistingOpenReport(input: {
  organizationId: string
  propertyId: string
  tenantId?: string | null
  reportType: ConditionReportType
  vacancyCampaignId?: string | null
}) {
  const where: Record<string, unknown> = {
    organization_id: input.organizationId,
    property_id: input.propertyId,
    report_type: input.reportType,
    NOT: { workflow_status: 'cancelled' },
  }
  if (input.tenantId) where.tenant_id = input.tenantId
  if (input.vacancyCampaignId) where.vacancy_campaign_id = input.vacancyCampaignId

  const data = await prisma.condition_reports.findFirst({
    select: { id: true, workflow_status: true },
    where,
    orderBy: { created_at: 'desc' },
  })
  return data ? data.id : null
}

async function createConditionReportInternal(input: {
  organizationId: string
  ownerId: string
  propertyId: string
  tenantId?: string | null
  vacancyCampaignId?: string | null
  reportType: ConditionReportType
  triggerSource: ConditionTriggerSource
  triggerReference?: string | null
  baselineReportId?: string | null
  actorRole: ActorRole
  actorOwnerId?: string | null
  actorTenantId?: string | null
  actorAdminId?: string | null
}) {
  const property = await loadPropertyContext(input.organizationId, input.propertyId)
  if (!property) {
    throw new AppError('Property not found in organization', 404)
  }

  const tenant = input.tenantId ? await loadTenantContext(input.organizationId, input.tenantId) : null
  const created = await prisma.condition_reports.create({
    data: {
      organization_id: input.organizationId,
      owner_id: input.ownerId,
      property_id: input.propertyId,
      tenant_id: input.tenantId ?? null,
      vacancy_campaign_id: input.vacancyCampaignId ?? null,
      baseline_report_id: input.baselineReportId ?? null,
      report_type: input.reportType,
      workflow_status: 'draft',
      trigger_source: input.triggerSource,
      trigger_reference: input.triggerReference ?? null,
      report_label: buildReportLabel(input.reportType, property),
      comparison_status: input.reportType === 'move_out' ? (input.baselineReportId ? 'pending_review' : 'baseline_missing') : 'not_applicable',
    },
    select: { id: true },
  })

  await seedDefaultRooms(created.id, input.organizationId)
  await createConditionReportEvent({
    organizationId: input.organizationId,
    conditionReportId: created.id,
    actorRole: input.actorRole,
    actorOwnerId: input.actorOwnerId ?? null,
    actorTenantId: input.actorTenantId ?? null,
    actorAdminId: input.actorAdminId ?? null,
    eventType: 'report_created',
    title: input.reportType === 'move_in' ? 'Move-in report opened' : 'Move-out report opened',
    message:
      input.reportType === 'move_in'
        ? `${tenant?.full_name ?? 'Tenant'} now has a move-in documentation workflow for ${propertyLabel(property)}.`
        : `${propertyLabel(property)} now has a move-out documentation workflow for deposit review.`,
    metadata: {
      trigger_source: input.triggerSource,
      trigger_reference: input.triggerReference ?? null,
      vacancy_campaign_id: input.vacancyCampaignId ?? null,
      baseline_report_id: input.baselineReportId ?? null,
    },
  })

  return refreshConditionReportArtifacts({
    reportId: created.id,
    organizationId: input.organizationId,
  })
}

export async function ensureMoveInConditionReport(input: {
  organizationId: string
  ownerId: string
  propertyId: string
  tenantId: string
  triggerSource: Extract<ConditionTriggerSource, 'tenant_created' | 'tenant_activated' | 'manual_owner' | 'manual_admin'>
  triggerReference?: string | null
  actorRole?: ActorRole
  actorOwnerId?: string | null
  actorAdminId?: string | null
}) {
  const existingId = await findExistingOpenReport({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    tenantId: input.tenantId,
    reportType: 'move_in',
  })

  if (existingId) {
    return loadConditionReportDetail({
      reportId: existingId,
      organizationId: input.organizationId,
      ownerId: input.ownerId,
    })
  }

  return createConditionReportInternal({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    propertyId: input.propertyId,
    tenantId: input.tenantId,
    reportType: 'move_in',
    triggerSource: input.triggerSource,
    triggerReference: input.triggerReference ?? null,
    actorRole: input.actorRole ?? 'system',
    actorOwnerId: input.actorOwnerId ?? input.ownerId,
    actorAdminId: input.actorAdminId ?? null,
  })
}

export async function ensureMoveOutConditionReport(input: {
  organizationId: string
  ownerId: string
  propertyId: string
  tenantId?: string | null
  vacancyCampaignId?: string | null
  triggerReference?: string | null
}) {
  const existingId = await findExistingOpenReport({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    tenantId: input.tenantId ?? null,
    reportType: 'move_out',
    vacancyCampaignId: input.vacancyCampaignId ?? null,
  })

  if (existingId) {
    return loadConditionReportDetail({
      reportId: existingId,
      organizationId: input.organizationId,
      ownerId: input.ownerId,
    })
  }

  const baseline = await loadLatestBaselineMoveInReport({
    organizationId: input.organizationId,
    propertyId: input.propertyId,
    tenantId: input.tenantId ?? null,
  })

  return createConditionReportInternal({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    propertyId: input.propertyId,
    tenantId: input.tenantId ?? null,
    vacancyCampaignId: input.vacancyCampaignId ?? null,
    reportType: 'move_out',
    triggerSource: 'vacancy_campaign',
    triggerReference: input.triggerReference ?? null,
    baselineReportId: baseline?.id ?? null,
    actorRole: 'system',
  })
}

export async function createOwnerConditionReport(input: {
  organizationId: string
  ownerId: string
  tenantId: string
  reportType: ConditionReportType
  vacancyCampaignId?: string | null
  triggerReference?: string | null
}) {
  const tenant = await loadTenantContext(input.organizationId, input.tenantId)
  if (!tenant) {
    throw new AppError('Tenant not found in your organization', 404)
  }

  if (!tenant.property_id) {
    throw new AppError('Tenant is not linked to a property', 400)
  }

  if (input.reportType === 'move_in') {
    return ensureMoveInConditionReport({
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      propertyId: tenant.property_id,
      tenantId: tenant.id,
      triggerSource: 'manual_owner',
      triggerReference: input.triggerReference ?? null,
      actorRole: 'owner',
      actorOwnerId: input.ownerId,
    })
  }

  const baseline = await loadLatestBaselineMoveInReport({
    organizationId: input.organizationId,
    propertyId: tenant.property_id,
    tenantId: tenant.id,
  })

  return createConditionReportInternal({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    propertyId: tenant.property_id,
    tenantId: tenant.id,
    vacancyCampaignId: input.vacancyCampaignId ?? null,
    reportType: 'move_out',
    triggerSource: 'manual_owner',
    triggerReference: input.triggerReference ?? null,
    baselineReportId: baseline?.id ?? null,
    actorRole: 'owner',
    actorOwnerId: input.ownerId,
  })
}

export async function updateConditionReportRoomEntry(input: {
  organizationId: string
  ownerId: string
  reportId: string
  roomEntryId: string
  patch: {
    condition_rating?: ConditionRoomRating
    condition_notes?: string | null
  }
}) {
  const report = await loadConditionReportRow({
    reportId: input.reportId,
    organizationId: input.organizationId,
    ownerId: input.ownerId,
  })
  if (!report) {
    throw new AppError('Condition report not found in your organization', 404)
  }

  const updateData: Record<string, unknown> = { updated_at: new Date() }
  if (typeof input.patch.condition_rating === 'string') updateData.condition_rating = input.patch.condition_rating
  if (typeof input.patch.condition_notes !== 'undefined') updateData.condition_notes = asNullableString(input.patch.condition_notes)

  const existing = await prisma.condition_report_room_entries.findFirst({
    where: { id: input.roomEntryId, condition_report_id: input.reportId, organization_id: input.organizationId },
    select: { id: true, room_label: true, condition_rating: true },
  })
  if (!existing) {
    throw new AppError('Condition report room not found', 404)
  }

  await prisma.condition_report_room_entries.update({
    where: { id: input.roomEntryId },
    data: updateData,
  })

  await createConditionReportEvent({
    organizationId: input.organizationId,
    conditionReportId: input.reportId,
    actorRole: 'owner',
    actorOwnerId: input.ownerId,
    eventType: 'room_updated',
    title: `${roomLabelDisplay(existing.room_label as ConditionRoomLabel)} updated`,
    message: 'A room condition entry was updated.',
    metadata: {
      room_entry_id: input.roomEntryId,
      condition_rating: existing.condition_rating,
    },
  })

  return refreshConditionReportArtifacts({
    reportId: input.reportId,
    organizationId: input.organizationId,
  })
}

export async function addConditionReportMediaReference(input: {
  organizationId: string
  reportId: string
  roomEntryId: string
  actorRole: 'owner' | 'tenant' | 'admin'
  actorOwnerId?: string | null
  actorTenantId?: string | null
  actorAdminId?: string | null
  payload: {
    media_kind?: ConditionMediaKind
    media_url?: string | null
    storage_path?: string | null
    mime_type?: string | null
    caption?: string | null
  }
}) {
  const report = await loadConditionReportRow({
    reportId: input.reportId,
    organizationId: input.organizationId,
    ownerId: input.actorRole === 'owner' ? input.actorOwnerId ?? undefined : undefined,
    tenantId: input.actorRole === 'tenant' ? input.actorTenantId ?? undefined : undefined,
  })
  if (!report) {
    throw new AppError('Condition report not found in your scope', 404)
  }

  const roomEntry = await prisma.condition_report_room_entries.findFirst({
    where: { id: input.roomEntryId, condition_report_id: input.reportId, organization_id: input.organizationId },
    select: { id: true, room_label: true },
  })
  if (!roomEntry) {
    throw new AppError('Condition report room not found', 404)
  }

  const created = await prisma.condition_report_media.create({
    data: {
      condition_report_id: input.reportId,
      room_entry_id: input.roomEntryId,
      organization_id: input.organizationId,
      room_label: roomEntry.room_label,
      media_kind: input.payload.media_kind ?? 'photo',
      media_url: asNullableString(input.payload.media_url),
      storage_path: asNullableString(input.payload.storage_path),
      mime_type: asNullableString(input.payload.mime_type),
      caption: asNullableString(input.payload.caption),
      captured_by_role: input.actorRole,
      ai_analysis_status: 'not_requested',
      ai_analysis_payload: {
        note: 'AI visual analysis can be attached later through the provider registry.',
      },
    },
    select: { id: true },
  })

  await createConditionReportEvent({
    organizationId: input.organizationId,
    conditionReportId: input.reportId,
    actorRole: input.actorRole,
    actorOwnerId: input.actorOwnerId ?? null,
    actorTenantId: input.actorTenantId ?? null,
    actorAdminId: input.actorAdminId ?? null,
    eventType: 'media_added',
    title: `${roomLabelDisplay(roomEntry.room_label as ConditionRoomLabel)} evidence linked`,
    message: 'A new media reference was attached to the report.',
    metadata: {
      media_id: created.id,
      room_entry_id: input.roomEntryId,
      room_label: roomEntry.room_label,
    },
  })

  return refreshConditionReportArtifacts({
    reportId: input.reportId,
    organizationId: input.organizationId,
  })
}

async function updateConditionReportConfirmation(input: {
  organizationId: string
  reportId: string
  actorRole: 'owner' | 'tenant'
  actorOwnerId?: string | null
  actorTenantId?: string | null
  status: 'confirmed' | 'disputed'
  note?: string | null
}) {
  const report = await loadConditionReportRow({
    reportId: input.reportId,
    organizationId: input.organizationId,
    ownerId: input.actorRole === 'owner' ? input.actorOwnerId ?? undefined : undefined,
    tenantId: input.actorRole === 'tenant' ? input.actorTenantId ?? undefined : undefined,
  })
  if (!report) {
    throw new AppError('Condition report not found in your scope', 404)
  }

  const now = new Date()
  const patchData =
    input.actorRole === 'owner'
      ? {
          owner_confirmation_status: input.status,
          owner_confirmation_note: asNullableString(input.note),
          owner_confirmed_at: now,
          updated_at: now,
        }
      : {
          tenant_confirmation_status: input.status,
          tenant_confirmation_note: asNullableString(input.note),
          tenant_confirmed_at: now,
          updated_at: now,
        }

  await prisma.condition_reports.update({ where: { id: input.reportId }, data: patchData })

  await createConditionReportEvent({
    organizationId: input.organizationId,
    conditionReportId: input.reportId,
    actorRole: input.actorRole,
    actorOwnerId: input.actorOwnerId ?? null,
    actorTenantId: input.actorTenantId ?? null,
    eventType: input.actorRole === 'owner' ? 'owner_confirmed' : 'tenant_confirmed',
    title: input.actorRole === 'owner' ? 'Owner confirmation recorded' : 'Tenant acknowledgement recorded',
    message: input.status === 'confirmed' ? `${input.actorRole === 'owner' ? 'Owner' : 'Tenant'} confirmed the report.` : `${input.actorRole === 'owner' ? 'Owner' : 'Tenant'} flagged the report for review.`,
    metadata: {
      confirmation_status: input.status,
      note: asNullableString(input.note),
    },
  })

  return refreshConditionReportArtifacts({
    reportId: input.reportId,
    organizationId: input.organizationId,
  })
}

export async function confirmConditionReportAsOwner(input: {
  organizationId: string
  ownerId: string
  reportId: string
  status: 'confirmed' | 'disputed'
  note?: string | null
}) {
  return updateConditionReportConfirmation({
    organizationId: input.organizationId,
    reportId: input.reportId,
    actorRole: 'owner',
    actorOwnerId: input.ownerId,
    status: input.status,
    note: input.note,
  })
}

export async function confirmConditionReportAsTenant(input: {
  organizationId: string
  tenantId: string
  reportId: string
  status: 'confirmed' | 'disputed'
  note?: string | null
}) {
  return updateConditionReportConfirmation({
    organizationId: input.organizationId,
    reportId: input.reportId,
    actorRole: 'tenant',
    actorTenantId: input.tenantId,
    status: input.status,
    note: input.note,
  })
}

async function buildOverviewFromRows(rows: ConditionReportRow[]) {
  const reportIds = rows.map((row) => row.id)
  if (reportIds.length === 0) {
    return [] as ConditionReportOverview[]
  }

  const [roomRows, mediaRows] = await Promise.all([
    prisma.condition_report_room_entries.findMany({
      select: { condition_report_id: true, condition_rating: true, condition_notes: true },
      where: { condition_report_id: { in: reportIds } },
    }),
    prisma.condition_report_media.findMany({
      select: { condition_report_id: true },
      where: { condition_report_id: { in: reportIds } },
    }),
  ])

  const roomGroups = new Map<string, ConditionReportRoomEntryRow[]>()
  for (const row of roomRows as unknown as ConditionReportRoomEntryRow[]) {
    const existing = roomGroups.get(row.condition_report_id) ?? []
    existing.push(row)
    roomGroups.set(row.condition_report_id, existing)
  }

  const mediaGroups = new Map<string, number>()
  for (const row of mediaRows) {
    mediaGroups.set(row.condition_report_id, (mediaGroups.get(row.condition_report_id) ?? 0) + 1)
  }

  return rows.map((row) => {
    const rooms = roomGroups.get(row.id) ?? []
    return mapOverview(row, {
      total_rooms: rooms.length,
      assessed_rooms: rooms.filter(
        (room) => room.condition_rating !== 'not_reviewed' || Boolean(asNullableString(room.condition_notes)),
      ).length,
      media_items: mediaGroups.get(row.id) ?? 0,
    })
  })
}

export async function getOwnerTenantConditionReports(input: {
  organizationId: string
  ownerId: string
  tenantId: string
}) {
  const rawRows = await prisma.condition_reports.findMany({
    select: conditionReportSelect,
    where: { organization_id: input.organizationId, owner_id: input.ownerId, tenant_id: input.tenantId },
    orderBy: { created_at: 'desc' },
  })
  const reports = await buildOverviewFromRows(rawRows.map((r) => serializeConditionReportRow(r as unknown as Record<string, unknown>)))

  return {
    summary: {
      total_reports: reports.length,
      move_in_count: reports.filter((report) => report.report_type === 'move_in').length,
      move_out_count: reports.filter((report) => report.report_type === 'move_out').length,
      awaiting_owner_confirmation_count: reports.filter((report) => report.owner_confirmation_status === 'pending').length,
      awaiting_tenant_confirmation_count: reports.filter((report) => report.tenant_confirmation_status === 'pending').length,
      confirmed_count: reports.filter((report) => report.workflow_status === 'confirmed').length,
    },
    reports,
  } satisfies OwnerConditionReportOverview
}

export async function getOwnerConditionReportDetail(input: {
  organizationId: string
  ownerId: string
  reportId: string
}) {
  return loadConditionReportDetail(input)
}

export async function getTenantConditionReports(input: {
  organizationId: string
  tenantId: string
}) {
  const rawRows = await prisma.condition_reports.findMany({
    select: conditionReportSelect,
    where: { organization_id: input.organizationId, tenant_id: input.tenantId },
    orderBy: { created_at: 'desc' },
  })
  const reports = await buildOverviewFromRows(rawRows.map((r) => serializeConditionReportRow(r as unknown as Record<string, unknown>)))

  return {
    summary: {
      total_reports: reports.length,
      move_in_count: reports.filter((report) => report.report_type === 'move_in').length,
      move_out_count: reports.filter((report) => report.report_type === 'move_out').length,
      awaiting_owner_confirmation_count: reports.filter((report) => report.owner_confirmation_status === 'pending').length,
      awaiting_tenant_confirmation_count: reports.filter((report) => report.tenant_confirmation_status === 'pending').length,
      confirmed_count: reports.filter((report) => report.workflow_status === 'confirmed').length,
    },
    reports,
  } satisfies TenantConditionReportOverview
}

export async function getTenantConditionReportDetail(input: {
  organizationId: string
  tenantId: string
  reportId: string
}) {
  return loadConditionReportDetail(input)
}

export async function getAdminConditionReportOverview(input: {
  organizationId?: string
  page: number
  pageSize: number
  reportType?: ConditionReportType
}) {
  const where: Record<string, unknown> = {}
  if (input.organizationId) where.organization_id = input.organizationId
  if (input.reportType) where.report_type = input.reportType

  const [rawRows, total] = await Promise.all([
    prisma.condition_reports.findMany({
      select: conditionReportSelect,
      where,
      orderBy: { created_at: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.condition_reports.count({ where }),
  ])
  const reports = await buildOverviewFromRows(rawRows.map((r) => serializeConditionReportRow(r as unknown as Record<string, unknown>)))

  return {
    summary: {
      total_reports: total,
      move_in_count: reports.filter((report) => report.report_type === 'move_in').length,
      move_out_count: reports.filter((report) => report.report_type === 'move_out').length,
      pending_confirmations_count: reports.filter(
        (report) => report.owner_confirmation_status === 'pending' || report.tenant_confirmation_status === 'pending',
      ).length,
      generated_document_count: reports.filter((report) => report.generated_document_status === 'generated').length,
    },
    reports,
    total,
    page: input.page,
    page_size: input.pageSize,
  } satisfies AdminConditionReportOverview
}
