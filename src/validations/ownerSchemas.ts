import { z } from 'zod'

export const createPropertySchema = z.object({
  property_name: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(400),
  unit_number: z.string().trim().max(50).optional(),
})

export const updatePropertySchema = z.object({
  property_name: z.string().trim().min(1).max(200).optional(),
  address: z.string().trim().min(1).max(400).optional(),
  unit_number: z.string().trim().max(50).nullable().optional(),
})

export const createTenantSchema = z.object({
  property_id: z.string().uuid(),
  broker_id: z.string().uuid().optional(),
  full_name: z.string().trim().min(1).max(200),
  email: z.string().email().optional(),
  phone: z.string().trim().max(30).optional(),
  password: z.string().min(8),
  lease_start_date: z.string().date().optional(),
  lease_end_date: z.string().date().optional(),
  monthly_rent: z.coerce.number().nonnegative().default(0),
  payment_due_day: z.coerce.number().int().min(1).max(31).default(1),
  payment_status: z.enum(['pending', 'paid', 'overdue', 'partial']).optional(),
  status: z.enum(['active', 'inactive', 'terminated']).optional(),
})

export const updateTenantSchema = z.object({
  property_id: z.string().uuid().optional(),
  broker_id: z.string().uuid().nullable().optional(),
  full_name: z.string().trim().min(1).max(200).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  password: z.string().min(8).optional(),
  lease_start_date: z.string().date().nullable().optional(),
  lease_end_date: z.string().date().nullable().optional(),
  monthly_rent: z.coerce.number().nonnegative().optional(),
  payment_due_day: z.coerce.number().int().min(1).max(31).optional(),
  payment_status: z.enum(['pending', 'paid', 'overdue', 'partial']).optional(),
  status: z.enum(['active', 'inactive', 'terminated']).optional(),
})

export const updateTicketStatusSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']),
})
