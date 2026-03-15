import { z } from 'zod'

const vacancySourceEnum = z.enum(['tenant_notice', 'lease_expiry', 'manual'])
const vacancyStateEnum = z.enum(['pre_vacant', 'vacant', 'relisting_in_progress'])
const vacancyCampaignStatusEnum = z.enum(['owner_review', 'approved', 'relisting_in_progress', 'listed', 'leased', 'cancelled'])

export const upsertVacancyCampaignSchema = z
  .object({
    source_type: vacancySourceEnum.optional().default('manual'),
    expected_vacancy_date: z.string().date(),
    vacancy_state: vacancyStateEnum.optional(),
    trigger_notes: z.string().trim().max(1200).nullable().optional(),
    actual_vacancy_date: z.string().date().nullable().optional(),
  })
  .strict()

export const updateVacancyCampaignDraftSchema = z
  .object({
    listing_title: z.string().trim().min(1).max(200).optional(),
    listing_description: z.string().trim().min(1).max(4000).optional(),
    listing_features: z.array(z.string().trim().min(1).max(160)).max(16).optional(),
    availability_label: z.string().trim().min(1).max(160).nullable().optional(),
    expected_vacancy_date: z.string().date().optional(),
    vacancy_state: vacancyStateEnum.optional(),
    trigger_notes: z.string().trim().max(1200).nullable().optional(),
  })
  .strict()

export const approveVacancyCampaignSchema = z
  .object({
    listing_title: z.string().trim().min(1).max(200).optional(),
    listing_description: z.string().trim().min(1).max(4000).optional(),
    listing_features: z.array(z.string().trim().min(1).max(160)).max(16).optional(),
    availability_label: z.string().trim().min(1).max(160).nullable().optional(),
  })
  .strict()

export const createVacancyLeadSchema = z
  .object({
    full_name: z.string().trim().min(1).max(200),
    email: z.string().email().nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
    source: z.string().trim().min(1).max(80).optional().default('internal'),
    status: z.enum(['new', 'qualified', 'viewing_scheduled', 'application_submitted', 'inactive']).optional().default('new'),
    notes: z.string().trim().max(1200).nullable().optional(),
  })
  .strict()

export const createVacancyViewingSchema = z
  .object({
    lead_id: z.string().uuid().nullable().optional(),
    scheduled_start_at: z.string().datetime(),
    scheduled_end_at: z.string().datetime().nullable().optional(),
    booking_status: z.enum(['scheduled', 'completed', 'cancelled', 'no_show']).optional().default('scheduled'),
    notes: z.string().trim().max(1200).nullable().optional(),
  })
  .strict()

export const createVacancyApplicationSchema = z
  .object({
    lead_id: z.string().uuid().nullable().optional(),
    applicant_name: z.string().trim().min(1).max(200),
    desired_move_in_date: z.string().date().nullable().optional(),
    monthly_salary: z.coerce.number().nonnegative().nullable().optional(),
    status: z.enum(['submitted', 'under_review', 'approved', 'rejected']).optional().default('submitted'),
    notes: z.string().trim().max(1600).nullable().optional(),
  })
  .strict()

export const adminAutomationVacancyCampaignQuerySchema = z.object({
  organization_id: z.string().uuid().optional(),
})

export { vacancyCampaignStatusEnum, vacancySourceEnum, vacancyStateEnum }
