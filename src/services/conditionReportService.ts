import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'
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

function throwIfError(error: PostgrestError | null, message: string) {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
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
  const { data, error } = await supabaseAdmin
    .from('properties')
    .select('id, organization_id, owner_id, property_name, address, unit_number')
    .eq('organization_id', organizationId)
    .eq('id', propertyId)
    .maybeSingle()

  throwIfError(error, 'Failed to load property context')
  return (data ?? null) as PropertyRow | null
}

async function loadTenantContext(organizationId: string, tenantId: string) {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id, organization_id, owner_id, property_id, full_name, email, phone, tenant_access_id, lease_start_date, lease_end_date, status')
    .eq('organization_id', organizationId)
    .eq('id', tenantId)
    .maybeSingle()

  throwIfError(error, 'Failed to load tenant context')
  return (data ?? null) as TenantRow | null
}

const conditionReportSelect =
  'id, organization_id, owner_id, property_id, tenant_id, vacancy_campaign_id, baseline_report_id, report_type, workflow_status, trigger_source, trigger_reference, report_label, report_summary, comparison_status, comparison_summary, ai_analysis_status, ai_analysis_payload, generated_document_status, generated_document_format, generated_document_provider, generated_document_url, generated_document_payload, owner_confirmation_status, owner_confirmation_note, owner_confirmed_at, tenant_confirmation_status, tenant_confirmation_note, tenant_confirmed_at, last_summary_refreshed_at, created_at, updated_at, properties(id, organization_id, owner_id, property_name, address, unit_number), tenants(id, organization_id, owner_id, property_id, full_name, email, phone, tenant_access_id, lease_start_date, lease_end_date, status), owners(id, full_name, company_name, email), organizations(id, name, slug)'

async function loadConditionReportRow(input: {
  reportId: string
  organizationId: string
  ownerId?: string
  tenantId?: string
}) {
  let request = supabaseAdmin.from('condition_reports').select(conditionReportSelect).eq('organization_id', input.organizationId).eq('id', input.reportId)

  if (input.ownerId) {
    request = request.eq('owner_id', input.ownerId)
  }

  if (input.tenantId) {
    request = request.eq('tenant_id', input.tenantId)
  }

  const { data, error } = await request.maybeSingle()
  throwIfError(error, 'Failed to load condition report')
  return (data ?? null) as unknown as ConditionReportRow | null
}

async function loadConditionReportRooms(conditionReportId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('condition_report_room_entries')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('condition_report_id', conditionReportId)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: true })

  throwIfError(error, 'Failed to load condition report rooms')
  return (data ?? []) as ConditionReportRoomEntryRow[]
}

async function loadConditionReportMedia(conditionReportId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('condition_report_media')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('condition_report_id', conditionReportId)
    .order('created_at', { ascending: false })

  throwIfError(error, 'Failed to load condition report media')
  return (data ?? []) as ConditionReportMediaRow[]
}

async function loadConditionReportEvents(conditionReportId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('condition_report_events')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('condition_report_id', conditionReportId)
    .order('created_at', { ascending: false })

  throwIfError(error, 'Failed to load condition report events')
  return (data ?? []) as ConditionReportEventRow[]
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
  const { error } = await supabaseAdmin.from('condition_report_events').insert({
    condition_report_id: input.conditionReportId,
    organization_id: input.organizationId,
    actor_role: input.actorRole,
    actor_owner_id: input.actorRole === 'owner' ? input.actorOwnerId ?? null : null,
    actor_tenant_id: input.actorRole === 'tenant' ? input.actorTenantId ?? null : null,
    actor_admin_id: input.actorRole === 'admin' ? input.actorAdminId ?? null : null,
    event_type: input.eventType,
    title: input.title,
    message: input.message,
    metadata: input.metadata ?? {},
  })

  throwIfError(error, 'Failed to create condition report event')
}

async function seedDefaultRooms(conditionReportId: string, organizationId: string) {
  const { error } = await supabaseAdmin.from('condition_report_room_entries').insert(
    conditionReportRoomDefinitions.map((entry) => ({
      condition_report_id: conditionReportId,
      organization_id: organizationId,
      room_label: entry.key,
      display_order: entry.displayOrder,
      condition_rating: 'not_reviewed',
      comparison_result: 'not_applicable',
    })),
  )

  throwIfError(error, 'Failed to create default condition report rooms')
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
  let request = supabaseAdmin
    .from('condition_reports')
    .select(conditionReportSelect)
    .eq('organization_id', input.organizationId)
    .eq('property_id', input.propertyId)
    .eq('report_type', 'move_in')
    .order('created_at', { ascending: false })
    .limit(1)

  if (input.tenantId) {
    request = request.eq('tenant_id', input.tenantId)
  }

  const { data, error } = await request.maybeSingle()
  throwIfError(error, 'Failed to load move-in baseline report')
  return (data ?? null) as unknown as ConditionReportRow | null
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
    const { error: roomPatchError } = await supabaseAdmin.from('condition_report_room_entries').upsert(
      Array.from(comparison.roomPatch.entries()).map(([roomId, patch]) => ({
        id: roomId,
        condition_report_id: report.id,
        organization_id: report.organization_id,
        ...patch,
      })),
      { onConflict: 'id' },
    )
    throwIfError(roomPatchError, 'Failed to refresh room comparison state')
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

  const { error } = await supabaseAdmin
    .from('condition_reports')
    .update({
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
      generated_document_payload: payload,
      last_summary_refreshed_at: new Date().toISOString(),
    })
    .eq('organization_id', report.organization_id)
    .eq('id', report.id)

  throwIfError(error, 'Failed to refresh condition report summary')

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
  let request = supabaseAdmin
    .from('condition_reports')
    .select('id, workflow_status')
    .eq('organization_id', input.organizationId)
    .eq('property_id', input.propertyId)
    .eq('report_type', input.reportType)
    .not('workflow_status', 'eq', 'cancelled')
    .order('created_at', { ascending: false })
    .limit(1)

  if (input.tenantId) {
    request = request.eq('tenant_id', input.tenantId)
  }

  if (input.vacancyCampaignId) {
    request = request.eq('vacancy_campaign_id', input.vacancyCampaignId)
  }

  const { data, error } = await request.maybeSingle()
  throwIfError(error, 'Failed to check existing condition report')
  return data ? (data.id as string) : null
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
  const { data, error } = await supabaseAdmin
    .from('condition_reports')
    .insert({
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
    })
    .select('id')
    .single()

  throwIfError(error, 'Failed to create condition report')
  if (!data?.id) {
    throw new AppError('Condition report id was not returned after creation', 500)
  }

  await seedDefaultRooms(data.id as string, input.organizationId)
  await createConditionReportEvent({
    organizationId: input.organizationId,
    conditionReportId: data.id as string,
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
    reportId: data.id as string,
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

  const { data, error } = await supabaseAdmin
    .from('condition_report_room_entries')
    .update({
      ...(typeof input.patch.condition_rating === 'string' ? { condition_rating: input.patch.condition_rating } : {}),
      ...(typeof input.patch.condition_notes !== 'undefined' ? { condition_notes: asNullableString(input.patch.condition_notes) } : {}),
    })
    .eq('organization_id', input.organizationId)
    .eq('condition_report_id', input.reportId)
    .eq('id', input.roomEntryId)
    .select('*')
    .maybeSingle()

  throwIfError(error, 'Failed to update condition report room')
  if (!data) {
    throw new AppError('Condition report room not found', 404)
  }

  await createConditionReportEvent({
    organizationId: input.organizationId,
    conditionReportId: input.reportId,
    actorRole: 'owner',
    actorOwnerId: input.ownerId,
    eventType: 'room_updated',
    title: `${roomLabelDisplay((data as ConditionReportRoomEntryRow).room_label)} updated`,
    message: 'A room condition entry was updated.',
    metadata: {
      room_entry_id: input.roomEntryId,
      condition_rating: (data as ConditionReportRoomEntryRow).condition_rating,
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

  const { data: roomEntry, error: roomError } = await supabaseAdmin
    .from('condition_report_room_entries')
    .select('*')
    .eq('organization_id', input.organizationId)
    .eq('condition_report_id', input.reportId)
    .eq('id', input.roomEntryId)
    .maybeSingle()

  throwIfError(roomError, 'Failed to load condition report room')
  if (!roomEntry) {
    throw new AppError('Condition report room not found', 404)
  }

  const { data, error } = await supabaseAdmin
    .from('condition_report_media')
    .insert({
      condition_report_id: input.reportId,
      room_entry_id: input.roomEntryId,
      organization_id: input.organizationId,
      room_label: (roomEntry as ConditionReportRoomEntryRow).room_label,
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
    })
    .select('*')
    .single()

  throwIfError(error, 'Failed to add condition report media')

  await createConditionReportEvent({
    organizationId: input.organizationId,
    conditionReportId: input.reportId,
    actorRole: input.actorRole,
    actorOwnerId: input.actorOwnerId ?? null,
    actorTenantId: input.actorTenantId ?? null,
    actorAdminId: input.actorAdminId ?? null,
    eventType: 'media_added',
    title: `${roomLabelDisplay((roomEntry as ConditionReportRoomEntryRow).room_label)} evidence linked`,
    message: 'A new media reference was attached to the report.',
    metadata: {
      media_id: (data as ConditionReportMediaRow).id,
      room_entry_id: input.roomEntryId,
      room_label: (roomEntry as ConditionReportRoomEntryRow).room_label,
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

  const nowIso = new Date().toISOString()
  const patch =
    input.actorRole === 'owner'
      ? {
          owner_confirmation_status: input.status,
          owner_confirmation_note: asNullableString(input.note),
          owner_confirmed_at: nowIso,
        }
      : {
          tenant_confirmation_status: input.status,
          tenant_confirmation_note: asNullableString(input.note),
          tenant_confirmed_at: nowIso,
        }

  const { error } = await supabaseAdmin.from('condition_reports').update(patch).eq('organization_id', input.organizationId).eq('id', input.reportId)
  throwIfError(error, 'Failed to update condition report confirmation')

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

  const [roomsResult, mediaResult] = await Promise.all([
    supabaseAdmin.from('condition_report_room_entries').select('condition_report_id, condition_rating, condition_notes').in('condition_report_id', reportIds),
    supabaseAdmin.from('condition_report_media').select('condition_report_id').in('condition_report_id', reportIds),
  ])

  throwIfError(roomsResult.error, 'Failed to load condition report room completion')
  throwIfError(mediaResult.error, 'Failed to load condition report media completion')

  const roomGroups = new Map<string, ConditionReportRoomEntryRow[]>()
  for (const row of (roomsResult.data ?? []) as unknown as ConditionReportRoomEntryRow[]) {
    const existing = roomGroups.get(row.condition_report_id) ?? []
    existing.push(row)
    roomGroups.set(row.condition_report_id, existing)
  }

  const mediaGroups = new Map<string, number>()
  for (const row of (mediaResult.data ?? []) as Array<{ condition_report_id: string }>) {
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
  const { data, error } = await supabaseAdmin
    .from('condition_reports')
    .select(conditionReportSelect)
    .eq('organization_id', input.organizationId)
    .eq('owner_id', input.ownerId)
    .eq('tenant_id', input.tenantId)
    .order('created_at', { ascending: false })

  throwIfError(error, 'Failed to load owner condition reports')
  const reports = await buildOverviewFromRows((data ?? []) as unknown as ConditionReportRow[])

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
  const { data, error } = await supabaseAdmin
    .from('condition_reports')
    .select(conditionReportSelect)
    .eq('organization_id', input.organizationId)
    .eq('tenant_id', input.tenantId)
    .order('created_at', { ascending: false })

  throwIfError(error, 'Failed to load tenant condition reports')
  const reports = await buildOverviewFromRows((data ?? []) as unknown as ConditionReportRow[])

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
  const from = (input.page - 1) * input.pageSize
  const to = from + input.pageSize - 1

  let request = supabaseAdmin
    .from('condition_reports')
    .select(conditionReportSelect, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (input.organizationId) {
    request = request.eq('organization_id', input.organizationId)
  }

  if (input.reportType) {
    request = request.eq('report_type', input.reportType)
  }

  const { data, error, count } = await request
  throwIfError(error, 'Failed to load admin condition reports')
  const reports = await buildOverviewFromRows((data ?? []) as unknown as ConditionReportRow[])

  return {
    summary: {
      total_reports: count ?? reports.length,
      move_in_count: reports.filter((report) => report.report_type === 'move_in').length,
      move_out_count: reports.filter((report) => report.report_type === 'move_out').length,
      pending_confirmations_count: reports.filter(
        (report) => report.owner_confirmation_status === 'pending' || report.tenant_confirmation_status === 'pending',
      ).length,
      generated_document_count: reports.filter((report) => report.generated_document_status === 'generated').length,
    },
    reports,
    total: count ?? reports.length,
    page: input.page,
    page_size: input.pageSize,
  } satisfies AdminConditionReportOverview
}
