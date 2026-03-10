import { z } from 'zod'

export const ownerRegisterSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8),
  full_name: z.string().trim().min(1).max(120).optional(),
  company_name: z.string().trim().min(1).max(200).optional(),
  support_email: z.string().email().optional(),
  support_whatsapp: z.string().trim().min(5).max(30).optional(),
})

export const ownerLoginSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1),
})

export const tenantLoginSchema = z
  .object({
    tenant_access_id: z.string().trim().min(4),
    password: z.string().min(1),
    email: z.string().email().optional(),
  })
  .strict()