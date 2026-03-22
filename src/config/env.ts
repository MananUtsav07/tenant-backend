import dotenv from 'dotenv'
import { z } from 'zod'

dotenv.config()

const optionalNonEmptyString = z.preprocess(
  (value) => {
    if (typeof value !== 'string') {
      return value
    }

    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  },
  z.string().min(1).optional(),
)

const optionalBoolean = z.preprocess(
  (value) => {
    if (typeof value === 'boolean') {
      return value
    }

    if (typeof value !== 'string') {
      return value
    }

    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') {
      return true
    }

    if (normalized === 'false') {
      return false
    }

    return value
  },
  z.boolean().optional(),
)

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  JWT_SECRET: z.string().min(20),
  EMAIL_USER: z.string().email(),
  EMAIL_PASS: z.string().min(3),
  EMAIL_FROM: optionalNonEmptyString,
  SMTP_HOST: optionalNonEmptyString,
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: optionalBoolean.default(true),
  OPENAI_API_KEY: optionalNonEmptyString,
  OPENAI_MODEL: z.string().trim().min(1).default('gpt-4o-mini'),
  TELEGRAM_BOT_TOKEN: optionalNonEmptyString,
  TELEGRAM_BOT_USERNAME: optionalNonEmptyString,
  TELEGRAM_WEBHOOK_SECRET: optionalNonEmptyString,
  TELEGRAM_ONBOARDING_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
  WHATSAPP_PROVIDER: z.enum(['stub', 'meta']).optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: optionalNonEmptyString,
  WHATSAPP_WEBHOOK_SECRET: optionalNonEmptyString,
  WHATSAPP_ACCESS_TOKEN: optionalNonEmptyString,
  WHATSAPP_PHONE_NUMBER_ID: optionalNonEmptyString,
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().min(15).max(1440).default(60),
  INTERNAL_AUTOMATION_KEY: optionalNonEmptyString,
  FRONTEND_URL: z.string().url(),
  ALLOWED_ORIGINS: z.string().optional(),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  console.error('Invalid environment configuration')
  console.error(parsed.error.flatten().fieldErrors)
  process.exit(1)
}

const rawOrigins = parsed.data.ALLOWED_ORIGINS
  ? parsed.data.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
  : [parsed.data.FRONTEND_URL, 'http://localhost:5173']

export const env = {
  ...parsed.data,
  EMAIL_FROM: parsed.data.EMAIL_FROM ?? parsed.data.EMAIL_USER,
  ALLOWED_ORIGIN_LIST: Array.from(new Set(rawOrigins)),
}

export type Env = typeof env
