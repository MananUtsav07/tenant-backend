import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/db.js'
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

function toISO(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

function toISODate(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null
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
  const data = await prisma.properties.findFirst({
    select: { id: true, organization_id: true, owner_id: true, property_name: true, address: true, unit_number: true },
    where: { organization_id: organizationId, id: propertyId },
  })
  return data as PropertyRow | null
}

async function loadOwnerContext(organizationId: string, ownerId: string) {
  const data = await prisma.owners.findFirst({
    select: { id: true, full_name: true, company_name: true, email: true },
    where: { organization_id: organizationId, id: ownerId },
  })
  return data as (OwnerRow & { id: string }) | null
}

async function loadVacancyCampaignContext(organizationId: string, campaignId: string) {
  const data = await prisma.vacancy_campaigns.findFirst({
    select: { id: true, organization_id: true, owner_id: true, property_id: true },
    where: { organization_id: organizationId, id: campaignId },
  })
  return data
}

async function loadVacancyApplicationContext(organizationId: string, applicationId: string) {
  const data = await prisma.vacancy_applications.findFirst({
    select: { id: true, organization_id: true, owner_id: true, property_id: true, vacancy_campaign_id: true, applicant_name: true, desired_move_in_date: true, monthly_salary: true, notes: true },
    where: { organization_id: organizationId, id: applicationId },
  })
  if (!data) return null
  return {
    ...data,
    desired_move_in_date: toISODate(data.desired_move_in_date as Date | null),
    monthly_salary: data.monthly_salary != null ? Number(data.monthly_salary) : null,
  } as VacancyApplicationContextRow
}

async function resolveDefaultTargetRent(organizationId: string, propertyId: string | null) {
  if (!propertyId) return null

  const row = await prisma.tenants.findFirst({
    select: { monthly_rent: true },
    where: { organization_id: organizationId, property_id: propertyId },
    orderBy: { created_at: 'desc' },
  })
  const value = row?.monthly_rent
  return value != null ? roundToTwo(Number(value)) : null
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
  await prisma.screening_events.create({
    data: {
      screening_applicant_id: input.applicantId,
      organization_id: input.organizationId,
      actor_role: input.actorRole,
      actor_owner_id: input.actorRole === 'owner' ? input.actorOwnerId ?? null : null,
      actor_admin_id: input.actorRole === 'admin' ? input.actorAdminId ?? null : null,
      event_type: input.eventType,
      title: input.title,
      message: input.message,
      metadata: (input.metadata ?? {}) as object,
    },
  })
}

async function upsertQuestionnaireAnswers(input: {
  organizationId: string
  applicantId: string
  questionnaire: ReturnType<typeof buildQuestionnairePayload>
}) {
  if (input.questionnaire.length === 0) return

  for (const answer of input.questionnaire) {
    await prisma.screening_questionnaire_answers.upsert({
      where: { screening_applicant_id_answer_key: { screening_applicant_id: input.applicantId, answer_key: answer.key } },
      create: {
        screening_applicant_id: input.applicantId,
        organization_id: input.organizationId,
        answer_key: answer.key,
        answer_label: answer.label,
        answer_value: answer.value,
        is_verified: answer.is_verified,
      },
      update: {
        answer_label: answer.label,
        answer_value: answer.value,
        is_verified: answer.is_verified,
        updated_at: new Date(),
      },
    })
  }
}

async function loadApplicantDocuments(applicantId: string, organizationId: string) {
  const data = await prisma.screening_documents.findMany({
    where: { organization_id: organizationId, screening_applicant_id: applicantId },
    orderBy: { created_at: 'desc' },
  })
  return data.map((row) => ({
    ...row,
    file_size_bytes: row.file_size_bytes != null ? Number(row.file_size_bytes) : null,
    created_at: toISO(row.created_at) ?? '',
    updated_at: toISO(row.updated_at) ?? '',
  })) as unknown as ScreeningDocumentRow[]
}

const applicantSelect = {
  id: true, organization_id: true, owner_id: true, property_id: true, vacancy_campaign_id: true,
  vacancy_application_id: true, enquiry_source: true, source_reference: true, applicant_name: true,
  email: true, phone: true, employer: true, monthly_salary: true, current_residence: true,
  reason_for_moving: true, number_of_occupants: true, desired_move_in_date: true, target_rent_amount: true,
  identification_status: true, employment_verification_status: true, affordability_ratio: true,
  recommendation_category: true, recommendation_summary: true, recommendation_reasons: true,
  recommendation_generated_at: true, ai_screening_status: true, viewing_decision: true,
  final_disposition: true, owner_decision_notes: true, created_at: true, updated_at: true,
  properties: { select: { id: true, organization_id: true, owner_id: true, property_name: true, address: true, unit_number: true } },
  owners: { select: { id: true, full_name: true, company_name: true, email: true } },
  organizations: { select: { name: true, slug: true } },
} as const

function serializeApplicantRow(row: Record<string, unknown>): ScreeningApplicantRow {
  return {
    ...(row as ScreeningApplicantRow),
    monthly_salary: row.monthly_salary != null ? Number(row.monthly_salary) : null,
    target_rent_amount: row.target_rent_amount != null ? Number(row.target_rent_amount) : null,
    affordability_ratio: row.affordability_ratio != null ? Number(row.affordability_ratio) : null,
    desired_move_in_date: toISODate(row.desired_move_in_date as Date | null),
    recommendation_generated_at: toISO(row.recommendation_generated_at as Date | null),
    created_at: toISO(row.created_at as Date) ?? '',
    updated_at: toISO(row.updated_at as Date) ?? '',
  }
}

async function loadApplicantDetailRow(input: {
  applicantId: string
  organizationId: string
  ownerId?: string
}) {
  const where: Record<string, unknown> = { organization_id: input.organizationId, id: input.applicantId }
  if (input.ownerId) where.owner_id = input.ownerId

  const data = await prisma.screening_applicants.findFirst({ select: applicantSelect, where })
  if (!data) return null
  return serializeApplicantRow(data as unknown as Record<string, unknown>)
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

  const [answers, documents, events] = await Promise.all([
    prisma.screening_questionnaire_answers.findMany({
      where: { organization_id: input.organizationId, screening_applicant_id: input.applicantId },
      orderBy: { created_at: 'asc' },
    }),
    loadApplicantDocuments(input.applicantId, input.organizationId),
    prisma.screening_events.findMany({
      where: { organization_id: input.organizationId, screening_applicant_id: input.applicantId },
      orderBy: { created_at: 'desc' },
    }),
  ])

  return {
    ...mapApplicantOverview(row),
    questionnaire_answers: answers.map((a) => ({ ...a, created_at: toISO(a.created_at) ?? '', updated_at: toISO(a.updated_at) ?? '' })) as unknown as ScreeningQuestionnaireAnswerRow[],
    documents,
    events: events.map((e) => ({ ...e, created_at: toISO(e.created_at) ?? '' })) as unknown as ScreeningEventRow[],
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

  await prisma.screening_applicants.update({
    where: { id: input.applicantId },
    data: {
      affordability_ratio: recommendation.ratio,
      recommendation_category: recommendation.category,
      recommendation_summary: recommendation.summary,
      recommendation_reasons: recommendation.reasons,
      recommendation_generated_at: new Date(),
      ai_screening_status: recommendation.aiStatus,
      updated_at: new Date(),
    },
  })

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

  const created = await prisma.screening_applicants.create({
    data: {
      ...insertPayload,
      desired_move_in_date: insertPayload.desired_move_in_date ? new Date(insertPayload.desired_move_in_date) : null,
    },
    select: { id: true },
  })

  await upsertQuestionnaireAnswers({
    organizationId: input.organizationId,
    applicantId: created.id,
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
    applicantId: created.id,
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
    applicantId: created.id,
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

  await prisma.screening_applicants.update({
    where: { id: input.applicantId },
    data: { ...updatePayload, updated_at: new Date() },
  })

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
  await prisma.screening_documents.create({
    data: {
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
    },
  })

  const applicantPatch: Record<string, unknown> = {}
  if (input.payload.document_type === ID_DOCUMENT_TYPE) {
    applicantPatch.identification_status = verificationStatus
  }
  if (EMPLOYMENT_DOCUMENT_TYPES.has(input.payload.document_type)) {
    applicantPatch.employment_verification_status = verificationStatus
  }

  if (Object.keys(applicantPatch).length > 0) {
    await prisma.screening_applicants.update({
      where: { id: input.applicantId },
      data: { ...applicantPatch, updated_at: new Date() },
    })
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

  await prisma.screening_applicants.update({
    where: { id: input.applicantId },
    data: { ...updatePayload, updated_at: new Date() },
  })

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
  const where: Record<string, unknown> = {}
  if (input.organizationId) where.organization_id = input.organizationId
  if (input.ownerId) where.owner_id = input.ownerId
  if (input.recommendationCategory) where.recommendation_category = input.recommendationCategory
  if (input.finalDisposition) where.final_disposition = input.finalDisposition

  return prisma.screening_applicants.count({ where })
}

async function listApplicantRows(input: {
  organizationId?: string
  ownerId?: string
  page: number
  pageSize: number
  recommendationCategory?: RecommendationCategory
  finalDisposition?: FinalDisposition
}) {
  const where: Record<string, unknown> = {}
  if (input.organizationId) where.organization_id = input.organizationId
  if (input.ownerId) where.owner_id = input.ownerId
  if (input.recommendationCategory) where.recommendation_category = input.recommendationCategory
  if (input.finalDisposition) where.final_disposition = input.finalDisposition

  const [rawRows, total] = await Promise.all([
    prisma.screening_applicants.findMany({
      select: applicantSelect,
      where,
      orderBy: { created_at: 'desc' },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.screening_applicants.count({ where }),
  ])

  return {
    rows: rawRows.map((r) => serializeApplicantRow(r as unknown as Record<string, unknown>)),
    total,
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
