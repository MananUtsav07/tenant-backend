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

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  JWT_SECRET: z.string().min(20),
  EMAIL_USER: z.string().email(),
  EMAIL_PASS: z.string().min(3),
  OPENAI_API_KEY: optionalNonEmptyString,
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
  ALLOWED_ORIGIN_LIST: Array.from(new Set(rawOrigins)),
}

export type Env = typeof env
