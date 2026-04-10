import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import type { Request, Response } from 'express'

import { AppError, asyncHandler } from '../lib/errors.js'
import { signOwnerToken, signTenantToken } from '../lib/jwt.js'
import { sendOwnerEmailVerificationEmail } from '../lib/mailer.js'
import { prisma } from '../lib/db.js'
import { env } from '../config/env.js'
import { createAnalyticsEvent } from '../services/analyticsService.js'
import { findOwnerByEmail, createOwner, getOwnerById, updateOwnerById } from '../services/ownerService.js'
import { getAutomationProviderRegistry } from '../services/automation/providers/providerRegistry.js'
import {
  requestOwnerPasswordReset,
  requestTenantPasswordReset,
  resetOwnerPassword,
  resetTenantPassword,
} from '../services/passwordResetService.js'
import { findTenantByAccessId, getTenantById } from '../services/tenantService.js'
import { hasRecentWhatsAppSession } from '../services/whatsappLinkService.js'
import {
  ownerForgotPasswordSchema,
  ownerLoginSchema,
  ownerRegisterSchema,
  ownerUpdateMeSchema,
  passwordResetConfirmSchema,
  tenantForgotPasswordSchema,
  tenantLoginSchema,
} from '../validations/authSchemas.js'

const passwordResetRequestSuccessMessage =
  'If the account details match our records, a password reset email will arrive shortly.'

async function trackAnalyticsSafe(input: {
  event_name: string
  user_type: 'owner' | 'tenant'
  metadata: Record<string, unknown>
}) {
  try {
    await createAnalyticsEvent(input)
  } catch (error) {
    console.error('[analytics-event-failed]', {
      event_name: input.event_name,
      error,
    })
  }
}

export function buildOwnerOnboardingMessage(ownerName: string): string {
  return [
    `👋 Hi ${ownerName}, your WhatsApp is connected to Prophives!`,
    '',
    "Here's what you can do — just type any keyword:",
    '',
    '📊 *stats* — Dashboard overview',
    '🎫 *tickets* — View & reply to tickets',
    '👥 *tenants* — List tenants',
    '🏠 *properties* — Property snapshot',
    '✅ *approvals* — Review rent payments',
    '📋 *menu* — Full menu',
    '',
    "You'll also get rent payment alerts and ticket updates here.",
    'Type *menu* anytime to get started.',
  ].join('\n')
}

export async function sendOwnerWhatsAppOnboarding(input: {
  recipient: string
  ownerId: string
  organizationId: string
  text: string
}) {
  const whatsapp = getAutomationProviderRegistry().whatsapp
  const hasSession = await hasRecentWhatsAppSession({
    organizationId: input.organizationId,
    phoneNumber: input.recipient,
  }).catch(() => false)

  if (hasSession) {
    await whatsapp.sendFreeform({
      recipient: input.recipient,
      text: input.text,
      ownerId: input.ownerId,
      organizationId: input.organizationId,
      policyContext: { sessionOpen: true },
      metadata: { event: 'whatsapp_owner_onboarding' },
    })
    return
  }

  await whatsapp.sendTemplate({
    recipient: input.recipient,
    templateKey: 'owner_whatsapp_onboarding',
    fallbackText: input.text,
    ownerId: input.ownerId,
    organizationId: input.organizationId,
    variables: { body: input.text },
    metadata: { event: 'whatsapp_owner_onboarding' },
  })
}

export const registerOwner = asyncHandler(async (request: Request, response: Response) => {
  const parsed = ownerRegisterSchema.parse(request.body)

  const existingOwner = await findOwnerByEmail(parsed.email)
  if (existingOwner) {
    throw new AppError('Owner account already exists for this email', 409)
  }

  const passwordHash = await bcrypt.hash(parsed.password, 10)
  const owner = await createOwner({
    email: parsed.email,
    password_hash: passwordHash,
    full_name: parsed.full_name,
    company_name: parsed.company_name,
    support_email: parsed.support_email,
    support_whatsapp: parsed.support_whatsapp,
    country_code: parsed.country_code,
  })

  const token = signOwnerToken(owner.id, owner.email, owner.organization_id)

  // Send email verification — fire and forget, never block signup
  const verificationToken = randomBytes(32).toString('base64url')
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 h
  await prisma.owners.update({
    where: { id: owner.id },
    data: { email_verification_token: verificationToken, email_verification_token_expires_at: verificationExpires },
  })
  const verifyUrl = `${env.FRONTEND_URL.replace(/\/$/, '')}/verify-email?token=${verificationToken}`
  sendOwnerEmailVerificationEmail({
    to: owner.email,
    ownerName: owner.full_name ?? owner.email,
    verifyUrl,
  }).catch(() => {}) // non-blocking

  await trackAnalyticsSafe({
    event_name: 'owner_signup',
    user_type: 'owner',
    metadata: {
      owner_id: owner.id,
      organization_id: owner.organization_id,
      email: owner.email,
    },
  })

  response.status(201).json({
    ok: true,
    token,
    email_verified: false,
    owner: {
      id: owner.id,
      email: owner.email,
      full_name: owner.full_name,
      company_name: owner.company_name,
      support_email: owner.support_email,
      support_whatsapp: owner.support_whatsapp,
      email_verified: false,
      organization_id: owner.organization_id,
      organization: owner.organizations
        ? {
            id: owner.organizations.id,
            name: owner.organizations.name,
            slug: owner.organizations.slug,
            plan_code: owner.organizations.plan_code,
            country_code: owner.organizations.country_code,
            currency_code: owner.organizations.currency_code,
            created_at: owner.organizations.created_at,
          }
        : null,
      created_at: owner.created_at,
    },
  })
})

export const loginOwner = asyncHandler(async (request: Request, response: Response) => {
  const parsed = ownerLoginSchema.parse(request.body)

  const owner = await findOwnerByEmail(parsed.email)
  if (!owner) {
    throw new AppError('Invalid owner credentials', 401)
  }

  const matches = await bcrypt.compare(parsed.password, owner.password_hash)
  if (!matches) {
    throw new AppError('Invalid owner credentials', 401)
  }

  const token = signOwnerToken(owner.id, owner.email, owner.organization_id)

  await trackAnalyticsSafe({
    event_name: 'owner_login',
    user_type: 'owner',
    metadata: {
      owner_id: owner.id,
      organization_id: owner.organization_id,
      email: owner.email,
    },
  })

  response.json({
    ok: true,
    token,
    owner: {
      id: owner.id,
      email: owner.email,
      full_name: owner.full_name,
      company_name: owner.company_name,
      support_email: owner.support_email,
      support_whatsapp: owner.support_whatsapp,
      organization_id: owner.organization_id,
      organization: owner.organizations
        ? {
            id: owner.organizations.id,
            name: owner.organizations.name,
            slug: owner.organizations.slug,
            plan_code: owner.organizations.plan_code,
            country_code: owner.organizations.country_code,
            currency_code: owner.organizations.currency_code,
            created_at: owner.organizations.created_at,
          }
        : null,
      created_at: owner.created_at,
    },
  })
})

export const ownerMe = asyncHandler(async (request: Request, response: Response) => {
  const ownerId = request.owner?.ownerId
  if (!ownerId) {
    throw new AppError('Owner authentication required', 401)
  }

  const owner = await getOwnerById(ownerId, request.owner?.organizationId)
  if (!owner) {
    throw new AppError('Owner not found', 404)
  }

  response.json({
    ok: true,
    owner: {
      id: owner.id,
      email: owner.email,
      full_name: owner.full_name,
      company_name: owner.company_name,
      support_email: owner.support_email,
      support_whatsapp: owner.support_whatsapp,
      email_verified: owner.email_verified,
      organization_id: owner.organization_id,
      organization: owner.organizations
        ? {
            id: owner.organizations.id,
            name: owner.organizations.name,
            slug: owner.organizations.slug,
            plan_code: owner.organizations.plan_code,
            country_code: owner.organizations.country_code,
            currency_code: owner.organizations.currency_code,
            created_at: owner.organizations.created_at,
          }
        : null,
      created_at: owner.created_at,
    },
  })
})

export const patchOwnerMe = asyncHandler(async (request: Request, response: Response) => {
  const ownerId = request.owner?.ownerId
  if (!ownerId) {
    throw new AppError('Owner authentication required', 401)
  }

  const parsed = ownerUpdateMeSchema.parse(request.body ?? {})
  const patch: Partial<{
    support_email: string | null
    support_whatsapp: string | null
  }> = {}

  if (Object.prototype.hasOwnProperty.call(parsed, 'support_email')) {
    patch.support_email = parsed.support_email ?? null
  }

  if (Object.prototype.hasOwnProperty.call(parsed, 'support_whatsapp')) {
    patch.support_whatsapp = parsed.support_whatsapp ?? null
  }

  if (Object.keys(patch).length === 0) {
    throw new AppError('No profile fields provided to update', 400)
  }

  const owner = await updateOwnerById({
    ownerId,
    organizationId: request.owner?.organizationId,
    patch,
  })

  if (!owner) {
    throw new AppError('Owner not found', 404)
  }

  if (patch.support_whatsapp) {
    const ownerName = owner.full_name ?? owner.company_name ?? 'there'
    void sendOwnerWhatsAppOnboarding({
        recipient: patch.support_whatsapp,
        text: buildOwnerOnboardingMessage(ownerName),
        ownerId: owner.id,
        organizationId: owner.organization_id,
      })
      .catch(() => {
        // Non-fatal: onboarding message failure should not block the profile save response
      })
  }

  response.json({
    ok: true,
    owner: {
      id: owner.id,
      email: owner.email,
      full_name: owner.full_name,
      company_name: owner.company_name,
      support_email: owner.support_email,
      support_whatsapp: owner.support_whatsapp,
      organization_id: owner.organization_id,
      organization: owner.organizations
        ? {
            id: owner.organizations.id,
            name: owner.organizations.name,
            slug: owner.organizations.slug,
            plan_code: owner.organizations.plan_code,
            country_code: owner.organizations.country_code,
            currency_code: owner.organizations.currency_code,
            created_at: owner.organizations.created_at,
          }
        : null,
      created_at: owner.created_at,
    },
  })
})

export const loginTenant = asyncHandler(async (request: Request, response: Response) => {
  const parsed = tenantLoginSchema.parse(request.body)

  const tenant = await findTenantByAccessId(parsed.tenant_access_id)
  if (!tenant) {
    throw new AppError('Invalid tenant credentials', 401)
  }

  if (parsed.email && tenant.email && tenant.email.toLowerCase() !== parsed.email.toLowerCase()) {
    throw new AppError('Invalid tenant credentials', 401)
  }

  const matches = await bcrypt.compare(parsed.password, tenant.password_hash)
  if (!matches) {
    throw new AppError('Invalid tenant credentials', 401)
  }

  const token = signTenantToken({
    tenantId: tenant.id,
    ownerId: tenant.owner_id,
    tenantAccessId: tenant.tenant_access_id,
    organizationId: tenant.organization_id,
  })

  await trackAnalyticsSafe({
    event_name: 'tenant_login',
    user_type: 'tenant',
    metadata: {
      tenant_id: tenant.id,
      owner_id: tenant.owner_id,
      organization_id: tenant.organization_id,
    },
  })

  response.json({
    ok: true,
    token,
    tenant: {
      id: tenant.id,
      full_name: tenant.full_name,
      tenant_access_id: tenant.tenant_access_id,
      status: tenant.status,
      owner_id: tenant.owner_id,
      organization_id: tenant.organization_id,
      property_id: tenant.property_id,
    },
  })
})

export const tenantMe = asyncHandler(async (request: Request, response: Response) => {
  const tenantId = request.tenant?.tenantId
  const organizationId = request.tenant?.organizationId
  if (!tenantId || !organizationId) {
    throw new AppError('Tenant authentication required', 401)
  }

  const tenant = await getTenantById(tenantId, organizationId)
  if (!tenant) {
    throw new AppError('Tenant not found', 404)
  }

  response.json({
    ok: true,
    tenant: {
      id: tenant.id,
      full_name: tenant.full_name,
      email: tenant.email,
      phone: tenant.phone,
      tenant_access_id: tenant.tenant_access_id,
      lease_start_date: tenant.lease_start_date,
      lease_end_date: tenant.lease_end_date,
      monthly_rent: tenant.monthly_rent,
      payment_due_day: tenant.payment_due_day,
      payment_status: tenant.payment_status,
      status: tenant.status,
      organization_id: tenant.organization_id,
      organization: tenant.organizations
        ? {
            id: tenant.organizations.id,
            name: tenant.organizations.name,
            slug: tenant.organizations.slug,
            plan_code: tenant.organizations.plan_code,
            country_code: tenant.organizations.country_code,
            currency_code: tenant.organizations.currency_code,
            created_at: tenant.organizations.created_at,
          }
        : null,
      created_at: tenant.created_at,
    },
    property: tenant.properties,
    owner: {
      id: tenant.owners?.id,
      full_name: tenant.owners?.full_name,
      company_name: tenant.owners?.company_name,
      support_email: tenant.owners?.support_email,
      support_whatsapp: tenant.owners?.support_whatsapp,
    },
    organization: tenant.organizations
      ? {
          id: tenant.organizations.id,
          name: tenant.organizations.name,
          slug: tenant.organizations.slug,
          plan_code: tenant.organizations.plan_code,
          country_code: tenant.organizations.country_code,
          currency_code: tenant.organizations.currency_code,
          created_at: tenant.organizations.created_at,
        }
      : null,
  })
})

export const postOwnerForgotPassword = asyncHandler(async (request: Request, response: Response) => {
  const parsed = ownerForgotPasswordSchema.parse(request.body)
  await requestOwnerPasswordReset(parsed.email)

  response.json({
    ok: true,
    message: passwordResetRequestSuccessMessage,
  })
})

export const postOwnerResetPassword = asyncHandler(async (request: Request, response: Response) => {
  const parsed = passwordResetConfirmSchema.parse(request.body)
  await resetOwnerPassword({
    token: parsed.token,
    password: parsed.password,
  })

  response.json({
    ok: true,
    message: 'Your owner password has been updated. You can now sign in with the new password.',
  })
})

export const postTenantForgotPassword = asyncHandler(async (request: Request, response: Response) => {
  const parsed = tenantForgotPasswordSchema.parse(request.body)
  await requestTenantPasswordReset({
    tenantAccessId: parsed.tenant_access_id,
    email: parsed.email,
  })

  response.json({
    ok: true,
    message: passwordResetRequestSuccessMessage,
  })
})

export const postTenantResetPassword = asyncHandler(async (request: Request, response: Response) => {
  const parsed = passwordResetConfirmSchema.parse(request.body)
  await resetTenantPassword({
    token: parsed.token,
    password: parsed.password,
  })

  response.json({
    ok: true,
    message: 'Your resident password has been updated. You can now sign in with the new password.',
  })
})

export const verifyOwnerEmail = asyncHandler(async (request: Request, response: Response) => {
  const token = typeof request.query.token === 'string' ? request.query.token.trim() : ''
  if (!token) throw new AppError('Verification token is required', 400)

  const owner = await prisma.owners.findFirst({
    where: { email_verification_token: token },
    select: { id: true, email_verified: true, email_verification_token_expires_at: true },
  })

  if (!owner) throw new AppError('Invalid or already used verification link', 400)
  if (owner.email_verified) {
    return response.json({ ok: true, message: 'Email already verified.' })
  }
  if (owner.email_verification_token_expires_at && owner.email_verification_token_expires_at < new Date()) {
    throw new AppError('Verification link has expired. Please request a new one.', 410)
  }

  await prisma.owners.update({
    where: { id: owner.id },
    data: {
      email_verified: true,
      email_verification_token: null,
      email_verification_token_expires_at: null,
      updated_at: new Date(),
    },
  })

  response.json({ ok: true, message: 'Email verified successfully. You can now use your Prophives account.' })
})

export const resendOwnerEmailVerification = asyncHandler(async (request: Request, response: Response) => {
  const ownerId = request.owner?.ownerId
  if (!ownerId) throw new AppError('Owner authentication required', 401)

  const owner = await prisma.owners.findUnique({
    where: { id: ownerId },
    select: { id: true, email: true, full_name: true, email_verified: true },
  })
  if (!owner) throw new AppError('Owner not found', 404)
  if (owner.email_verified) {
    return response.json({ ok: true, message: 'Email is already verified.' })
  }

  const verificationToken = randomBytes(32).toString('base64url')
  const verificationExpires = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await prisma.owners.update({
    where: { id: ownerId },
    data: { email_verification_token: verificationToken, email_verification_token_expires_at: verificationExpires, updated_at: new Date() },
  })

  const verifyUrl = `${env.FRONTEND_URL.replace(/\/$/, '')}/verify-email?token=${verificationToken}`
  await sendOwnerEmailVerificationEmail({
    to: owner.email,
    ownerName: owner.full_name ?? owner.email,
    verifyUrl,
  })

  response.json({ ok: true, message: 'Verification email sent. Please check your inbox.' })
})
