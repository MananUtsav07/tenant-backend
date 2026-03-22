import { z } from 'zod'

const nullableTrimmedString = z
  .string()
  .trim()
  .max(400)
  .transform((value) => (value.length ? value : null))
  .nullable()
  .optional()

const documentVerificationStatusSchema = z.enum(['pending', 'submitted', 'verified', 'failed', 'not_provided'])

export const createScreeningApplicantSchema = z.object({
  property_id: z.string().uuid().nullable().optional(),
  vacancy_campaign_id: z.string().uuid().nullable().optional(),
  vacancy_application_id: z.string().uuid().nullable().optional(),
  enquiry_source: z.enum(['manual_owner', 'manual_admin', 'listing', 'whatsapp', 'vacancy_campaign', 'webhook', 'other']).optional(),
  source_reference: nullableTrimmedString,
  applicant_name: z.string().trim().min(1).max(200),
  email: z.string().email().nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  employer: nullableTrimmedString,
  monthly_salary: z.coerce.number().nonnegative().nullable().optional(),
  current_residence: nullableTrimmedString,
  reason_for_moving: nullableTrimmedString,
  number_of_occupants: z.coerce.number().int().min(0).max(20).nullable().optional(),
  desired_move_in_date: z.string().date().nullable().optional(),
  target_rent_amount: z.coerce.number().nonnegative().nullable().optional(),
  identification_status: documentVerificationStatusSchema.optional(),
  employment_verification_status: documentVerificationStatusSchema.optional(),
})

export const updateScreeningApplicantSchema = z.object({
  property_id: z.string().uuid().nullable().optional(),
  vacancy_campaign_id: z.string().uuid().nullable().optional(),
  source_reference: nullableTrimmedString,
  applicant_name: z.string().trim().min(1).max(200).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  employer: nullableTrimmedString,
  monthly_salary: z.coerce.number().nonnegative().nullable().optional(),
  current_residence: nullableTrimmedString,
  reason_for_moving: nullableTrimmedString,
  number_of_occupants: z.coerce.number().int().min(0).max(20).nullable().optional(),
  desired_move_in_date: z.string().date().nullable().optional(),
  target_rent_amount: z.coerce.number().nonnegative().nullable().optional(),
  identification_status: documentVerificationStatusSchema.optional(),
  employment_verification_status: documentVerificationStatusSchema.optional(),
})

export const addScreeningDocumentSchema = z.object({
  document_type: z.enum(['emirates_id', 'salary_slip', 'employment_letter', 'passport', 'visa', 'other']),
  file_name: z.string().trim().min(1).max(200),
  storage_path: nullableTrimmedString,
  public_url: z.string().url().nullable().optional(),
  mime_type: z.string().trim().max(120).nullable().optional(),
  file_size_bytes: z.coerce.number().int().nonnegative().nullable().optional(),
  verification_status: documentVerificationStatusSchema.optional(),
  notes: nullableTrimmedString,
})

export const updateScreeningDecisionSchema = z.object({
  viewing_decision: z.enum(['pending', 'approved', 'rejected', 'scheduled']).optional(),
  final_disposition: z.enum(['in_review', 'rejected', 'viewing', 'lease_prep', 'withdrawn', 'approved']).optional(),
  owner_decision_notes: nullableTrimmedString,
})

export const screeningListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(50).default(12),
  recommendation_category: z.enum(['green', 'amber', 'red', 'unscored']).optional(),
  final_disposition: z.enum(['in_review', 'rejected', 'viewing', 'lease_prep', 'withdrawn', 'approved']).optional(),
})

export const adminCreateScreeningApplicantSchema = createScreeningApplicantSchema.extend({
  organization_id: z.string().uuid(),
  owner_id: z.string().uuid().nullable().optional(),
})

export const adminScreeningListQuerySchema = screeningListQuerySchema.extend({
  organization_id: z.string().uuid().optional(),
})
