import { z } from 'zod'

export const createBrokerSchema = z.object({
  full_name: z.string().trim().min(1).max(200),
  email: z.string().email(),
  phone: z.string().trim().max(30).optional(),
  agency_name: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1000).optional(),
  is_active: z.boolean().optional(),
})

export const updateBrokerSchema = z
  .object({
    full_name: z.string().trim().min(1).max(200).optional(),
    email: z.string().email().optional(),
    phone: z.string().trim().max(30).nullable().optional(),
    agency_name: z.string().trim().max(200).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .strict()
