import { z } from 'zod'

const optionalTrimmedString = z.preprocess(
  (value) => {
    if (typeof value !== 'string') {
      return value
    }

    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  },
  z.string().max(3000).optional(),
)

const optionalContactField = z.preprocess(
  (value) => {
    if (typeof value !== 'string') {
      return value
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  },
  z.string().max(255).optional(),
)

const maintenanceCategoryEnum = z.enum([
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
])

const maintenanceUrgencyEnum = z.enum(['emergency', 'urgent', 'standard'])
const assignmentStatusEnum = z.enum([
  'approved',
  'scheduled',
  'in_progress',
  'completed',
  'tenant_confirmed',
  'cancelled',
  'follow_up_required',
])

export const createContractorSchema = z.object({
  company_name: z.string().trim().min(1).max(160),
  contact_name: optionalContactField,
  email: optionalContactField,
  phone: optionalContactField,
  whatsapp: optionalContactField,
  notes: optionalTrimmedString,
  specialties: z.array(maintenanceCategoryEnum).min(1).max(6),
})

export const updateContractorSchema = z
  .object({
    company_name: z.string().trim().min(1).max(160).optional(),
    contact_name: optionalContactField,
    email: optionalContactField,
    phone: optionalContactField,
    whatsapp: optionalContactField,
    notes: optionalTrimmedString,
    specialties: z.array(maintenanceCategoryEnum).min(1).max(6).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one contractor field must be provided',
  })

export const triageMaintenanceWorkflowSchema = z.object({
  category: maintenanceCategoryEnum.optional(),
  urgency: maintenanceUrgencyEnum.optional(),
  classification_notes: optionalTrimmedString,
})

export const requestMaintenanceQuotesSchema = z.object({
  contractor_ids: z.array(z.string().uuid()).min(1).max(6).optional(),
  request_message: optionalTrimmedString,
  expires_at: optionalContactField,
})

export const recordContractorQuoteSchema = z.object({
  contractor_id: z.string().uuid(),
  quote_request_id: z.string().uuid().optional(),
  amount: z.coerce.number().positive(),
  currency_code: optionalContactField,
  scope_of_work: z.string().trim().min(1).max(2000),
  availability_note: optionalTrimmedString,
  estimated_start_at: optionalContactField,
  estimated_completion_at: optionalContactField,
})

export const approveContractorQuoteSchema = z.object({
  appointment_start_at: optionalContactField,
  appointment_end_at: optionalContactField,
  appointment_notes: optionalTrimmedString,
})

export const updateMaintenanceAssignmentSchema = z.object({
  booking_status: assignmentStatusEnum,
  appointment_start_at: optionalContactField,
  appointment_end_at: optionalContactField,
  appointment_notes: optionalTrimmedString,
  completion_notes: optionalTrimmedString,
})

export const tenantMaintenanceCompletionSchema = z.object({
  resolved: z.boolean(),
  feedback_rating: z.coerce.number().int().min(1).max(5).optional(),
  feedback_note: optionalTrimmedString,
})
