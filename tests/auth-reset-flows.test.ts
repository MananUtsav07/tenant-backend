import bcrypt from 'bcryptjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type OwnerRecord = {
  id: string
  email: string
  password_hash: string
  full_name: string | null
  company_name: string | null
  support_email: string | null
  support_whatsapp: string | null
  organization_id: string
  created_at: string
  organizations: {
    id: string
    name: string
    slug: string
    plan_code: string
    country_code: string
    currency_code: string
    created_at: string
  }
}

type TenantRecord = {
  id: string
  email: string | null
  password_hash: string
  full_name: string
  tenant_access_id: string
  status: string
  owner_id: string
  organization_id: string
  property_id: string
}

type ResetTokenRecord = {
  id: string
  organization_id: string
  owner_id: string | null
  tenant_id: string | null
  user_role: 'owner' | 'tenant'
  email: string | null
  tenant_access_id: string | null
  token_hash: string
  expires_at: string
  consumed_at: string | null
  created_at: string
}

let currentOwner: OwnerRecord | null = null
let currentTenant: TenantRecord | null = null
let resetTokens: ResetTokenRecord[] = []
let resetTokenCounter = 0
let ownerResetEmails: Array<{ resetUrl: string; to: string }> = []
let tenantResetEmails: Array<{ resetUrl: string; to: string }> = []

function matchesFilters(row: Record<string, unknown>, filters: Record<string, unknown>) {
  return Object.entries(filters).every(([key, value]) => row[key] === value)
}

vi.mock('../src/config/env.js', () => ({
  env: {
    PORT: 8787,
    NODE_ENV: 'test',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-1234567890',
    JWT_SECRET: 'jwt-secret-12345678901234567890',
    EMAIL_USER: 'support@prophives.com',
    EMAIL_PASS: 'mail-password',
    EMAIL_FROM: 'support@prophives.com',
    SMTP_HOST: undefined,
    SMTP_PORT: 465,
    SMTP_SECURE: true,
    OPENAI_API_KEY: undefined,
    TELEGRAM_BOT_TOKEN: undefined,
    TELEGRAM_BOT_USERNAME: undefined,
    TELEGRAM_WEBHOOK_SECRET: undefined,
    TELEGRAM_ONBOARDING_TOKEN_TTL_MINUTES: 30,
    PASSWORD_RESET_TOKEN_TTL_MINUTES: 60,
    INTERNAL_AUTOMATION_KEY: undefined,
    FRONTEND_URL: 'https://app.prophives.com',
    ALLOWED_ORIGIN_LIST: ['http://localhost:5173'],
  },
}))

vi.mock('../src/services/analyticsService.js', () => ({
  createAnalyticsEvent: vi.fn(async () => undefined),
}))

vi.mock('../src/lib/mailer.js', () => ({
  sendOwnerPasswordResetEmail: vi.fn(async (payload: { resetUrl: string; to: string }) => {
    ownerResetEmails.push(payload)
  }),
  sendTenantPasswordResetEmail: vi.fn(async (payload: { resetUrl: string; to: string }) => {
    tenantResetEmails.push(payload)
  }),
}))

vi.mock('../src/services/ownerService.js', () => ({
  findOwnerByEmail: vi.fn(async (email: string) => (currentOwner?.email === email ? currentOwner : null)),
  createOwner: vi.fn(),
  getOwnerById: vi.fn(async (ownerId: string) => (currentOwner?.id === ownerId ? currentOwner : null)),
}))

vi.mock('../src/services/tenantService.js', () => ({
  findTenantByAccessId: vi.fn(async (tenantAccessId: string) =>
    currentTenant?.tenant_access_id === tenantAccessId ? currentTenant : null,
  ),
  getTenantById: vi.fn(async (tenantId: string) => (currentTenant?.id === tenantId ? currentTenant : null)),
}))

vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table === 'password_reset_tokens') {
        return {
          update: (patch: Partial<ResetTokenRecord>) => {
            const filters: Record<string, unknown> = {}
            const request = {
              eq(column: string, value: unknown) {
                filters[column] = value
                return request
              },
              is(column: string, value: unknown) {
                filters[column] = value
                return request
              },
              then(resolve: (value: { error: null; data: ResetTokenRecord[] }) => unknown) {
                const updated = resetTokens.filter((token) => matchesFilters(token, filters))
                for (const token of updated) {
                  Object.assign(token, patch)
                }
                return Promise.resolve(resolve({ error: null, data: updated }))
              },
            }
            return request
          },
          insert: async (payload: Omit<ResetTokenRecord, 'id' | 'created_at' | 'consumed_at'>) => {
            resetTokens.push({
              id: `reset-${++resetTokenCounter}`,
              created_at: new Date().toISOString(),
              consumed_at: null,
              ...payload,
            })
            return { error: null, data: null }
          },
          select: () => {
            const filters: Record<string, unknown> = {}
            const request = {
              eq(column: string, value: unknown) {
                filters[column] = value
                return request
              },
              maybeSingle: async () => ({
                data: resetTokens.find((token) => matchesFilters(token, filters)) ?? null,
                error: null,
              }),
            }
            return request
          },
        }
      }

      if (table === 'owners') {
        return {
          update: (patch: Partial<OwnerRecord>) => {
            const filters: Record<string, unknown> = {}
            const request = {
              eq(column: string, value: unknown) {
                filters[column] = value
                return request
              },
              select() {
                return request
              },
              maybeSingle: async () => {
                if (currentOwner && matchesFilters(currentOwner, filters)) {
                  Object.assign(currentOwner, patch)
                  return { data: { id: currentOwner.id }, error: null }
                }
                return { data: null, error: null }
              },
            }
            return request
          },
        }
      }

      if (table === 'tenants') {
        return {
          update: (patch: Partial<TenantRecord>) => {
            const filters: Record<string, unknown> = {}
            const request = {
              eq(column: string, value: unknown) {
                filters[column] = value
                return request
              },
              select() {
                return request
              },
              maybeSingle: async () => {
                if (currentTenant && matchesFilters(currentTenant, filters)) {
                  Object.assign(currentTenant, patch)
                  return { data: { id: currentTenant.id }, error: null }
                }
                return { data: null, error: null }
              },
            }
            return request
          },
        }
      }

      throw new Error(`Unexpected table access in test: ${table}`)
    }),
  },
}))

function createMockResponse() {
  let statusCode = 200
  let payload: unknown
  let resolveCompleted: (() => void) | null = null
  const completed = new Promise<void>((resolve) => {
    resolveCompleted = resolve
  })

  const response = {
    status: vi.fn((code: number) => {
      statusCode = code
      return response
    }),
    json: vi.fn((value: unknown) => {
      payload = value
      resolveCompleted?.()
      return response
    }),
  }

  return {
    response: response as any,
    get statusCode() {
      return statusCode
    },
    get payload() {
      return payload
    },
    completed,
  }
}

const passwordResetService = await import('../src/services/passwordResetService.js')
const authController = await import('../src/controllers/authController.js')

describe('password reset journeys', () => {
  beforeEach(async () => {
    resetTokens = []
    resetTokenCounter = 0
    ownerResetEmails = []
    tenantResetEmails = []

    currentOwner = {
      id: 'owner-1',
      email: 'owner@prophives.com',
      password_hash: await bcrypt.hash('OldOwnerPass123', 10),
      full_name: 'Nadia Owner',
      company_name: 'Prophives Estates',
      support_email: 'support@prophives.com',
      support_whatsapp: null,
      organization_id: 'org-1',
      created_at: '2026-03-14T10:00:00.000Z',
      organizations: {
        id: 'org-1',
        name: 'Prophives Estates',
        slug: 'prophives-estates',
        plan_code: 'starter',
        country_code: 'AE',
        currency_code: 'AED',
        created_at: '2026-03-14T10:00:00.000Z',
      },
    }

    currentTenant = {
      id: 'tenant-1',
      email: 'resident@prophives.com',
      password_hash: await bcrypt.hash('OldTenantPass123', 10),
      full_name: 'Omar Resident',
      tenant_access_id: 'PH-TEN-1001',
      status: 'active',
      owner_id: 'owner-1',
      organization_id: 'org-1',
      property_id: 'property-1',
    }
  })

  it('covers owner forgot password, reset, and login with the new password', async () => {
    await passwordResetService.requestOwnerPasswordReset(currentOwner!.email)

    expect(ownerResetEmails).toHaveLength(1)
    const resetUrl = new URL(ownerResetEmails[0].resetUrl)
    expect(resetUrl.pathname).toBe('/owner/reset-password')

    const token = resetUrl.searchParams.get('token')
    expect(token).toBeTruthy()

    await passwordResetService.resetOwnerPassword({
      token: token!,
      password: 'NewOwnerPass456',
    })

    expect(await bcrypt.compare('NewOwnerPass456', currentOwner!.password_hash)).toBe(true)
    expect(resetTokens.every((row) => row.consumed_at !== null)).toBe(true)

    const response = createMockResponse()
    authController.loginOwner(
      {
        body: {
          email: currentOwner!.email,
          password: 'NewOwnerPass456',
        },
      } as any,
      response.response,
      vi.fn(),
    )
    await response.completed

    expect(response.statusCode).toBe(200)
    expect((response.payload as any).ok).toBe(true)
    expect((response.payload as any).owner.email).toBe(currentOwner!.email)
    expect((response.payload as any).token).toEqual(expect.any(String))
  })

  it('covers tenant forgot password, reset, and login with the new password', async () => {
    await passwordResetService.requestTenantPasswordReset({
      tenantAccessId: currentTenant!.tenant_access_id,
      email: currentTenant!.email!,
    })

    expect(tenantResetEmails).toHaveLength(1)
    const resetUrl = new URL(tenantResetEmails[0].resetUrl)
    expect(resetUrl.pathname).toBe('/tenant/reset-password')

    const token = resetUrl.searchParams.get('token')
    expect(token).toBeTruthy()

    await passwordResetService.resetTenantPassword({
      token: token!,
      password: 'NewTenantPass456',
    })

    expect(await bcrypt.compare('NewTenantPass456', currentTenant!.password_hash)).toBe(true)
    expect(resetTokens.every((row) => row.consumed_at !== null)).toBe(true)

    const response = createMockResponse()
    authController.loginTenant(
      {
        body: {
          tenant_access_id: currentTenant!.tenant_access_id,
          email: currentTenant!.email,
          password: 'NewTenantPass456',
        },
      } as any,
      response.response,
      vi.fn(),
    )
    await response.completed

    expect(response.statusCode).toBe(200)
    expect((response.payload as any).ok).toBe(true)
    expect((response.payload as any).tenant.tenant_access_id).toBe(currentTenant!.tenant_access_id)
    expect((response.payload as any).token).toEqual(expect.any(String))
  })
})
