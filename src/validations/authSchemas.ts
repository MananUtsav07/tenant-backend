import { z } from 'zod'
import { supportedCountryCodes } from '../config/countryCurrency.js'

const countryCodeSchema = z.enum(supportedCountryCodes)

export const ownerRegisterSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8),
  full_name: z.string().trim().min(1).max(120).optional(),
  company_name: z.string().trim().min(1).max(200).optional(),
  support_email: z.string().email().optional(),
  support_whatsapp: z.string().trim().min(5).max(30).optional(),
  country_code: countryCodeSchema,
})

export const ownerLoginSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1),
})

export const ownerUpdateMeSchema = z
  .object({
    support_email: z
      .union([z.string().email(), z.null()])
      .optional()
      .transform((value) => (typeof value === 'string' ? value.trim().toLowerCase() : value)),
    support_whatsapp: z
      .union([z.string().trim().min(5).max(30), z.literal(''), z.null()])
      .optional()
      .transform((value) => (value === '' ? null : value)),
  })
  .strict()

export const ownerDeleteMeSchema = z
  .object({
    confirmation_text: z.string().trim().min(1).max(120),
    reasons: z
      .array(
        z.enum([
          'not_satisfied',
          'missing_features',
          'too_expensive',
          'switching_platform',
          'temporary_use_only',
          'other',
        ]),
      )
      .min(1)
      .max(6),
  })
  .strict()

export const tenantLoginSchema = z
  .object({
    tenant_access_id: z.string().trim().min(4),
    password: z.string().min(1),
    email: z.string().email().transform((value) => value.trim().toLowerCase()).optional(),
  })
  .strict()

export const ownerForgotPasswordSchema = z.object({
  email: z.string().email().transform((value) => value.trim().toLowerCase()),
})

export const tenantForgotPasswordSchema = z
  .object({
    tenant_access_id: z.string().trim().min(4),
    email: z.string().email().transform((value) => value.trim().toLowerCase()),
  })
  .strict()

export const passwordResetConfirmSchema = z
  .object({
    token: z.string().trim().min(20),
    password: z.string().min(8),
  })
  .strict()

export const ownerWhatsAppSendOtpSchema = z.object({
  phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, 'E.164 format required (+country code + number)'),
})

export const ownerWhatsAppVerifyOtpSchema = z.object({
  phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/, 'E.164 format required (+country code + number)'),
  code: z.string().trim().regex(/^\d{6}$/, '6-digit code required'),
})
