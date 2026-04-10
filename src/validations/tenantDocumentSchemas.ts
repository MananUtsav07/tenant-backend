import { z } from 'zod'

const nullableTrimmedString = z
  .string()
  .trim()
  .max(400)
  .transform((value) => (value.length ? value : null))
  .nullable()
  .optional()

export const tenantDocumentTypeSchema = z.enum([
  'lease_agreement',
  'identification',
  'payment_proof',
  'kyc',
  'notice',
  'other',
])

export const tenantDocumentUploadUrlSchema = z.object({
  file_name: z.string().trim().min(1).max(200),
  mime_type: z.string().trim().max(120).nullable().optional(),
})

export const createTenantDocumentSchema = z.object({
  document_name: z.string().trim().min(1).max(200),
  document_type: tenantDocumentTypeSchema,
  file_name: z.string().trim().min(1).max(200),
  storage_path: nullableTrimmedString,
  public_url: z.string().url().nullable().optional(),
  mime_type: z.string().trim().max(120).nullable().optional(),
  file_size_bytes: z.coerce.number().int().nonnegative().nullable().optional(),
  notes: nullableTrimmedString,
})

export const updateTenantDocumentSchema = z.object({
  document_name: z.string().trim().min(1).max(200).optional(),
  document_type: tenantDocumentTypeSchema.optional(),
  file_name: z.string().trim().min(1).max(200).optional(),
  storage_path: nullableTrimmedString,
  public_url: z.string().url().nullable().optional(),
  mime_type: z.string().trim().max(120).nullable().optional(),
  file_size_bytes: z.coerce.number().int().nonnegative().nullable().optional(),
  notes: nullableTrimmedString,
})
