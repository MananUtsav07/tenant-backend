import { z } from 'zod'

export const EXPENSE_CATEGORIES = [
  'maintenance',
  'insurance',
  'legal',
  'agency_fees',
  'utilities',
  'furnishing',
  'tax',
  'other',
] as const

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export const createExpenseSchema = z.object({
  property_id: z.string().uuid(),
  category: z.enum(EXPENSE_CATEGORIES).default('other'),
  description: z.string().trim().min(1).max(500),
  vendor_name: z.string().trim().max(200).optional(),
  invoice_ref: z.string().trim().max(100).optional(),
  amount: z.coerce.number().positive('Amount must be positive'),
  incurred_on: z.string().date('Invalid date format (use YYYY-MM-DD)'),
})

export const updateExpenseSchema = z.object({
  property_id: z.string().uuid().optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  description: z.string().trim().min(1).max(500).optional(),
  vendor_name: z.string().trim().max(200).nullable().optional(),
  invoice_ref: z.string().trim().max(100).nullable().optional(),
  amount: z.coerce.number().positive('Amount must be positive').optional(),
  incurred_on: z.string().date('Invalid date format (use YYYY-MM-DD)').optional(),
})

export const listExpensesQuerySchema = z.object({
  property_id: z.string().uuid().optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
})
