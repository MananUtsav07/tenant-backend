import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { getAutomationProviderRegistry } from './automation/providers/providerRegistry.js'

const EMPLOYMENT_DOCUMENT_TYPES = new Set(['salary_slip', 'employment_letter'])
const ID_DOCUMENT_TYPE = 'emirates_id'

type VerificationStatus = 'pending' | 'submitted' | 'verified' | 'failed' | 'not_provided'
type RecommendationCategory = 'green' | 'amber' | 'red' | 'unscored'
type ViewingDecision = 'pending' | 'approved' | 'rejected' | 'scheduled'
type FinalDisposition = 'in_review' | 'rejected' | 'viewing' | 'lease_prep' | 'withdrawn' | 'approved'
type EnquirySource = 'manual_owner' | 'manual_admin' | 'listing' | 'whatsapp' | 'vacancy_campaign' | 'webhook' | 'other'
type ActorRole = 'owner' | 'admin' | 'system'

type PropertyRow = {
  id: string
  organization_id: string
  owner_id: string
  property_name: string
  address: string
  unit_number: string | null
}

type OwnerRow = {
  id?: string
  full_name: string | null
  company_name: string | null
  email: string
}

type OrganizationRow = {
  name: string | null
  slug: string | null
}

type VacancyApplicationContextRow = {
  id: string
  organization_id: string
  owner_id: string
  property_id: string
  vacancy_campaign_id: string
  applicant_name: string
  desired_move_in_date: string | null
  monthly_salary: number | null
  notes: string | null
}

type ScreeningApplicantRow = {
  id: string
  organization_id: string
  owner_id: string
  property_id: string | null
  vacancy_campaign_id: string | null
  vacancy_application_id: string | null
  enquiry_source: EnquirySource
  source_reference: string | null
  applicant_name: string
  email: string | null
  phone: string | null
  employer: string | null
  monthly_salary: number | null
  current_residence: string | null
  reason_for_moving: string | null
  number_of_occupants: number | null
  desired_move_in_date: string | null
  target_rent_amount: number | null
  identification_status: VerificationStatus
  employment_verification_status: VerificationStatus
  affordability_ratio: number | null
  recommendation_category: RecommendationCategory
  recommendation_summary: string | null
  recommendation_reasons: string[] | null
  recommendation_generated_at: string | null
  ai_screening_status: 'not_requested' | 'skipped' | 'generated' | 'failed'
  viewing_decision: ViewingDecision
  final_disposition: FinalDisposition
  owner_decision_notes: string | null
  created_at: string
  updated_at: string
  properties?: PropertyRow | PropertyRow[] | null
  owners?: OwnerRow | OwnerRow[] | null
  organizations?: OrganizationRow | OrganizationRow[] | null
}

type ScreeningQuestionnaireAnswerRow = {
  id: string
  screening_applicant_id: string
  organization_id: string
  answer_key: string
  answer_label: string
  answer_value: string | null
  is_verified: boolean
  verification_notes: string | null
  created_at: string
  updated_at: string
}

type ScreeningDocumentRow = {
  id: string
  screening_applicant_id: string
  organization_id: string
  document_type: 'emirates_id' | 'salary_slip' | 'employment_letter' | 'passport' | 'visa' | 'other'
  file_name: string
  storage_path: string | null
  public_url: string | null
  mime_type: string | null
  file_size_bytes: number | null
  extraction_status: 'not_requested' | 'pending' | 'extracted' | 'failed' | 'manual'
  verification_status: VerificationStatus
  extracted_payload: Record<string, unknown> | null
  notes: string | null
  created_at: string
  updated_at: string
}

type ScreeningEventRow = {
  id: string
  screening_applicant_id: string
  organization_id: string
  actor_role: ActorRole
  actor_owner_id: string | null
  actor_admin_id: string | null
  event_type:
    | 'applicant_created'
    | 'questionnaire_updated'
    | 'document_added'
    | 'recommendation_generated'
    | 'viewing_decision_updated'
    | 'final_disposition_updated'
  title: string
  message: string
  metadata: Record<string, unknown> | null
  created_at: string
}

export type ScreeningQuestionnaireAnswer = ScreeningQuestionnaireAnswerRow
export type ScreeningDocument = ScreeningDocumentRow
export type ScreeningEvent = ScreeningEventRow

export type ScreeningApplicantOverview = Omit<ScreeningApplicantRow, 'properties' | 'owners' | 'organizations'> & {
  property: PropertyRow | null
  owner: OwnerRow | null
  organization: OrganizationRow | null
}

export type ScreeningApplicantDetail = ScreeningApplicantOverview & {
  questionnaire_answers: ScreeningQuestionnaireAnswer[]
  documents: ScreeningDocument[]
  events: ScreeningEvent[]
}

export type OwnerScreeningOverview = {
  summary: {
    total_applicants: number
    green_count: number
    amber_count: number
    red_count: number
    unscored_count: number
    in_review_count: number
    lease_prep_count: number
  }
  applicants: ScreeningApplicantOverview[]
  total: number
  page: number
  page_size: number
}

export type AdminScreeningOverview = {
  summary: OwnerScreeningOverview['summary']
  applicants: ScreeningApplicantOverview[]
  total: number
  page: number
  page_size: number
}

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

function asNullableString(value: string | null | undefined) {
  const normalized = value?.trim() ?? ''
  return normalized.length ? normalized : null
}

function roundToFour(value: number) {
  return Math.round(value * 10000) / 10000
}

function roundToTwo(value: number) {
  return Math.round(value * 100) / 100
}

function normalizeRelation<T>(value: T | T[] | null | undefined): T | null {
  if (!value) {
    return null
  }

  return Array.isArray(value) ? value[0] ?? null : value
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[]
  }

  return value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter((entry) => entry.length > 0)
}

function propertyLabel(property: PropertyRow | null) {
  if (!property) {
    return 'Selected property'
  }

  return property.unit_number ? `${property.property_name} (${property.unit_number})` : property.property_name
}

function ownerLabel(owner: OwnerRow | null) {
  return owner?.full_name || owner?.company_name || owner?.email || 'Owner'
}

function formatCurrencyValue(value: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return `${roundToTwo(value).toLocaleString('en-IN')}`
}

function buildQuestionnairePayload(input: {
  employer?: string | null
  monthly_salary?: number | null
  current_residence?: string | null
  reason_for_moving?: string | null
  number_of_occupants?: number | null
  desired_move_in_date?: string | null
  identification_status?: VerificationStatus
  employment_verification_status?: VerificationStatus
}) {
  return [
    { key: 'employer', label: 'Employer', value: asNullableString(input.employer), is_verified: input.employment_verification_status === 'verified' },
    {
      key: 'monthly_salary',
      label: 'Monthly Salary',
      value: typeof input.monthly_salary === 'number' ? String(roundToTwo(input.monthly_salary)) : null,
      is_verified: input.employment_verification_status === 'verified',
    },
    { key: 'current_residence', label: 'Current Residence', value: asNullableString(input.current_residence), is_verified: false },
    { key: 'reason_for_moving', label: 'Reason for Moving', value: asNullableString(input.reason_for_moving), is_verified: false },
    {
      key: 'number_of_occupants',
      label: 'Number of Occupants',
      value: typeof input.number_of_occupants === 'number' ? String(input.number_of_occupants) : null,
      is_verified: false,
    },
    { key: 'desired_move_in_date', label: 'Move-in Date', value: asNullableString(input.desired_move_in_date), is_verified: false },
    {
      key: 'identification_status',
      label: 'Identification Status',
      value: input.identification_status ?? null,
      is_verified: input.identification_status === 'verified',
    },
    {
      key: 'employment_verification_status',
      label: 'Employment Verification Status',
      value: input.employment_verification_status ?? null,
      is_verified: input.employment_verification_status === 'verified',
    },
  ].filter((entry) => entry.value !== null)
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

async function loadOwnerContext(organizationId: string, ownerId: string) {
  const { data, error } = await supabaseAdmin
    .from('owners')
    .select('id, full_name, company_name, email')
    .eq('organization_id', organizationId)
    .eq('id', ownerId)
    .maybeSingle()

  throwIfError(error, 'Failed to load owner context')
  return (data ?? null) as (OwnerRow & { id: string }) | null
}

async function loadVacancyCampaignContext(organizationId: string, campaignId: string) {
  const { data, error } = await supabaseAdmin
    .from('vacancy_campaigns')
    .select('id, organization_id, owner_id, property_id')
    .eq('organization_id', organizationId)
    .eq('id', campaignId)
    .maybeSingle()

  throwIfError(error, 'Failed to load vacancy campaign context')
  return data ?? null
}

async function loadVacancyApplicationContext(organizationId: string, applicationId: string) {
  const { data, error } = await supabaseAdmin
    .from('vacancy_applications')
    .select('id, organization_id, owner_id, property_id, vacancy_campaign_id, applicant_name, desired_move_in_date, monthly_salary, notes')
    .eq('organization_id', organizationId)
    .eq('id', applicationId)
    .maybeSingle()

  throwIfError(error, 'Failed to load vacancy application context')
  return (data ?? null) as VacancyApplicationContextRow | null
}

async function resolveDefaultTargetRent(organizationId: string, propertyId: string | null) {
  if (!propertyId) {
    return null
  }

  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('monthly_rent')
    .eq('organization_id', organizationId)
    .eq('property_id', propertyId)
    .order('created_at', { ascending: false })
    .limit(1)

  throwIfError(error, 'Failed to resolve default target rent')
  const value = data?.[0]?.monthly_rent
  return typeof value === 'number' ? roundToTwo(value) : null
}

async function createScreeningEvent(input: {
  organizationId: string
  applicantId: string
  actorRole: ActorRole
  actorOwnerId?: string | null
  actorAdminId?: string | null
  eventType: ScreeningEventRow['event_type']
  title: string
  message: string
  metadata?: Record<string, unknown>
}) {
  const { error } = await supabaseAdmin.from('screening_events').insert({
    screening_applicant_id: input.applicantId,
    organization_id: input.organizationId,
    actor_role: input.actorRole,
    actor_owner_id: input.actorRole === 'owner' ? input.actorOwnerId ?? null : null,
    actor_admin_id: input.actorRole === 'admin' ? input.actorAdminId ?? null : null,
    event_type: input.eventType,
    title: input.title,
    message: input.message,
    metadata: input.metadata ?? {},
  })

  throwIfError(error, 'Failed to create screening event')
}

async function upsertQuestionnaireAnswers(input: {
  organizationId: string
  applicantId: string
  questionnaire: ReturnType<typeof buildQuestionnairePayload>
}) {
  if (input.questionnaire.length === 0) {
    return
  }

  const { error } = await supabaseAdmin.from('screening_questionnaire_answers').upsert(
    input.questionnaire.map((answer) => ({
      screening_applicant_id: input.applicantId,
      organization_id: input.organizationId,
      answer_key: answer.key,
      answer_label: answer.label,
      answer_value: answer.value,
      is_verified: answer.is_verified,
    })),
    {
      onConflict: 'screening_applicant_id,answer_key',
    },
  )

  throwIfError(error, 'Failed to store screening questionnaire answers')
}

async function loadApplicantDocuments(applicantId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('screening_documents')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('screening_applicant_id', applicantId)
    .order('created_at', { ascending: false })

  throwIfError(error, 'Failed to load screening documents')
  return (data ?? []) as ScreeningDocumentRow[]
}

async function loadApplicantDetailRow(input: {
  applicantId: string
  organizationId: string
  ownerId?: string
}) {
  let request = supabaseAdmin
    .from('screening_applicants')
    .select(
      'id, organization_id, owner_id, property_id, vacancy_campaign_id, vacancy_application_id, enquiry_source, source_reference, applicant_name, email, phone, employer, monthly_salary, current_residence, reason_for_moving, number_of_occupants, desired_move_in_date, target_rent_amount, identification_status, employment_verification_status, affordability_ratio, recommendation_category, recommendation_summary, recommendation_reasons, recommendation_generated_at, ai_screening_status, viewing_decision, final_disposition, owner_decision_notes, created_at, updated_at, properties(id, organization_id, owner_id, property_name, address, unit_number), owners(id, full_name, company_name, email), organizations(name, slug)'
    )
    .eq('organization_id', input.organizationId)
    .eq('id', input.applicantId)

  if (input.ownerId) {
    request = request.eq('owner_id', input.ownerId)
  }

  const { data, error } = await request.maybeSingle()
  throwIfError(error, 'Failed to load screening applicant')
  return (data ?? null) as unknown as ScreeningApplicantRow | null
}

function mapApplicantOverview(row: ScreeningApplicantRow): ScreeningApplicantOverview {
  return {
    ...row,
    recommendation_reasons: parseStringArray(row.recommendation_reasons),
    property: normalizeRelation(row.properties),
    owner: normalizeRelation(row.owners),
    organization: normalizeRelation(row.organizations),
  }
}

async function loadApplicantDetail(input: {
  applicantId: string
  organizationId: string
  ownerId?: string
}) {
  const row = await loadApplicantDetailRow(input)
  if (!row) {
    return null
  }

  const [answersResult, documents, eventsResult] = await Promise.all([
    supabaseAdmin
      .from('screening_questionnaire_answers')
      .select('*')
      .eq('organization_id', input.organizationId)
      .eq('screening_applicant_id', input.applicantId)
      .order('created_at', { ascending: true }),
    loadApplicantDocuments(input.applicantId, input.organizationId),
    supabaseAdmin
      .from('screening_events')
      .select('*')
      .eq('organization_id', input.organizationId)
      .eq('screening_applicant_id', input.applicantId)
      .order('created_at', { ascending: false }),
  ])

  throwIfError(answersResult.error, 'Failed to load screening questionnaire answers')
  throwIfError(eventsResult.error, 'Failed to load screening events')

  return {
    ...mapApplicantOverview(row),
    questionnaire_answers: (answersResult.data ?? []) as ScreeningQuestionnaireAnswerRow[],
    documents,
    events: (eventsResult.data ?? []) as ScreeningEventRow[],
  } satisfies ScreeningApplicantDetail
}

function buildFallbackRecommendationSummary(input: {
  category: RecommendationCategory
  applicantName: string
  ratio: number | null
  reasons: string[]
}) {
  const ratioLabel = typeof input.ratio === 'number' ? `${roundToTwo(input.ratio * 100)}% rent-to-income` : 'affordability not fully established'
  const reasonLabel = input.reasons.slice(0, 2).join(' ')

  if (input.category === 'green') {
    return `${input.applicantName} is recommended based on a healthy ${ratioLabel} profile and verified core documents.`
  }

  if (input.category === 'amber') {
    return `${input.applicantName} needs owner review. Current position: ${ratioLabel}. ${reasonLabel}`.trim()
  }

  if (input.category === 'red') {
    return `${input.applicantName} is not recommended at this stage. Current position: ${ratioLabel}. ${reasonLabel}`.trim()
  }

  return `${input.applicantName} has not been fully scored yet. ${reasonLabel}`.trim()
}

async function maybeGenerateRecommendationSummary(input: {
  organizationId: string
  applicantName: string
  category: RecommendationCategory
  ratio: number | null
  reasons: string[]
  monthlySalary: number | null
  targetRentAmount: number | null
  identificationStatus: VerificationStatus
  employmentStatus: VerificationStatus
}) {
  const fallback = buildFallbackRecommendationSummary({
    category: input.category,
    applicantName: input.applicantName,
    ratio: input.ratio,
    reasons: input.reasons,
  })

  const aiProvider = getAutomationProviderRegistry().ai
  const aiResult = await aiProvider.generateText({
    organizationId: input.organizationId,
    systemPrompt:
      'You are Prophives screening support. Produce a short, professional owner-facing applicant recommendation summary. Do not invent verification. Keep it under 55 words.',
    prompt: [
      `Applicant: ${input.applicantName}`,
      `Recommendation: ${input.category}`,
      `Rent-to-income ratio: ${typeof input.ratio === 'number' ? roundToTwo(input.ratio * 100) : 'unknown'}%`,
      `Monthly salary: ${formatCurrencyValue(input.monthlySalary) ?? 'unknown'}`,
      `Target rent: ${formatCurrencyValue(input.targetRentAmount) ?? 'unknown'}`,
      `Identification status: ${input.identificationStatus}`,
      `Employment verification status: ${input.employmentStatus}`,
      `Reasons: ${input.reasons.join(' | ') || 'No material reasons supplied.'}`,
    ].join('\n'),
    metadata: {
      feature: 'tenant_screening_summary',
      recommendation_category: input.category,
    },
  })

  if (aiResult.status === 'generated' && aiResult.output?.trim()) {
    return {
      summary: aiResult.output.trim(),
      aiStatus: 'generated' as const,
    }
  }

  return {
    summary: fallback,
    aiStatus: aiResult.status === 'failed' ? ('failed' as const) : ('skipped' as const),
  }
}

async function computeRecommendation(input: {
  applicant: ScreeningApplicantRow
  documents: ScreeningDocumentRow[]
}) {
  const reasons: string[] = []
  const salary = typeof input.applicant.monthly_salary === 'number' ? input.applicant.monthly_salary : null
  const targetRent = typeof input.applicant.target_rent_amount === 'number' ? input.applicant.target_rent_amount : null
  const emiratesDocument = input.documents.find((document) => document.document_type === ID_DOCUMENT_TYPE) ?? null
  const employmentDocument = input.documents.find((document) => EMPLOYMENT_DOCUMENT_TYPES.has(document.document_type)) ?? null

  let category: RecommendationCategory = 'green'
  let ratio: number | null = null

  if (!salary || salary <= 0) {
    category = 'red'
    reasons.push('Monthly salary is missing or invalid, so affordability cannot be verified.')
  }

  if (!targetRent || targetRent <= 0) {
    if (category !== 'red') {
      category = 'amber'
    }
    reasons.push('Target rent is missing, so rent-to-income affordability should be reviewed manually.')
  }

  if (salary && salary > 0 && targetRent && targetRent > 0) {
    ratio = roundToFour(targetRent / salary)
    if (ratio > 0.4) {
      category = 'red'
      reasons.push('Rent exceeds 40% of declared monthly income.')
    } else if (ratio > 0.33 && category !== 'red') {
      category = 'amber'
      reasons.push('Rent exceeds the preferred 33% affordability threshold.')
    }
  }

  if (input.applicant.identification_status === 'failed') {
    category = 'red'
    reasons.push('Identification review has failed.')
  } else if (input.applicant.identification_status !== 'verified') {
    if (category !== 'red') {
      category = 'amber'
    }
    reasons.push('Identification is not yet verified.')
  }

  if (!emiratesDocument) {
    if (category !== 'red') {
      category = 'amber'
    }
    reasons.push('No Emirates ID document has been attached yet.')
  }

  if (input.applicant.employment_verification_status === 'failed') {
    category = 'red'
    reasons.push('Employment verification has failed.')
  } else if (input.applicant.employment_verification_status !== 'verified') {
    if (category !== 'red') {
      category = 'amber'
    }
    reasons.push('Employment is not yet verified.')
  }

  if (!employmentDocument) {
    if (category !== 'red') {
      category = 'amber'
    }
    reasons.push('Salary slip or employment proof is still missing.')
  }

  if ((input.applicant.number_of_occupants ?? 0) > 5 && category !== 'red') {
    category = 'amber'
    reasons.push('High occupant count should be reviewed against unit suitability.')
  }

  if (reasons.length === 0) {
    reasons.push('Affordability and verification checks are currently within preferred thresholds.')
  }

  const summaryResult = await maybeGenerateRecommendationSummary({
    organizationId: input.applicant.organization_id,
    applicantName: input.applicant.applicant_name,
    category,
    ratio,
    reasons,
    monthlySalary: salary,
    targetRentAmount: targetRent,
    identificationStatus: input.applicant.identification_status,
    employmentStatus: input.applicant.employment_verification_status,
  })

  return {
    category,
    ratio,
    reasons,
    summary: summaryResult.summary,
    aiStatus: summaryResult.aiStatus,
  }
}

export async function refreshScreeningRecommendation(input: {
  applicantId: string
  organizationId: string
  ownerId?: string
  actorRole?: ActorRole
  actorOwnerId?: string | null
  actorAdminId?: string | null
}) {
  const applicant = await loadApplicantDetailRow({
    applicantId: input.applicantId,
    organizationId: input.organizationId,
    ownerId: input.ownerId,
  })

  if (!applicant) {
    throw new AppError('Screening applicant not found', 404)
  }

  const documents = await loadApplicantDocuments(input.applicantId, input.organizationId)
  const recommendation = await computeRecommendation({
    applicant,
    documents,
  })

  const { error } = await supabaseAdmin
    .from('screening_applicants')
    .update({
      affordability_ratio: recommendation.ratio,
      recommendation_category: recommendation.category,
      recommendation_summary: recommendation.summary,
      recommendation_reasons: recommendation.reasons,
      recommendation_generated_at: new Date().toISOString(),
      ai_screening_status: recommendation.aiStatus,
    })
    .eq('organization_id', input.organizationId)
    .eq('id', input.applicantId)

  throwIfError(error, 'Failed to update screening recommendation')

  await createScreeningEvent({
    organizationId: input.organizationId,
    applicantId: input.applicantId,
    actorRole: input.actorRole ?? 'system',
    actorOwnerId: input.actorOwnerId ?? null,
    actorAdminId: input.actorAdminId ?? null,
    eventType: 'recommendation_generated',
    title: 'Recommendation refreshed',
    message: `${applicant.applicant_name} is currently rated ${recommendation.category}.`,
    metadata: {
      recommendation_category: recommendation.category,
      affordability_ratio: recommendation.ratio,
      reasons: recommendation.reasons,
    },
  })

  return getScreeningApplicantDetail({
    applicantId: input.applicantId,
    organizationId: input.organizationId,
    ownerId: input.ownerId,
  })
}

export async function createScreeningApplicant(input: {
  organizationId: string
  ownerId?: string
  actorRole: 'owner' | 'admin'
  actorOwnerId?: string | null
  actorAdminId?: string | null
  payload: {
    property_id?: string | null
    vacancy_campaign_id?: string | null
    vacancy_application_id?: string | null
    enquiry_source?: EnquirySource
    source_reference?: string | null
    applicant_name: string
    email?: string | null
    phone?: string | null
    employer?: string | null
    monthly_salary?: number | null
    current_residence?: string | null
    reason_for_moving?: string | null
    number_of_occupants?: number | null
    desired_move_in_date?: string | null
    target_rent_amount?: number | null
    identification_status?: VerificationStatus
    employment_verification_status?: VerificationStatus
  }
}) {
  let property = input.payload.property_id ? await loadPropertyContext(input.organizationId, input.payload.property_id) : null
  let vacancyCampaign = input.payload.vacancy_campaign_id
    ? await loadVacancyCampaignContext(input.organizationId, input.payload.vacancy_campaign_id)
    : null
  let vacancyApplication = input.payload.vacancy_application_id
    ? await loadVacancyApplicationContext(input.organizationId, input.payload.vacancy_application_id)
    : null

  if (input.payload.property_id && !property) {
    throw new AppError('Property not found in this organization', 404)
  }
  if (input.payload.vacancy_campaign_id && !vacancyCampaign) {
    throw new AppError('Vacancy campaign not found in this organization', 404)
  }
  if (input.payload.vacancy_application_id && !vacancyApplication) {
    throw new AppError('Vacancy application not found in this organization', 404)
  }

  if (!property && vacancyCampaign?.property_id) {
    property = await loadPropertyContext(input.organizationId, vacancyCampaign.property_id)
  }
  if (!property && vacancyApplication?.property_id) {
    property = await loadPropertyContext(input.organizationId, vacancyApplication.property_id)
  }
  if (!vacancyCampaign && vacancyApplication?.vacancy_campaign_id) {
    vacancyCampaign = await loadVacancyCampaignContext(input.organizationId, vacancyApplication.vacancy_campaign_id)
  }

  const resolvedOwnerId = input.ownerId ?? vacancyCampaign?.owner_id ?? vacancyApplication?.owner_id ?? property?.owner_id ?? null
  if (!resolvedOwnerId) {
    throw new AppError('Owner context is required to create a screening applicant', 400)
  }

  if (input.actorRole === 'owner' && input.actorOwnerId && resolvedOwnerId !== input.actorOwnerId) {
    throw new AppError('You can only create screening applicants for your own organization records', 403)
  }

  if (property && property.owner_id !== resolvedOwnerId) {
    throw new AppError('Property does not belong to the selected owner context', 400)
  }
  if (vacancyCampaign && vacancyCampaign.owner_id !== resolvedOwnerId) {
    throw new AppError('Vacancy campaign does not belong to the selected owner context', 400)
  }
  if (vacancyApplication && vacancyApplication.owner_id !== resolvedOwnerId) {
    throw new AppError('Vacancy application does not belong to the selected owner context', 400)
  }

  const owner = await loadOwnerContext(input.organizationId, resolvedOwnerId)
  if (!owner) {
    throw new AppError('Owner not found in this organization', 404)
  }

  const applicantName = input.payload.applicant_name?.trim() || vacancyApplication?.applicant_name?.trim() || null
  if (!applicantName) {
    throw new AppError('Applicant name is required', 400)
  }

  const targetRentAmount =
    input.payload.target_rent_amount ?? (await resolveDefaultTargetRent(input.organizationId, property?.id ?? null)) ?? null

  const insertPayload = {
    organization_id: input.organizationId,
    owner_id: resolvedOwnerId,
    property_id: property?.id ?? null,
    vacancy_campaign_id: vacancyCampaign?.id ?? null,
    vacancy_application_id: vacancyApplication?.id ?? null,
    enquiry_source:
      input.payload.enquiry_source ??
      (input.actorRole === 'admin' ? 'manual_admin' : vacancyApplication ? 'vacancy_campaign' : 'manual_owner'),
    source_reference: input.payload.source_reference ?? null,
    applicant_name: applicantName,
    email: input.payload.email ?? null,
    phone: input.payload.phone ?? null,
    employer: input.payload.employer ?? null,
    monthly_salary: input.payload.monthly_salary ?? vacancyApplication?.monthly_salary ?? null,
    current_residence: input.payload.current_residence ?? null,
    reason_for_moving: input.payload.reason_for_moving ?? vacancyApplication?.notes ?? null,
    number_of_occupants: input.payload.number_of_occupants ?? null,
    desired_move_in_date: input.payload.desired_move_in_date ?? vacancyApplication?.desired_move_in_date ?? null,
    target_rent_amount: targetRentAmount,
    identification_status: input.payload.identification_status ?? 'pending',
    employment_verification_status: input.payload.employment_verification_status ?? 'pending',
  }

  const { data, error } = await supabaseAdmin
    .from('screening_applicants')
    .insert(insertPayload)
    .select('id')
    .single()

  throwIfError(error, 'Failed to create screening applicant')
  if (!data?.id) {
    throw new AppError('Screening applicant id was not returned after creation', 500)
  }

  await upsertQuestionnaireAnswers({
    organizationId: input.organizationId,
    applicantId: data.id,
    questionnaire: buildQuestionnairePayload({
      employer: insertPayload.employer,
      monthly_salary: insertPayload.monthly_salary,
      current_residence: insertPayload.current_residence,
      reason_for_moving: insertPayload.reason_for_moving,
      number_of_occupants: insertPayload.number_of_occupants,
      desired_move_in_date: insertPayload.desired_move_in_date,
      identification_status: insertPayload.identification_status,
      employment_verification_status: insertPayload.employment_verification_status,
    }),
  })

  await createScreeningEvent({
    organizationId: input.organizationId,
    applicantId: data.id,
    actorRole: input.actorRole,
    actorOwnerId: input.actorOwnerId ?? resolvedOwnerId,
    actorAdminId: input.actorAdminId ?? null,
    eventType: 'applicant_created',
    title: 'Applicant intake created',
    message: `${applicantName} was added to the screening pipeline for ${propertyLabel(property)}.`,
    metadata: {
      enquiry_source: insertPayload.enquiry_source,
      owner: ownerLabel(owner),
      target_rent_amount: insertPayload.target_rent_amount,
    },
  })

  const detail = await refreshScreeningRecommendation({
    applicantId: data.id,
    organizationId: input.organizationId,
    ownerId: input.actorRole === 'owner' ? resolvedOwnerId : undefined,
    actorRole: input.actorRole,
    actorOwnerId: input.actorOwnerId ?? resolvedOwnerId,
    actorAdminId: input.actorAdminId ?? null,
  })

  if (!detail) {
    throw new AppError('Screening applicant not found after creation', 404)
  }

  return detail
}

export async function updateScreeningApplicant(input: {
  organizationId: string
  ownerId: string
  applicantId: string
  patch: {
    property_id?: string | null
    vacancy_campaign_id?: string | null
    source_reference?: string | null
    applicant_name?: string
    email?: string | null
    phone?: string | null
    employer?: string | null
    monthly_salary?: number | null
    current_residence?: string | null
    reason_for_moving?: string | null
    number_of_occupants?: number | null
    desired_move_in_date?: string | null
    target_rent_amount?: number | null
    identification_status?: VerificationStatus
    employment_verification_status?: VerificationStatus
  }
}) {
  const existing = await loadApplicantDetailRow({
    applicantId: input.applicantId,
    organizationId: input.organizationId,
    ownerId: input.ownerId,
  })
  if (!existing) {
    throw new AppError('Screening applicant not found in your organization', 404)
  }

  let propertyId = input.patch.property_id !== undefined ? input.patch.property_id : existing.property_id
  if (propertyId) {
    const property = await loadPropertyContext(input.organizationId, propertyId)
    if (!property || property.owner_id !== input.ownerId) {
      throw new AppError('Property not found in your organization', 404)
    }
  }

  let vacancyCampaignId = input.patch.vacancy_campaign_id !== undefined ? input.patch.vacancy_campaign_id : existing.vacancy_campaign_id
  if (vacancyCampaignId) {
    const campaign = await loadVacancyCampaignContext(input.organizationId, vacancyCampaignId)
    if (!campaign || campaign.owner_id !== input.ownerId) {
      throw new AppError('Vacancy campaign not found in your organization', 404)
    }
    propertyId = propertyId ?? campaign.property_id
  }

  const updatePayload: Record<string, unknown> = {
    property_id: propertyId,
    vacancy_campaign_id: vacancyCampaignId,
    source_reference: input.patch.source_reference ?? existing.source_reference,
  }

  for (const field of [
    'applicant_name',
    'email',
    'phone',
    'employer',
    'monthly_salary',
    'current_residence',
    'reason_for_moving',
    'number_of_occupants',
    'desired_move_in_date',
    'target_rent_amount',
    'identification_status',
    'employment_verification_status',
  ] as const) {
    if (field in input.patch) {
      updatePayload[field] = input.patch[field]
    }
  }

  const { error } = await supabaseAdmin
    .from('screening_applicants')
    .update(updatePayload)
    .eq('organization_id', input.organizationId)
    .eq('owner_id', input.ownerId)
    .eq('id', input.applicantId)

  throwIfError(error, 'Failed to update screening applicant')

  const merged = await loadApplicantDetailRow({
    applicantId: input.applicantId,
    organizationId: input.organizationId,
    ownerId: input.ownerId,
  })
  if (!merged) {
    throw new AppError('Screening applicant not found after update', 404)
  }

  await upsertQuestionnaireAnswers({
    organizationId: input.organizationId,
    applicantId: input.applicantId,
    questionnaire: buildQuestionnairePayload({
      employer: merged.employer,
      monthly_salary: merged.monthly_salary,
      current_residence: merged.current_residence,
      reason_for_moving: merged.reason_for_moving,
      number_of_occupants: merged.number_of_occupants,
      desired_move_in_date: merged.desired_move_in_date,
      identification_status: merged.identification_status,
      employment_verification_status: merged.employment_verification_status,
    }),
  })

  await createScreeningEvent({
    organizationId: input.organizationId,
    applicantId: input.applicantId,
    actorRole: 'owner',
    actorOwnerId: input.ownerId,
    eventType: 'questionnaire_updated',
    title: 'Questionnaire updated',
    message: `${merged.applicant_name}'s screening details were updated by the owner.`,
    metadata: updatePayload,
  })

  const detail = await refreshScreeningRecommendation({
    applicantId: input.applicantId,
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    actorRole: 'owner',
    actorOwnerId: input.ownerId,
  })

  if (!detail) {
    throw new AppError('Screening applicant not found after scoring refresh', 404)
  }

  return detail
}

export async function addScreeningDocument(input: {
  organizationId: string
  ownerId: string
  applicantId: string
  payload: {
    document_type: ScreeningDocumentRow['document_type']
    file_name: string
    storage_path?: string | null
    public_url?: string | null
    mime_type?: string | null
    file_size_bytes?: number | null
    verification_status?: VerificationStatus
    notes?: string | null
  }
}) {
  const applicant = await loadApplicantDetailRow({
    applicantId: input.applicantId,
    organizationId: input.organizationId,
    ownerId: input.ownerId,
  })
  if (!applicant) {
    throw new AppError('Screening applicant not found in your organization', 404)
  }

  const verificationStatus = input.payload.verification_status ?? 'submitted'
  const { error } = await supabaseAdmin.from('screening_documents').insert({
    screening_applicant_id: input.applicantId,
    organization_id: input.organizationId,
    document_type: input.payload.document_type,
    file_name: input.payload.file_name,
    storage_path: input.payload.storage_path ?? null,
    public_url: input.payload.public_url ?? null,
    mime_type: input.payload.mime_type ?? null,
    file_size_bytes: input.payload.file_size_bytes ?? null,
    verification_status: verificationStatus,
    extraction_status: 'not_requested',
    notes: input.payload.notes ?? null,
  })

  throwIfError(error, 'Failed to attach screening document')

  const applicantPatch: Record<string, unknown> = {}
  if (input.payload.document_type === ID_DOCUMENT_TYPE) {
    applicantPatch.identification_status = verificationStatus
  }
  if (EMPLOYMENT_DOCUMENT_TYPES.has(input.payload.document_type)) {
    applicantPatch.employment_verification_status = verificationStatus
  }

  if (Object.keys(applicantPatch).length > 0) {
    const { error: applicantError } = await supabaseAdmin
      .from('screening_applicants')
      .update(applicantPatch)
      .eq('organization_id', input.organizationId)
      .eq('owner_id', input.ownerId)
      .eq('id', input.applicantId)

    throwIfError(applicantError, 'Failed to sync screening applicant verification status')
  }

  await createScreeningEvent({
    organizationId: input.organizationId,
    applicantId: input.applicantId,
    actorRole: 'owner',
    actorOwnerId: input.ownerId,
    eventType: 'document_added',
    title: 'Document attached',
    message: `${input.payload.file_name} was added to ${applicant.applicant_name}'s screening record.`,
    metadata: {
      document_type: input.payload.document_type,
      verification_status: verificationStatus,
    },
  })

  const detail = await refreshScreeningRecommendation({
    applicantId: input.applicantId,
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    actorRole: 'owner',
    actorOwnerId: input.ownerId,
  })

  if (!detail) {
    throw new AppError('Screening applicant not found after document upload', 404)
  }

  return detail
}

export async function updateScreeningDecision(input: {
  organizationId: string
  ownerId: string
  applicantId: string
  patch: {
    viewing_decision?: ViewingDecision
    final_disposition?: FinalDisposition
    owner_decision_notes?: string | null
  }
}) {
  const existing = await loadApplicantDetailRow({
    applicantId: input.applicantId,
    organizationId: input.organizationId,
    ownerId: input.ownerId,
  })
  if (!existing) {
    throw new AppError('Screening applicant not found in your organization', 404)
  }

  const updatePayload: Record<string, unknown> = {}
  if (input.patch.viewing_decision !== undefined) {
    updatePayload.viewing_decision = input.patch.viewing_decision
  }
  if (input.patch.final_disposition !== undefined) {
    updatePayload.final_disposition = input.patch.final_disposition
  }
  if ('owner_decision_notes' in input.patch) {
    updatePayload.owner_decision_notes = input.patch.owner_decision_notes ?? null
  }

  const { error } = await supabaseAdmin
    .from('screening_applicants')
    .update(updatePayload)
    .eq('organization_id', input.organizationId)
    .eq('owner_id', input.ownerId)
    .eq('id', input.applicantId)

  throwIfError(error, 'Failed to update screening decision')

  if (input.patch.viewing_decision && input.patch.viewing_decision !== existing.viewing_decision) {
    await createScreeningEvent({
      organizationId: input.organizationId,
      applicantId: input.applicantId,
      actorRole: 'owner',
      actorOwnerId: input.ownerId,
      eventType: 'viewing_decision_updated',
      title: 'Viewing decision updated',
      message: `${existing.applicant_name} is now marked ${input.patch.viewing_decision} for the viewing step.`,
      metadata: {
        from: existing.viewing_decision,
        to: input.patch.viewing_decision,
      },
    })
  }

  if (input.patch.final_disposition && input.patch.final_disposition !== existing.final_disposition) {
    await createScreeningEvent({
      organizationId: input.organizationId,
      applicantId: input.applicantId,
      actorRole: 'owner',
      actorOwnerId: input.ownerId,
      eventType: 'final_disposition_updated',
      title: 'Disposition updated',
      message: `${existing.applicant_name} moved to ${input.patch.final_disposition.replaceAll('_', ' ')}.`,
      metadata: {
        from: existing.final_disposition,
        to: input.patch.final_disposition,
        notes: input.patch.owner_decision_notes ?? null,
      },
    })
  }

  const detail = await getScreeningApplicantDetail({
    applicantId: input.applicantId,
    organizationId: input.organizationId,
    ownerId: input.ownerId,
  })

  if (!detail) {
    throw new AppError('Screening applicant not found after decision update', 404)
  }

  return detail
}

async function countApplicants(input: {
  organizationId?: string
  ownerId?: string
  recommendationCategory?: RecommendationCategory
  finalDisposition?: FinalDisposition
}) {
  let request = supabaseAdmin.from('screening_applicants').select('id', { count: 'exact', head: true })

  if (input.organizationId) {
    request = request.eq('organization_id', input.organizationId)
  }
  if (input.ownerId) {
    request = request.eq('owner_id', input.ownerId)
  }
  if (input.recommendationCategory) {
    request = request.eq('recommendation_category', input.recommendationCategory)
  }
  if (input.finalDisposition) {
    request = request.eq('final_disposition', input.finalDisposition)
  }

  const { count, error } = await request
  throwIfError(error, 'Failed to count screening applicants')
  return count ?? 0
}

async function listApplicantRows(input: {
  organizationId?: string
  ownerId?: string
  page: number
  pageSize: number
  recommendationCategory?: RecommendationCategory
  finalDisposition?: FinalDisposition
}) {
  const from = (input.page - 1) * input.pageSize
  const to = from + input.pageSize - 1

  let request = supabaseAdmin
    .from('screening_applicants')
    .select(
      'id, organization_id, owner_id, property_id, vacancy_campaign_id, vacancy_application_id, enquiry_source, source_reference, applicant_name, email, phone, employer, monthly_salary, current_residence, reason_for_moving, number_of_occupants, desired_move_in_date, target_rent_amount, identification_status, employment_verification_status, affordability_ratio, recommendation_category, recommendation_summary, recommendation_reasons, recommendation_generated_at, ai_screening_status, viewing_decision, final_disposition, owner_decision_notes, created_at, updated_at, properties(id, organization_id, owner_id, property_name, address, unit_number), owners(id, full_name, company_name, email), organizations(name, slug)',
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(from, to)

  if (input.organizationId) {
    request = request.eq('organization_id', input.organizationId)
  }
  if (input.ownerId) {
    request = request.eq('owner_id', input.ownerId)
  }
  if (input.recommendationCategory) {
    request = request.eq('recommendation_category', input.recommendationCategory)
  }
  if (input.finalDisposition) {
    request = request.eq('final_disposition', input.finalDisposition)
  }

  const { data, error, count } = await request
  throwIfError(error, 'Failed to list screening applicants')

  return {
    rows: (data ?? []) as unknown as ScreeningApplicantRow[],
    total: count ?? 0,
  }
}

export async function getOwnerScreeningOverview(input: {
  organizationId: string
  ownerId: string
  page: number
  pageSize: number
  recommendationCategory?: RecommendationCategory
  finalDisposition?: FinalDisposition
}): Promise<OwnerScreeningOverview> {
  const [{ rows, total }, greenCount, amberCount, redCount, unscoredCount, inReviewCount, leasePrepCount] = await Promise.all([
    listApplicantRows({
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      page: input.page,
      pageSize: input.pageSize,
      recommendationCategory: input.recommendationCategory,
      finalDisposition: input.finalDisposition,
    }),
    countApplicants({ organizationId: input.organizationId, ownerId: input.ownerId, recommendationCategory: 'green' }),
    countApplicants({ organizationId: input.organizationId, ownerId: input.ownerId, recommendationCategory: 'amber' }),
    countApplicants({ organizationId: input.organizationId, ownerId: input.ownerId, recommendationCategory: 'red' }),
    countApplicants({ organizationId: input.organizationId, ownerId: input.ownerId, recommendationCategory: 'unscored' }),
    countApplicants({ organizationId: input.organizationId, ownerId: input.ownerId, finalDisposition: 'in_review' }),
    countApplicants({ organizationId: input.organizationId, ownerId: input.ownerId, finalDisposition: 'lease_prep' }),
  ])

  return {
    summary: {
      total_applicants: greenCount + amberCount + redCount + unscoredCount,
      green_count: greenCount,
      amber_count: amberCount,
      red_count: redCount,
      unscored_count: unscoredCount,
      in_review_count: inReviewCount,
      lease_prep_count: leasePrepCount,
    },
    applicants: rows.map(mapApplicantOverview),
    total,
    page: input.page,
    page_size: input.pageSize,
  }
}

export async function getAdminScreeningOverview(input: {
  organizationId?: string
  page: number
  pageSize: number
  recommendationCategory?: RecommendationCategory
  finalDisposition?: FinalDisposition
}): Promise<AdminScreeningOverview> {
  const [{ rows, total }, greenCount, amberCount, redCount, unscoredCount, inReviewCount, leasePrepCount] = await Promise.all([
    listApplicantRows({
      organizationId: input.organizationId,
      page: input.page,
      pageSize: input.pageSize,
      recommendationCategory: input.recommendationCategory,
      finalDisposition: input.finalDisposition,
    }),
    countApplicants({ organizationId: input.organizationId, recommendationCategory: 'green' }),
    countApplicants({ organizationId: input.organizationId, recommendationCategory: 'amber' }),
    countApplicants({ organizationId: input.organizationId, recommendationCategory: 'red' }),
    countApplicants({ organizationId: input.organizationId, recommendationCategory: 'unscored' }),
    countApplicants({ organizationId: input.organizationId, finalDisposition: 'in_review' }),
    countApplicants({ organizationId: input.organizationId, finalDisposition: 'lease_prep' }),
  ])

  return {
    summary: {
      total_applicants: greenCount + amberCount + redCount + unscoredCount,
      green_count: greenCount,
      amber_count: amberCount,
      red_count: redCount,
      unscored_count: unscoredCount,
      in_review_count: inReviewCount,
      lease_prep_count: leasePrepCount,
    },
    applicants: rows.map(mapApplicantOverview),
    total,
    page: input.page,
    page_size: input.pageSize,
  }
}

export async function getScreeningApplicantDetail(input: {
  applicantId: string
  organizationId: string
  ownerId?: string
}) {
  return loadApplicantDetail(input)
}
