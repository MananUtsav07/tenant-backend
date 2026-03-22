import { z } from 'zod'

export const adminLoginSchema = z.object({
  email: z.string().trim().email().transform((value) => value.toLowerCase()),
  password: z.string().min(1),
})

const baseListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(10),
  search: z.string().trim().max(120).optional(),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
  organization_id: z.string().uuid().optional(),
})

export const adminOwnerListQuerySchema = baseListQuerySchema.extend({
  sort_by: z.enum(['created_at', 'email', 'full_name', 'company_name']).default('created_at'),
})

export const adminTenantListQuerySchema = baseListQuerySchema.extend({
  sort_by: z.enum(['created_at', 'full_name', 'payment_status', 'status']).default('created_at'),
})

export const adminPropertyListQuerySchema = baseListQuerySchema.extend({
  sort_by: z.enum(['created_at', 'property_name', 'address']).default('created_at'),
})

export const adminTicketListQuerySchema = baseListQuerySchema.extend({
  sort_by: z.enum(['created_at', 'status', 'subject']).default('created_at'),
})

export const adminContactMessageListQuerySchema = baseListQuerySchema.extend({
  sort_by: z.enum(['created_at', 'name', 'email']).default('created_at'),
})

export const adminAnalyticsListQuerySchema = baseListQuerySchema.extend({
  sort_by: z.enum(['created_at', 'event_name', 'user_type']).default('created_at'),
  days: z.coerce.number().int().min(1).max(365).default(30),
})

export const adminOrganizationListQuerySchema = baseListQuerySchema.extend({
  sort_by: z.enum(['created_at', 'name', 'slug', 'plan_code']).default('created_at'),
})
