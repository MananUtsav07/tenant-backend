import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { deliverOwnerAutomationMessage } from './automation/providers/messageProvider.js'
import { getAutomationProviderRegistry } from './automation/providers/providerRegistry.js'
import { createOwnerNotification } from './ownerService.js'

export const maintenanceCategories = [
  'general',
  'plumbing',
  'electrical',
  'hvac',
  'appliance',
  'locksmith',
  'pest_control',
  'cleaning',
  'painting',
  'carpentry',
  'waterproofing',
  'other',
] as const

export type MaintenanceCategory = (typeof maintenanceCategories)[number]

export const maintenanceUrgencies = ['emergency', 'urgent', 'standard'] as const
export type MaintenanceUrgency = (typeof maintenanceUrgencies)[number]

export const maintenanceWorkflowStatuses = [
  'triaged',
  'quote_collection',
  'owner_review',
  'assigned',
  'scheduled',
  'in_progress',
  'awaiting_tenant_confirmation',
  'completed',
  'cancelled',
] as const
export type MaintenanceWorkflowStatus = (typeof maintenanceWorkflowStatuses)[number]

export const maintenanceAssignmentStatuses = [
  'approved',
  'scheduled',
  'in_progress',
  'completed',
  'tenant_confirmed',
  'cancelled',
  'follow_up_required',
] as const
export type MaintenanceAssignmentStatus = (typeof maintenanceAssignmentStatuses)[number]

const specialtyKeywords: Record<MaintenanceCategory, string[]> = {
  general: ['repair', 'maintenance', 'issue', 'problem', 'fix', 'broken'],
  plumbing: ['plumb', 'pipe', 'tap', 'faucet', 'toilet', 'drain', 'leak', 'water pressure', 'sink', 'flush'],
  electrical: ['electric', 'power', 'switch', 'socket', 'outlet', 'wire', 'light', 'circuit', 'fuse', 'spark'],
  hvac: ['ac', 'aircon', 'air condition', 'cooling', 'heating', 'thermostat', 'ventilation'],
  appliance: ['fridge', 'refrigerator', 'oven', 'microwave', 'washer', 'dryer', 'dishwasher', 'appliance'],
  locksmith: ['lock', 'key', 'door jam', 'door lock', 'locked out', 'access'],
  pest_control: ['pest', 'cockroach', 'rat', 'mice', 'termite', 'bed bug', 'mosquito'],
  cleaning: ['clean', 'deep clean', 'stain', 'dirty', 'garbage'],
  painting: ['paint', 'repaint', 'wall colour', 'peeling paint', 'patch'],
  carpentry: ['cabinet', 'hinge', 'wood', 'shelf', 'drawer', 'carpentry'],
  waterproofing: ['waterproof', 'damp', 'seepage', 'moisture', 'water ingress'],
  other: [],
}

const maintenanceKeywords = Array.from(new Set(Object.values(specialtyKeywords).flat())).concat([
  'maintenance',
  'repair',
  'broken',
  'damaged',
  'not working',
])

const emergencyKeywords = ['fire', 'smoke', 'gas leak', 'burst pipe', 'flood', 'flooding', 'sparks', 'unsafe', 'electrocute']
const urgentKeywords = [
  'leak',
  'no water',
  'no power',
  'ac not working',
  'blocked',
  'broken lock',
  'lock out',
  'sewage',
  'urgent',
]

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function toSentenceCase(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

function coerceIso(value: string | null | undefined) {
  const normalized = normalizeString(value)
  if (!normalized) {
    return null
  }

  const date = new Date(normalized)
  if (Number.isNaN(date.getTime())) {
    throw new AppError('Invalid date value supplied', 400)
  }

  return date.toISOString()
}

function formatDateTime(value: string | null | undefined) {
  if (!value) {
    return 'Not scheduled'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatCurrency(amount: number, currencyCode: string | null | undefined) {
  const normalized = normalizeString(currencyCode).toUpperCase() || 'INR'
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: normalized,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return `${normalized} ${amount.toFixed(2)}`
  }
}

function categorizeMaintenanceTicket(input: { subject: string; message: string }): {
  isMaintenance: boolean
  category: MaintenanceCategory
  urgency: MaintenanceUrgency
  classificationSource: 'rules'
  rationale: string
} {
  const haystack = `${input.subject} ${input.message}`.toLowerCase()

  let category: MaintenanceCategory = 'other'
  let bestScore = 0

  for (const [candidate, keywords] of Object.entries(specialtyKeywords) as Array<[MaintenanceCategory, string[]]>) {
    const score = keywords.reduce((total, keyword) => total + (haystack.includes(keyword) ? 1 : 0), 0)
    if (score > bestScore) {
      bestScore = score
      category = candidate
    }
  }

  const isMaintenance = maintenanceKeywords.some((keyword) => haystack.includes(keyword)) || bestScore > 0
  if (!isMaintenance) {
    return {
      isMaintenance: false,
      category: 'general',
      urgency: 'standard',
      classificationSource: 'rules',
      rationale: 'No maintenance keywords detected in the submitted ticket.',
    }
  }

  const urgency: MaintenanceUrgency = emergencyKeywords.some((keyword) => haystack.includes(keyword))
    ? 'emergency'
    : urgentKeywords.some((keyword) => haystack.includes(keyword))
      ? 'urgent'
      : 'standard'

  return {
    isMaintenance: true,
    category: category === 'other' ? 'general' : category,
    urgency,
    classificationSource: 'rules',
    rationale: bestScore > 0 ? `Matched maintenance keywords for ${category}.` : 'Matched general maintenance keywords.',
  }
}

type TicketContext = {
  id: string
  organization_id: string
  owner_id: string
  tenant_id: string
  subject: string
  message: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
  created_at: string
  updated_at: string
  tenants: {
    id: string
    full_name: string
    email: string | null
    tenant_access_id: string
    property_id: string | null
    properties: {
      id: string
      property_name: string | null
      unit_number: string | null
      address: string | null
    } | null
  } | null
  owners: {
    id: string
    full_name: string | null
    company_name: string | null
    email: string | null
    support_email: string | null
  } | null
  organizations: {
    id: string
    name: string | null
    slug: string | null
    currency_code: string | null
  } | null
}

type ContractorSummary = {
  id: string
  organization_id: string
  owner_id: string | null
  company_name: string
  contact_name: string | null
  email: string | null
  phone: string | null
  whatsapp: string | null
  is_active: boolean
  notes: string | null
  created_at: string
  updated_at: string
  specialties: MaintenanceCategory[]
  average_rating: number | null
  completed_jobs_count: number
}

type MaintenanceWorkflowRecord = {
  id: string
  ticket_id: string
  organization_id: string
  owner_id: string
  tenant_id: string
  property_id: string | null
  category: MaintenanceCategory
  urgency: MaintenanceUrgency
  workflow_status: MaintenanceWorkflowStatus
  classification_source: 'rules' | 'ai' | 'manual'
  classification_notes: string | null
  quote_requested_at: string | null
  approved_quote_id: string | null
  approved_at: string | null
  approved_by_owner_id: string | null
  follow_up_due_at: string | null
  follow_up_alert_sent_at: string | null
  created_at: string
  updated_at: string
}

type QuoteRequestRecord = {
  id: string
  organization_id: string
  maintenance_workflow_id: string
  ticket_id: string
  contractor_id: string
  request_channel: 'email' | 'whatsapp' | 'internal'
  status: 'requested' | 'responded' | 'declined' | 'expired' | 'cancelled'
  requested_at: string
  responded_at: string | null
  expires_at: string | null
  request_message: string | null
  provider_reference: string | null
  created_at: string
  updated_at: string
  contractor: ContractorSummary | null
}

type ContractorQuoteRecord = {
  id: string
  organization_id: string
  maintenance_workflow_id: string
  quote_request_id: string | null
  contractor_id: string
  amount: number
  currency_code: string
  scope_of_work: string
  availability_note: string | null
  estimated_start_at: string | null
  estimated_completion_at: string | null
  status: 'submitted' | 'withdrawn' | 'accepted' | 'rejected'
  submitted_at: string
  created_at: string
  updated_at: string
  contractor: ContractorSummary | null
}

type MaintenanceAssignmentRecord = {
  id: string
  organization_id: string
  maintenance_workflow_id: string
  ticket_id: string
  contractor_id: string
  quote_id: string | null
  approved_by_owner_id: string
  booking_status: MaintenanceAssignmentStatus
  appointment_start_at: string | null
  appointment_end_at: string | null
  appointment_notes: string | null
  completion_notes: string | null
  completed_at: string | null
  tenant_confirmed_at: string | null
  tenant_feedback_rating: number | null
  tenant_feedback_note: string | null
  follow_up_due_at: string | null
  follow_up_alert_sent_at: string | null
  created_at: string
  updated_at: string
  contractor: ContractorSummary | null
  quote: ContractorQuoteRecord | null
}

export type MaintenanceWorkflowOverview = {
  ticket: TicketContext
  suggested_triage: ReturnType<typeof categorizeMaintenanceTicket>
  workflow: (MaintenanceWorkflowRecord & {
    quote_requests: QuoteRequestRecord[]
    quotes: ContractorQuoteRecord[]
    assignment: MaintenanceAssignmentRecord | null
    quote_comparison: {
      lowest_quote: ContractorQuoteRecord | null
      highest_quote: ContractorQuoteRecord | null
      average_amount: number | null
      quote_count: number
    }
  }) | null
  contractors: ContractorSummary[]
  relevant_contractors: ContractorSummary[]
}

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }
  return value ?? null
}

async function loadTicketContext(input: {
  ticketId: string
  organizationId?: string
  tenantId?: string
}): Promise<TicketContext | null> {
  let request = supabaseAdmin
    .from('support_tickets')
    .select(`
      id,
      organization_id,
      owner_id,
      tenant_id,
      subject,
      message,
      status,
      created_at,
      updated_at,
      tenants(
        id,
        full_name,
        email,
        tenant_access_id,
        property_id,
        properties(id, property_name, unit_number, address)
      ),
      owners(id, full_name, company_name, email, support_email),
      organizations(id, name, slug, currency_code)
    `)
    .eq('id', input.ticketId)

  if (input.organizationId) {
    request = request.eq('organization_id', input.organizationId)
  }
  if (input.tenantId) {
    request = request.eq('tenant_id', input.tenantId)
  }

  const { data, error } = await request.maybeSingle()
  throwIfError(error, 'Failed to load support ticket context')
  if (!data) {
    return null
  }

  const row = data as Record<string, unknown>
  const tenant = normalizeRelation(row.tenants as Record<string, unknown> | Record<string, unknown>[] | null)
  const property = normalizeRelation(
    (tenant?.properties as Record<string, unknown> | Record<string, unknown>[] | null | undefined) ?? null,
  )

  return {
    id: row.id as string,
    organization_id: row.organization_id as string,
    owner_id: row.owner_id as string,
    tenant_id: row.tenant_id as string,
    subject: row.subject as string,
    message: row.message as string,
    status: row.status as TicketContext['status'],
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
    tenants: tenant
      ? {
          id: tenant.id as string,
          full_name: (tenant.full_name as string) ?? 'Tenant',
          email: (tenant.email as string | null) ?? null,
          tenant_access_id: (tenant.tenant_access_id as string) ?? '-',
          property_id: (tenant.property_id as string | null) ?? null,
          properties: property
            ? {
                id: property.id as string,
                property_name: (property.property_name as string | null) ?? null,
                unit_number: (property.unit_number as string | null) ?? null,
                address: (property.address as string | null) ?? null,
              }
            : null,
        }
      : null,
    owners: normalizeRelation(row.owners as Record<string, unknown> | Record<string, unknown>[] | null) as TicketContext['owners'],
    organizations: normalizeRelation(
      row.organizations as Record<string, unknown> | Record<string, unknown>[] | null,
    ) as TicketContext['organizations'],
  }
}

async function appendSystemTicketMessage(input: { ticketId: string; organizationId: string; message: string }) {
  const { error } = await supabaseAdmin.from('support_ticket_messages').insert({
    ticket_id: input.ticketId,
    organization_id: input.organizationId,
    sender_role: 'system',
    message: input.message,
    message_type: 'system',
  })

  throwIfError(error, 'Failed to append maintenance system message')
}

async function updateTicketStatusIfNeeded(input: {
  ticketId: string
  organizationId: string
  status: TicketContext['status']
}) {
  const { error } = await supabaseAdmin
    .from('support_tickets')
    .update({ status: input.status, updated_at: new Date().toISOString() })
    .eq('id', input.ticketId)
    .eq('organization_id', input.organizationId)
    .neq('status', input.status)

  throwIfError(error, 'Failed to sync ticket status')
}

async function loadContractorRatings(organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('maintenance_assignments')
    .select('contractor_id, tenant_feedback_rating')
    .eq('organization_id', organizationId)
    .not('tenant_feedback_rating', 'is', null)

  throwIfError(error, 'Failed to load contractor ratings')

  const ratingMap = new Map<string, { total: number; count: number }>()
  for (const row of data ?? []) {
    const contractorId = (row as { contractor_id?: string }).contractor_id
    const rating = (row as { tenant_feedback_rating?: number | null }).tenant_feedback_rating
    if (!contractorId || typeof rating !== 'number') {
      continue
    }

    const current = ratingMap.get(contractorId) ?? { total: 0, count: 0 }
    current.total += rating
    current.count += 1
    ratingMap.set(contractorId, current)
  }

  return ratingMap
}
async function listOrganizationContractors(organizationId: string) {
  const [{ data, error }, ratingMap] = await Promise.all([
    supabaseAdmin
      .from('contractor_directory')
      .select('id, organization_id, owner_id, company_name, contact_name, email, phone, whatsapp, is_active, notes, created_at, updated_at, contractor_specialties(specialty)')
      .eq('organization_id', organizationId)
      .order('company_name', { ascending: true }),
    loadContractorRatings(organizationId),
  ])

  throwIfError(error, 'Failed to load contractor directory')

  return (data ?? []).map((row) => {
    const contractor = row as Record<string, unknown>
    const specialties = ((contractor.contractor_specialties as Array<Record<string, unknown>> | null | undefined) ?? []).map(
      (item) => item.specialty as MaintenanceCategory,
    )
    const rating = ratingMap.get(contractor.id as string)

    return {
      id: contractor.id as string,
      organization_id: contractor.organization_id as string,
      owner_id: (contractor.owner_id as string | null) ?? null,
      company_name: contractor.company_name as string,
      contact_name: (contractor.contact_name as string | null) ?? null,
      email: (contractor.email as string | null) ?? null,
      phone: (contractor.phone as string | null) ?? null,
      whatsapp: (contractor.whatsapp as string | null) ?? null,
      is_active: Boolean(contractor.is_active),
      notes: (contractor.notes as string | null) ?? null,
      created_at: contractor.created_at as string,
      updated_at: contractor.updated_at as string,
      specialties,
      average_rating: rating && rating.count > 0 ? Number((rating.total / rating.count).toFixed(2)) : null,
      completed_jobs_count: rating?.count ?? 0,
    } satisfies ContractorSummary
  })
}

async function loadWorkflowRecord(ticketId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('maintenance_workflows')
    .select('*')
    .eq('ticket_id', ticketId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  throwIfError(error, 'Failed to load maintenance workflow')
  return (data as MaintenanceWorkflowRecord | null) ?? null
}

async function loadWorkflowQuoteRequests(workflowId: string, organizationId: string, contractors: ContractorSummary[]) {
  const contractorMap = new Map(contractors.map((contractor) => [contractor.id, contractor]))
  const { data, error } = await supabaseAdmin
    .from('contractor_quote_requests')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('maintenance_workflow_id', workflowId)
    .order('requested_at', { ascending: false })

  throwIfError(error, 'Failed to load contractor quote requests')

  return (data ?? []).map((row) => {
    const record = row as Record<string, unknown>
    return {
      id: record.id as string,
      organization_id: record.organization_id as string,
      maintenance_workflow_id: record.maintenance_workflow_id as string,
      ticket_id: record.ticket_id as string,
      contractor_id: record.contractor_id as string,
      request_channel: record.request_channel as QuoteRequestRecord['request_channel'],
      status: record.status as QuoteRequestRecord['status'],
      requested_at: record.requested_at as string,
      responded_at: (record.responded_at as string | null) ?? null,
      expires_at: (record.expires_at as string | null) ?? null,
      request_message: (record.request_message as string | null) ?? null,
      provider_reference: (record.provider_reference as string | null) ?? null,
      created_at: record.created_at as string,
      updated_at: record.updated_at as string,
      contractor: contractorMap.get(record.contractor_id as string) ?? null,
    } satisfies QuoteRequestRecord
  })
}

async function loadWorkflowQuotes(workflowId: string, organizationId: string, contractors: ContractorSummary[]) {
  const contractorMap = new Map(contractors.map((contractor) => [contractor.id, contractor]))
  const { data, error } = await supabaseAdmin
    .from('contractor_quotes')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('maintenance_workflow_id', workflowId)
    .order('submitted_at', { ascending: false })

  throwIfError(error, 'Failed to load contractor quotes')

  return (data ?? []).map((row) => {
    const record = row as Record<string, unknown>
    return {
      id: record.id as string,
      organization_id: record.organization_id as string,
      maintenance_workflow_id: record.maintenance_workflow_id as string,
      quote_request_id: (record.quote_request_id as string | null) ?? null,
      contractor_id: record.contractor_id as string,
      amount: Number(record.amount ?? 0),
      currency_code: (record.currency_code as string) ?? 'INR',
      scope_of_work: record.scope_of_work as string,
      availability_note: (record.availability_note as string | null) ?? null,
      estimated_start_at: (record.estimated_start_at as string | null) ?? null,
      estimated_completion_at: (record.estimated_completion_at as string | null) ?? null,
      status: record.status as ContractorQuoteRecord['status'],
      submitted_at: record.submitted_at as string,
      created_at: record.created_at as string,
      updated_at: record.updated_at as string,
      contractor: contractorMap.get(record.contractor_id as string) ?? null,
    } satisfies ContractorQuoteRecord
  })
}

async function loadWorkflowAssignment(
  workflowId: string,
  organizationId: string,
  contractors: ContractorSummary[],
  quotes: ContractorQuoteRecord[],
) {
  const contractorMap = new Map(contractors.map((contractor) => [contractor.id, contractor]))
  const quoteMap = new Map(quotes.map((quote) => [quote.id, quote]))

  const { data, error } = await supabaseAdmin
    .from('maintenance_assignments')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('maintenance_workflow_id', workflowId)
    .maybeSingle()

  throwIfError(error, 'Failed to load maintenance assignment')
  if (!data) {
    return null
  }

  const record = data as Record<string, unknown>
  return {
    id: record.id as string,
    organization_id: record.organization_id as string,
    maintenance_workflow_id: record.maintenance_workflow_id as string,
    ticket_id: record.ticket_id as string,
    contractor_id: record.contractor_id as string,
    quote_id: (record.quote_id as string | null) ?? null,
    approved_by_owner_id: record.approved_by_owner_id as string,
    booking_status: record.booking_status as MaintenanceAssignmentStatus,
    appointment_start_at: (record.appointment_start_at as string | null) ?? null,
    appointment_end_at: (record.appointment_end_at as string | null) ?? null,
    appointment_notes: (record.appointment_notes as string | null) ?? null,
    completion_notes: (record.completion_notes as string | null) ?? null,
    completed_at: (record.completed_at as string | null) ?? null,
    tenant_confirmed_at: (record.tenant_confirmed_at as string | null) ?? null,
    tenant_feedback_rating: typeof record.tenant_feedback_rating === 'number' ? record.tenant_feedback_rating : null,
    tenant_feedback_note: (record.tenant_feedback_note as string | null) ?? null,
    follow_up_due_at: (record.follow_up_due_at as string | null) ?? null,
    follow_up_alert_sent_at: (record.follow_up_alert_sent_at as string | null) ?? null,
    created_at: record.created_at as string,
    updated_at: record.updated_at as string,
    contractor: contractorMap.get(record.contractor_id as string) ?? null,
    quote: record.quote_id ? quoteMap.get(record.quote_id as string) ?? null : null,
  } satisfies MaintenanceAssignmentRecord
}

function buildQuoteComparison(quotes: ContractorQuoteRecord[]) {
  const submittedQuotes = quotes.filter((quote) => quote.status === 'submitted' || quote.status === 'accepted')
  if (submittedQuotes.length === 0) {
    return {
      lowest_quote: null,
      highest_quote: null,
      average_amount: null,
      quote_count: 0,
    }
  }

  const sorted = [...submittedQuotes].sort((left, right) => left.amount - right.amount)
  const total = sorted.reduce((sum, quote) => sum + quote.amount, 0)
  return {
    lowest_quote: sorted[0] ?? null,
    highest_quote: sorted[sorted.length - 1] ?? null,
    average_amount: Number((total / sorted.length).toFixed(2)),
    quote_count: sorted.length,
  }
}

function pickRelevantContractors(contractors: ContractorSummary[], category: MaintenanceCategory) {
  return contractors.filter((contractor) => {
    if (!contractor.is_active) {
      return false
    }
    if (category === 'general') {
      return true
    }
    return contractor.specialties.includes(category) || contractor.specialties.includes('general')
  })
}

async function buildWorkflowOverview(ticket: TicketContext): Promise<MaintenanceWorkflowOverview> {
  const suggested = categorizeMaintenanceTicket({
    subject: ticket.subject,
    message: ticket.message,
  })
  const [workflow, contractors] = await Promise.all([
    loadWorkflowRecord(ticket.id, ticket.organization_id),
    listOrganizationContractors(ticket.organization_id),
  ])

  if (!workflow) {
    return {
      ticket,
      suggested_triage: suggested,
      workflow: null,
      contractors,
      relevant_contractors: pickRelevantContractors(contractors, suggested.category),
    }
  }

  const quoteRequests = await loadWorkflowQuoteRequests(workflow.id, workflow.organization_id, contractors)
  const quotes = await loadWorkflowQuotes(workflow.id, workflow.organization_id, contractors)
  const assignment = await loadWorkflowAssignment(workflow.id, workflow.organization_id, contractors, quotes)

  return {
    ticket,
    suggested_triage: suggested,
    workflow: {
      ...workflow,
      quote_requests: quoteRequests,
      quotes,
      assignment,
      quote_comparison: buildQuoteComparison(quotes),
    },
    contractors,
    relevant_contractors: pickRelevantContractors(contractors, workflow.category),
  }
}

export async function getOwnerMaintenanceWorkflowOverview(input: { ticketId: string; organizationId: string }) {
  const ticket = await loadTicketContext({
    ticketId: input.ticketId,
    organizationId: input.organizationId,
  })

  if (!ticket) {
    return null
  }

  return buildWorkflowOverview(ticket)
}

export async function getTenantMaintenanceWorkflowOverview(input: {
  ticketId: string
  tenantId: string
  organizationId: string
}) {
  const ticket = await loadTicketContext({
    ticketId: input.ticketId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  })

  if (!ticket) {
    return null
  }

  const overview = await buildWorkflowOverview(ticket)
  return {
    ticket: overview.ticket,
    workflow: overview.workflow,
  }
}

export async function listContractorDirectory(input: { organizationId: string }) {
  return listOrganizationContractors(input.organizationId)
}
export async function createContractorDirectoryEntry(input: {
  organizationId: string
  ownerId: string
  companyName: string
  contactName?: string | null
  email?: string | null
  phone?: string | null
  whatsapp?: string | null
  notes?: string | null
  specialties: MaintenanceCategory[]
}) {
  const { data, error } = await supabaseAdmin
    .from('contractor_directory')
    .insert({
      organization_id: input.organizationId,
      owner_id: input.ownerId,
      company_name: input.companyName,
      contact_name: input.contactName ?? null,
      email: input.email ?? null,
      phone: input.phone ?? null,
      whatsapp: input.whatsapp ?? null,
      notes: input.notes ?? null,
      is_active: true,
    })
    .select('*')
    .single()

  throwIfError(error, 'Failed to create contractor')

  const specialties = Array.from(new Set(input.specialties))
  if (specialties.length > 0) {
    const { error: specialtiesError } = await supabaseAdmin.from('contractor_specialties').insert(
      specialties.map((specialty) => ({
        organization_id: input.organizationId,
        contractor_id: data.id,
        specialty,
      })),
    )
    throwIfError(specialtiesError, 'Failed to store contractor specialties')
  }

  const contractors = await listOrganizationContractors(input.organizationId)
  const contractor = contractors.find((item) => item.id === data.id)
  if (!contractor) {
    throw new AppError('Contractor created but could not be reloaded', 500)
  }

  return contractor
}

export async function updateContractorDirectoryEntry(input: {
  organizationId: string
  contractorId: string
  patch: {
    company_name?: string
    contact_name?: string | null
    email?: string | null
    phone?: string | null
    whatsapp?: string | null
    notes?: string | null
    is_active?: boolean
    specialties?: MaintenanceCategory[]
  }
}) {
  const updatePatch: Record<string, unknown> = {}
  if (typeof input.patch.company_name === 'string') {
    updatePatch.company_name = input.patch.company_name
  }
  for (const field of ['contact_name', 'email', 'phone', 'whatsapp', 'notes'] as const) {
    if (field in input.patch) {
      updatePatch[field] = input.patch[field] ?? null
    }
  }
  if (typeof input.patch.is_active === 'boolean') {
    updatePatch.is_active = input.patch.is_active
  }

  if (Object.keys(updatePatch).length > 0) {
    const { error } = await supabaseAdmin
      .from('contractor_directory')
      .update(updatePatch)
      .eq('id', input.contractorId)
      .eq('organization_id', input.organizationId)
    throwIfError(error, 'Failed to update contractor')
  }

  if (Array.isArray(input.patch.specialties)) {
    const uniqueSpecialties = Array.from(new Set(input.patch.specialties))
    const { error: deleteError } = await supabaseAdmin
      .from('contractor_specialties')
      .delete()
      .eq('organization_id', input.organizationId)
      .eq('contractor_id', input.contractorId)
    throwIfError(deleteError, 'Failed to reset contractor specialties')

    if (uniqueSpecialties.length > 0) {
      const { error: insertError } = await supabaseAdmin.from('contractor_specialties').insert(
        uniqueSpecialties.map((specialty) => ({
          organization_id: input.organizationId,
          contractor_id: input.contractorId,
          specialty,
        })),
      )
      throwIfError(insertError, 'Failed to update contractor specialties')
    }
  }

  const contractors = await listOrganizationContractors(input.organizationId)
  const contractor = contractors.find((item) => item.id === input.contractorId)
  if (!contractor) {
    throw new AppError('Contractor not found in organization', 404)
  }
  return contractor
}

async function insertWorkflow(input: {
  ticket: TicketContext
  category: MaintenanceCategory
  urgency: MaintenanceUrgency
  classificationSource: 'rules' | 'ai' | 'manual'
  classificationNotes?: string | null
}) {
  const { data, error } = await supabaseAdmin
    .from('maintenance_workflows')
    .insert({
      ticket_id: input.ticket.id,
      organization_id: input.ticket.organization_id,
      owner_id: input.ticket.owner_id,
      tenant_id: input.ticket.tenant_id,
      property_id: input.ticket.tenants?.property_id ?? null,
      category: input.category,
      urgency: input.urgency,
      workflow_status: 'triaged',
      classification_source: input.classificationSource,
      classification_notes: input.classificationNotes ?? null,
    })
    .select('*')
    .single()

  throwIfError(error, 'Failed to create maintenance workflow')
  await appendSystemTicketMessage({
    ticketId: input.ticket.id,
    organizationId: input.ticket.organization_id,
    message: `Maintenance workflow started. Category: ${toSentenceCase(input.category)}. Urgency: ${toSentenceCase(input.urgency)}.`,
  })
  await updateTicketStatusIfNeeded({
    ticketId: input.ticket.id,
    organizationId: input.ticket.organization_id,
    status: input.ticket.status === 'open' ? 'in_progress' : input.ticket.status,
  })
  return data as MaintenanceWorkflowRecord
}

export async function initializeMaintenanceWorkflow(input: {
  ticketId: string
  organizationId: string
  ownerId: string
  category?: MaintenanceCategory
  urgency?: MaintenanceUrgency
  classificationNotes?: string | null
  manual?: boolean
}) {
  const ticket = await loadTicketContext({
    ticketId: input.ticketId,
    organizationId: input.organizationId,
  })
  if (!ticket) {
    throw new AppError('Ticket not found in organization', 404)
  }
  if (ticket.owner_id !== input.ownerId) {
    throw new AppError('Ticket not found in organization', 404)
  }

  const existing = await loadWorkflowRecord(ticket.id, ticket.organization_id)
  const suggested = categorizeMaintenanceTicket({ subject: ticket.subject, message: ticket.message })

  if (!existing) {
    if (!input.manual && !suggested.isMaintenance) {
      return null
    }

    await insertWorkflow({
      ticket,
      category: input.category ?? suggested.category,
      urgency: input.urgency ?? suggested.urgency,
      classificationSource: input.manual ? 'manual' : suggested.classificationSource,
      classificationNotes: input.classificationNotes ?? suggested.rationale,
    })
  } else if (input.manual) {
    const { error } = await supabaseAdmin
      .from('maintenance_workflows')
      .update({
        category: input.category ?? existing.category,
        urgency: input.urgency ?? existing.urgency,
        classification_source: 'manual',
        classification_notes: input.classificationNotes ?? existing.classification_notes,
      })
      .eq('id', existing.id)
      .eq('organization_id', input.organizationId)

    throwIfError(error, 'Failed to update maintenance triage')
    await appendSystemTicketMessage({
      ticketId: ticket.id,
      organizationId: ticket.organization_id,
      message: `Maintenance triage updated by owner. Category: ${toSentenceCase(input.category ?? existing.category)}. Urgency: ${toSentenceCase(input.urgency ?? existing.urgency)}.`,
    })
  }

  return getOwnerMaintenanceWorkflowOverview({
    ticketId: ticket.id,
    organizationId: ticket.organization_id,
  })
}

export async function maybeInitializeMaintenanceWorkflowForTicket(input: {
  ticketId: string
  organizationId: string
}) {
  const ticket = await loadTicketContext({
    ticketId: input.ticketId,
    organizationId: input.organizationId,
  })
  if (!ticket) {
    return null
  }

  const existing = await loadWorkflowRecord(ticket.id, ticket.organization_id)
  if (existing) {
    return getOwnerMaintenanceWorkflowOverview({
      ticketId: ticket.id,
      organizationId: ticket.organization_id,
    })
  }

  const suggested = categorizeMaintenanceTicket({
    subject: ticket.subject,
    message: ticket.message,
  })
  if (!suggested.isMaintenance) {
    return null
  }

  await insertWorkflow({
    ticket,
    category: suggested.category,
    urgency: suggested.urgency,
    classificationSource: suggested.classificationSource,
    classificationNotes: suggested.rationale,
  })

  return getOwnerMaintenanceWorkflowOverview({
    ticketId: ticket.id,
    organizationId: ticket.organization_id,
  })
}

async function deliverContractorQuoteRequest(input: {
  organizationId: string
  ticket: TicketContext
  contractor: ContractorSummary
  workflow: MaintenanceWorkflowRecord
  requestMessage: string
  expiresAt: string | null
}) {
  const providers = getAutomationProviderRegistry()
  const propertyLabel = input.ticket.tenants?.properties?.property_name ?? 'Property'
  const unitLabel = input.ticket.tenants?.properties?.unit_number ?? '-'
  const subject = `Quote Request: ${propertyLabel} ${unitLabel !== '-' ? `(${unitLabel})` : ''}`.trim()
  const summaryLines = [
    `Maintenance category: ${toSentenceCase(input.workflow.category)}`,
    `Urgency: ${toSentenceCase(input.workflow.urgency)}`,
    `Issue: ${input.ticket.subject}`,
    `Tenant message: ${input.ticket.message}`,
  ]

  if (input.contractor.email) {
    const emailResult = await providers.email.sendMessage({
      to: [input.contractor.email],
      subject,
      message: {
        preheader: 'New Prophives contractor quote request.',
        eyebrow: 'Contractor Quote Request',
        title: `Quote requested for ${propertyLabel}`,
        intro: [`Prophives is requesting a maintenance quote from ${input.contractor.company_name}.`],
        details: [
          { label: 'Property', value: propertyLabel },
          { label: 'Unit', value: unitLabel },
          { label: 'Category', value: toSentenceCase(input.workflow.category) },
          { label: 'Urgency', value: toSentenceCase(input.workflow.urgency), emphasize: input.workflow.urgency !== 'standard' },
          { label: 'Expires', value: input.expiresAt ? formatDateTime(input.expiresAt) : 'Open request' },
        ],
        body: [input.requestMessage, ...summaryLines],
        note: {
          title: 'How to respond',
          body: 'Reply through the Prophives operations team with your quote, availability, and scope of work.',
          tone: 'info',
        },
      },
    })

    return {
      channel: 'email' as const,
      status: emailResult.status,
      providerReference: emailResult.externalId ?? null,
    }
  }

  if (input.contractor.whatsapp) {
    const whatsappResult = await providers.whatsapp.sendTemplate({
      organizationId: input.organizationId,
      recipient: input.contractor.whatsapp,
      templateKey: 'maintenance_quote_request',
      variables: {
        contractor_name: input.contractor.company_name,
        property_name: propertyLabel,
        unit_number: unitLabel,
        category: input.workflow.category,
        urgency: input.workflow.urgency,
        subject: input.ticket.subject,
      },
      fallbackText: [subject, input.requestMessage, ...summaryLines].join('\n'),
    })

    return {
      channel: 'whatsapp' as const,
      status: whatsappResult.status,
      providerReference: whatsappResult.externalId ?? null,
    }
  }

  return {
    channel: 'internal' as const,
    status: 'skipped' as const,
    providerReference: null,
  }
}
export async function requestMaintenanceQuotes(input: {
  ticketId: string
  organizationId: string
  ownerId: string
  contractorIds?: string[]
  requestMessage?: string | null
  expiresAt?: string | null
}) {
  const overview = await getOwnerMaintenanceWorkflowOverview({
    ticketId: input.ticketId,
    organizationId: input.organizationId,
  })
  if (!overview) {
    throw new AppError('Ticket not found in organization', 404)
  }

  const workflowOverview = overview.workflow
  if (!workflowOverview) {
    throw new AppError('Start the maintenance workflow before requesting quotes', 400)
  }

  const contractorPool = input.contractorIds?.length
    ? overview.contractors.filter((contractor) => input.contractorIds?.includes(contractor.id) && contractor.is_active)
    : overview.relevant_contractors.slice(0, 3)

  if (contractorPool.length === 0) {
    throw new AppError('No matching contractors available for this maintenance category', 400)
  }

  const expiresAtIso = coerceIso(input.expiresAt ?? null)
  const requestMessage =
    normalizeString(input.requestMessage) ||
    `Please send your quote, availability, and scope of work for this ${toSentenceCase(workflowOverview.category)} issue.`

  for (const contractor of contractorPool) {
    const delivery = await deliverContractorQuoteRequest({
      organizationId: input.organizationId,
      ticket: overview.ticket,
      contractor,
      workflow: workflowOverview,
      requestMessage,
      expiresAt: expiresAtIso,
    })

    const { error } = await supabaseAdmin.from('contractor_quote_requests').upsert(
      {
        organization_id: input.organizationId,
        maintenance_workflow_id: workflowOverview.id,
        ticket_id: overview.ticket.id,
        contractor_id: contractor.id,
        request_channel: delivery.channel,
        status: 'requested',
        requested_at: new Date().toISOString(),
        expires_at: expiresAtIso,
        request_message: requestMessage,
        provider_reference: delivery.providerReference,
      },
      {
        onConflict: 'maintenance_workflow_id,contractor_id',
      },
    )
    throwIfError(error, 'Failed to create contractor quote request')
  }

  const { error: workflowError } = await supabaseAdmin
    .from('maintenance_workflows')
    .update({
      workflow_status: 'quote_collection',
      quote_requested_at: new Date().toISOString(),
    })
    .eq('id', workflowOverview.id)
    .eq('organization_id', input.organizationId)

  throwIfError(workflowError, 'Failed to update maintenance workflow quote collection state')

  await appendSystemTicketMessage({
    ticketId: overview.ticket.id,
    organizationId: overview.ticket.organization_id,
    message: `Quote requests were sent to ${contractorPool.length} contractor${contractorPool.length > 1 ? 's' : ''} for ${toSentenceCase(workflowOverview.category)} work.`,
  })
  await updateTicketStatusIfNeeded({
    ticketId: overview.ticket.id,
    organizationId: overview.ticket.organization_id,
    status: 'in_progress',
  })

  return getOwnerMaintenanceWorkflowOverview({
    ticketId: overview.ticket.id,
    organizationId: overview.ticket.organization_id,
  })
}

export async function recordContractorQuote(input: {
  ticketId: string
  organizationId: string
  ownerId: string
  contractorId: string
  quoteRequestId?: string | null
  amount: number
  currencyCode?: string | null
  scopeOfWork: string
  availabilityNote?: string | null
  estimatedStartAt?: string | null
  estimatedCompletionAt?: string | null
}) {
  const overview = await getOwnerMaintenanceWorkflowOverview({
    ticketId: input.ticketId,
    organizationId: input.organizationId,
  })
  if (!overview || !overview.workflow) {
    throw new AppError('Maintenance workflow not found for ticket', 404)
  }

  const contractor = overview.contractors.find((item) => item.id === input.contractorId)
  if (!contractor) {
    throw new AppError('Contractor not found in organization', 404)
  }

  const quoteRequestId =
    input.quoteRequestId ??
    overview.workflow.quote_requests.find((request) => request.contractor_id === input.contractorId)?.id ??
    null

  if (!quoteRequestId) {
    const { data: requestData, error: requestError } = await supabaseAdmin
      .from('contractor_quote_requests')
      .insert({
        organization_id: input.organizationId,
        maintenance_workflow_id: overview.workflow.id,
        ticket_id: overview.ticket.id,
        contractor_id: contractor.id,
        request_channel: 'internal',
        status: 'responded',
        requested_at: new Date().toISOString(),
        responded_at: new Date().toISOString(),
        request_message: 'Quote captured internally by Prophives operations.',
      })
      .select('id')
      .single()
    throwIfError(requestError, 'Failed to create internal quote request')
    input.quoteRequestId = (requestData?.id as string | undefined) ?? null
    if (!input.quoteRequestId) {
      throw new AppError('Failed to create internal quote request', 500)
    }
  }

  const currencyCode = normalizeString(input.currencyCode) || normalizeString(overview.ticket.organizations?.currency_code) || 'INR'
  const { error } = await supabaseAdmin
    .from('contractor_quotes')
    .insert({
      organization_id: input.organizationId,
      maintenance_workflow_id: overview.workflow.id,
      quote_request_id: input.quoteRequestId ?? null,
      contractor_id: contractor.id,
      amount: input.amount,
      currency_code: currencyCode,
      scope_of_work: input.scopeOfWork,
      availability_note: input.availabilityNote ?? null,
      estimated_start_at: coerceIso(input.estimatedStartAt ?? null),
      estimated_completion_at: coerceIso(input.estimatedCompletionAt ?? null),
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    })

  throwIfError(error, 'Failed to store contractor quote')

  const { error: requestError } = await supabaseAdmin
    .from('contractor_quote_requests')
    .update({
      status: 'responded',
      responded_at: new Date().toISOString(),
    })
    .eq('id', input.quoteRequestId ?? '')
    .eq('organization_id', input.organizationId)
  throwIfError(requestError, 'Failed to update quote request response state')

  const { error: workflowError } = await supabaseAdmin
    .from('maintenance_workflows')
    .update({ workflow_status: 'owner_review' })
    .eq('id', overview.workflow.id)
    .eq('organization_id', input.organizationId)
  throwIfError(workflowError, 'Failed to update maintenance workflow review state')

  await appendSystemTicketMessage({
    ticketId: overview.ticket.id,
    organizationId: overview.ticket.organization_id,
    message: `Quote received from ${contractor.company_name} for ${formatCurrency(input.amount, currencyCode)}.`,
  })

  await createOwnerNotification({
    organization_id: overview.ticket.organization_id,
    owner_id: overview.ticket.owner_id,
    tenant_id: overview.ticket.tenant_id,
    notification_type: 'maintenance_quote_received',
    title: `Quote received for ${overview.ticket.subject}`,
    message: `${contractor.company_name} quoted ${formatCurrency(input.amount, currencyCode)} for ${toSentenceCase(overview.workflow.category)} work.`,
  })

  return getOwnerMaintenanceWorkflowOverview({
    ticketId: overview.ticket.id,
    organizationId: overview.ticket.organization_id,
  })
}

export async function approveContractorQuote(input: {
  ticketId: string
  organizationId: string
  ownerId: string
  quoteId: string
  appointmentStartAt?: string | null
  appointmentEndAt?: string | null
  appointmentNotes?: string | null
}) {
  const overview = await getOwnerMaintenanceWorkflowOverview({
    ticketId: input.ticketId,
    organizationId: input.organizationId,
  })
  if (!overview || !overview.workflow) {
    throw new AppError('Maintenance workflow not found for ticket', 404)
  }

  const selectedQuote = overview.workflow.quotes.find((quote) => quote.id === input.quoteId)
  if (!selectedQuote) {
    throw new AppError('Quote not found for this workflow', 404)
  }
  if (!selectedQuote.contractor) {
    throw new AppError('Selected contractor not found', 404)
  }

  const { error: acceptError } = await supabaseAdmin
    .from('contractor_quotes')
    .update({ status: 'accepted' })
    .eq('id', selectedQuote.id)
    .eq('organization_id', input.organizationId)
  throwIfError(acceptError, 'Failed to accept contractor quote')

  const otherQuoteIds = overview.workflow.quotes
    .filter((quote) => quote.id !== selectedQuote.id && quote.status === 'submitted')
    .map((quote) => quote.id)
  if (otherQuoteIds.length > 0) {
    const { error: rejectError } = await supabaseAdmin
      .from('contractor_quotes')
      .update({ status: 'rejected' })
      .eq('organization_id', input.organizationId)
      .in('id', otherQuoteIds)
    throwIfError(rejectError, 'Failed to reject alternate quotes')
  }

  const appointmentStartAt = coerceIso(input.appointmentStartAt ?? null)
  const appointmentEndAt = coerceIso(input.appointmentEndAt ?? null)
  const bookingStatus: MaintenanceAssignmentStatus = appointmentStartAt ? 'scheduled' : 'approved'

  const { error: assignmentError } = await supabaseAdmin.from('maintenance_assignments').upsert(
    {
      organization_id: input.organizationId,
      maintenance_workflow_id: overview.workflow.id,
      ticket_id: overview.ticket.id,
      contractor_id: selectedQuote.contractor_id,
      quote_id: selectedQuote.id,
      approved_by_owner_id: input.ownerId,
      booking_status: bookingStatus,
      appointment_start_at: appointmentStartAt,
      appointment_end_at: appointmentEndAt,
      appointment_notes: input.appointmentNotes ?? null,
      follow_up_due_at: null,
      follow_up_alert_sent_at: null,
    },
    {
      onConflict: 'maintenance_workflow_id',
    },
  )
  throwIfError(assignmentError, 'Failed to create maintenance assignment')

  const { error: workflowError } = await supabaseAdmin
    .from('maintenance_workflows')
    .update({
      approved_quote_id: selectedQuote.id,
      approved_at: new Date().toISOString(),
      approved_by_owner_id: input.ownerId,
      workflow_status: appointmentStartAt ? 'scheduled' : 'assigned',
    })
    .eq('id', overview.workflow.id)
    .eq('organization_id', input.organizationId)
  throwIfError(workflowError, 'Failed to update approved contractor state')

  await appendSystemTicketMessage({
    ticketId: overview.ticket.id,
    organizationId: overview.ticket.organization_id,
    message: `Contractor approved: ${selectedQuote.contractor.company_name} for ${formatCurrency(
      selectedQuote.amount,
      selectedQuote.currency_code,
    )}.`,
  })

  if (appointmentStartAt) {
    await appendSystemTicketMessage({
      ticketId: overview.ticket.id,
      organizationId: overview.ticket.organization_id,
      message: `Contractor appointment scheduled for ${formatDateTime(appointmentStartAt)}.`,
    })
  }

  await updateTicketStatusIfNeeded({
    ticketId: overview.ticket.id,
    organizationId: overview.ticket.organization_id,
    status: 'in_progress',
  })

  return getOwnerMaintenanceWorkflowOverview({
    ticketId: overview.ticket.id,
    organizationId: overview.ticket.organization_id,
  })
}
function mapAssignmentStatusToWorkflowStatus(status: MaintenanceAssignmentStatus): MaintenanceWorkflowStatus {
  switch (status) {
    case 'approved':
      return 'assigned'
    case 'scheduled':
      return 'scheduled'
    case 'in_progress':
      return 'in_progress'
    case 'completed':
      return 'awaiting_tenant_confirmation'
    case 'tenant_confirmed':
      return 'completed'
    case 'cancelled':
      return 'cancelled'
    case 'follow_up_required':
      return 'in_progress'
    default:
      return 'in_progress'
  }
}

export async function updateMaintenanceAssignment(input: {
  ticketId: string
  organizationId: string
  ownerId: string
  bookingStatus: MaintenanceAssignmentStatus
  appointmentStartAt?: string | null
  appointmentEndAt?: string | null
  appointmentNotes?: string | null
  completionNotes?: string | null
  followUpHours?: number
}) {
  const overview = await getOwnerMaintenanceWorkflowOverview({
    ticketId: input.ticketId,
    organizationId: input.organizationId,
  })
  if (!overview || !overview.workflow || !overview.workflow.assignment) {
    throw new AppError('Maintenance assignment not found for this ticket', 404)
  }

  const assignment = overview.workflow.assignment
  const nowIso = new Date().toISOString()
  const appointmentStartAt = input.appointmentStartAt ? coerceIso(input.appointmentStartAt) : assignment.appointment_start_at
  const appointmentEndAt = input.appointmentEndAt ? coerceIso(input.appointmentEndAt) : assignment.appointment_end_at
  const completedAt = input.bookingStatus === 'completed' ? nowIso : assignment.completed_at
  const followUpHours = input.followUpHours ?? 48
  const followUpDueAt =
    input.bookingStatus === 'completed'
      ? new Date(Date.now() + followUpHours * 60 * 60 * 1000).toISOString()
      : assignment.follow_up_due_at

  const { error: assignmentError } = await supabaseAdmin
    .from('maintenance_assignments')
    .update({
      booking_status: input.bookingStatus,
      appointment_start_at: appointmentStartAt,
      appointment_end_at: appointmentEndAt,
      appointment_notes: input.appointmentNotes ?? assignment.appointment_notes,
      completion_notes: input.completionNotes ?? assignment.completion_notes,
      completed_at: completedAt,
      follow_up_due_at: followUpDueAt,
      follow_up_alert_sent_at: input.bookingStatus === 'completed' ? null : assignment.follow_up_alert_sent_at,
    })
    .eq('id', assignment.id)
    .eq('organization_id', input.organizationId)
  throwIfError(assignmentError, 'Failed to update maintenance assignment')

  const workflowStatus = mapAssignmentStatusToWorkflowStatus(input.bookingStatus)
  const { error: workflowError } = await supabaseAdmin
    .from('maintenance_workflows')
    .update({
      workflow_status: workflowStatus,
      follow_up_due_at: followUpDueAt,
      follow_up_alert_sent_at: input.bookingStatus === 'completed' ? null : overview.workflow.follow_up_alert_sent_at,
    })
    .eq('id', overview.workflow.id)
    .eq('organization_id', input.organizationId)
  throwIfError(workflowError, 'Failed to update maintenance workflow status')

  const messageByStatus: Record<MaintenanceAssignmentStatus, string> = {
    approved: 'The approved contractor assignment is now active.',
    scheduled: appointmentStartAt
      ? `Contractor appointment confirmed for ${formatDateTime(appointmentStartAt)}.`
      : 'Contractor appointment marked as scheduled.',
    in_progress: 'The contractor visit is now in progress.',
    completed: 'The contractor marked the job as completed and is awaiting tenant confirmation.',
    tenant_confirmed: 'The tenant confirmed the maintenance job is complete.',
    cancelled: 'The contractor assignment was cancelled.',
    follow_up_required: 'The maintenance job requires further follow-up.',
  }

  await appendSystemTicketMessage({
    ticketId: overview.ticket.id,
    organizationId: overview.ticket.organization_id,
    message: messageByStatus[input.bookingStatus],
  })

  if (input.bookingStatus === 'completed') {
    await updateTicketStatusIfNeeded({
      ticketId: overview.ticket.id,
      organizationId: overview.ticket.organization_id,
      status: 'resolved',
    })
  } else if (input.bookingStatus === 'scheduled' || input.bookingStatus === 'in_progress') {
    await updateTicketStatusIfNeeded({
      ticketId: overview.ticket.id,
      organizationId: overview.ticket.organization_id,
      status: 'in_progress',
    })
  }

  return {
    overview: await getOwnerMaintenanceWorkflowOverview({
      ticketId: overview.ticket.id,
      organizationId: overview.ticket.organization_id,
    }),
    shouldEnqueueFollowUp: input.bookingStatus === 'completed',
    followUpDueAt,
  }
}

export async function confirmTenantMaintenanceCompletion(input: {
  ticketId: string
  tenantId: string
  organizationId: string
  resolved: boolean
  feedbackRating?: number | null
  feedbackNote?: string | null
}) {
  const overview = await getTenantMaintenanceWorkflowOverview({
    ticketId: input.ticketId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  })
  if (!overview || !overview.workflow || !overview.workflow.assignment) {
    throw new AppError('Maintenance assignment not found for this ticket', 404)
  }

  const assignment = overview.workflow.assignment
  const bookingStatus: MaintenanceAssignmentStatus = input.resolved ? 'tenant_confirmed' : 'follow_up_required'
  const workflowStatus = input.resolved ? 'completed' : 'in_progress'
  const nowIso = new Date().toISOString()

  const { error: assignmentError } = await supabaseAdmin
    .from('maintenance_assignments')
    .update({
      booking_status: bookingStatus,
      tenant_confirmed_at: input.resolved ? nowIso : assignment.tenant_confirmed_at,
      tenant_feedback_rating: input.feedbackRating ?? null,
      tenant_feedback_note: input.feedbackNote ?? null,
    })
    .eq('id', assignment.id)
    .eq('organization_id', input.organizationId)
  throwIfError(assignmentError, 'Failed to record tenant maintenance confirmation')

  const { error: workflowError } = await supabaseAdmin
    .from('maintenance_workflows')
    .update({ workflow_status: workflowStatus })
    .eq('id', overview.workflow.id)
    .eq('organization_id', input.organizationId)
  throwIfError(workflowError, 'Failed to update workflow after tenant confirmation')

  await appendSystemTicketMessage({
    ticketId: overview.ticket.id,
    organizationId: overview.ticket.organization_id,
    message: input.resolved
      ? 'The tenant confirmed the contractor has resolved the issue.'
      : 'The tenant reported that the issue is still unresolved and needs follow-up.',
  })

  await updateTicketStatusIfNeeded({
    ticketId: overview.ticket.id,
    organizationId: overview.ticket.organization_id,
    status: input.resolved ? 'resolved' : 'in_progress',
  })

  return getTenantMaintenanceWorkflowOverview({
    ticketId: overview.ticket.id,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  })
}

export async function runMaintenanceFollowUpCheck(input: {
  workflowId: string
  organizationId: string
  ownerId: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const { data: workflowRow, error: workflowError } = await supabaseAdmin
    .from('maintenance_workflows')
    .select('ticket_id, follow_up_due_at, follow_up_alert_sent_at')
    .eq('id', input.workflowId)
    .eq('organization_id', input.organizationId)
    .maybeSingle()
  throwIfError(workflowError, 'Failed to load maintenance follow-up workflow')
  if (!workflowRow) {
    return { skipped: true, reason: 'workflow_not_found' }
  }

  const dueAt = (workflowRow as { follow_up_due_at?: string | null }).follow_up_due_at
  const sentAt = (workflowRow as { follow_up_alert_sent_at?: string | null }).follow_up_alert_sent_at
  if (!dueAt || sentAt) {
    return { skipped: true, reason: 'no_pending_follow_up' }
  }

  const dueDate = new Date(dueAt)
  if (Number.isNaN(dueDate.getTime()) || dueDate.getTime() > now.getTime()) {
    return { skipped: true, reason: 'follow_up_not_due' }
  }

  const ticket = await loadTicketContext({
    ticketId: (workflowRow as { ticket_id: string }).ticket_id,
    organizationId: input.organizationId,
  })
  if (!ticket) {
    return { skipped: true, reason: 'ticket_not_found' }
  }

  await createOwnerNotification({
    organization_id: input.organizationId,
    owner_id: input.ownerId,
    tenant_id: ticket.tenant_id,
    notification_type: 'maintenance_follow_up_required',
    title: `Maintenance follow-up needed for ${ticket.subject}`,
    message: `The assigned job is still awaiting tenant confirmation for ${ticket.tenants?.full_name ?? 'the tenant'}.`,
  })

  await deliverOwnerAutomationMessage({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    templateKey: 'maintenance_follow_up_required',
    templateVariables: {
      subject: ticket.subject,
      tenant_name: ticket.tenants?.full_name ?? 'Tenant',
      property_name: ticket.tenants?.properties?.property_name ?? 'Property',
      unit_number: ticket.tenants?.properties?.unit_number ?? '-',
      follow_up_due_at: dueAt,
    },
    email: {
      subject: `Maintenance follow-up required: ${ticket.subject}`,
      preheader: 'A contractor job is still waiting for tenant confirmation.',
      eyebrow: 'Maintenance Follow-up',
      title: `Follow-up needed for ${ticket.subject}`,
      intro: ['The maintenance job has not been confirmed by the tenant within the expected window.'],
      details: [
        { label: 'Tenant', value: ticket.tenants?.full_name ?? 'Tenant' },
        { label: 'Property', value: ticket.tenants?.properties?.property_name ?? 'Property' },
        { label: 'Unit', value: ticket.tenants?.properties?.unit_number ?? '-' },
        { label: 'Due for follow-up', value: formatDateTime(dueAt) },
      ],
      body: [
        'Please review the contractor outcome, confirm the tenant has been contacted, and reopen the assignment if the issue is still outstanding.',
      ],
    },
  })

  await appendSystemTicketMessage({
    ticketId: ticket.id,
    organizationId: ticket.organization_id,
    message: 'Prophives flagged this maintenance job for owner follow-up because tenant confirmation is still pending.',
  })

  const { error: workflowUpdateError } = await supabaseAdmin
    .from('maintenance_workflows')
    .update({ follow_up_alert_sent_at: now.toISOString() })
    .eq('id', input.workflowId)
    .eq('organization_id', input.organizationId)
  throwIfError(workflowUpdateError, 'Failed to mark maintenance follow-up alert as sent')

  const { error: assignmentUpdateError } = await supabaseAdmin
    .from('maintenance_assignments')
    .update({
      booking_status: 'follow_up_required',
      follow_up_alert_sent_at: now.toISOString(),
    })
    .eq('maintenance_workflow_id', input.workflowId)
    .eq('organization_id', input.organizationId)
  throwIfError(assignmentUpdateError, 'Failed to update maintenance assignment follow-up state')

  return {
    skipped: false,
    workflow_id: input.workflowId,
    ticket_id: ticket.id,
    owner_id: input.ownerId,
  }
}
