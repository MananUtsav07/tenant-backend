import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'

import { env } from '../config/env.js'
import { AppError } from '../lib/errors.js'
import {
  sendOwnerPasswordResetEmail,
  sendTenantPasswordResetEmail,
} from '../lib/mailer.js'
import { prisma } from '../lib/db.js'
import { findOwnerByEmail } from './ownerService.js'
import { findTenantByAccessId } from './tenantService.js'

type ResetRole = 'owner' | 'tenant'

function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function createRawPasswordResetToken(): string {
  return randomBytes(32).toString('base64url')
}

function buildPasswordResetUrl(role: ResetRole, token: string): string {
  const path = role === 'owner' ? '/owner/reset-password' : '/tenant/reset-password'
  const url = new URL(path, `${env.FRONTEND_URL.replace(/\/$/, '')}/`)
  url.searchParams.set('token', token)
  return url.toString()
}

function formatMinutesLabel(minutes: number): string {
  return minutes === 60 ? 'about 1 hour' : `${minutes} minutes`
}

async function invalidatePasswordResetTokens(input: {
  role: ResetRole
  ownerId?: string
  tenantId?: string
}) {
  const where =
    input.role === 'owner'
      ? { user_role: input.role, consumed_at: null, owner_id: input.ownerId ?? '' }
      : { user_role: input.role, consumed_at: null, tenant_id: input.tenantId ?? '' }

  await prisma.password_reset_tokens.updateMany({
    where,
    data: { consumed_at: new Date() },
  })
}

async function storePasswordResetToken(input: {
  role: ResetRole
  organizationId: string
  ownerId?: string
  tenantId?: string
  email?: string | null
  tenantAccessId?: string | null
}) {
  const token = createRawPasswordResetToken()
  const expiresAt = new Date(Date.now() + env.PASSWORD_RESET_TOKEN_TTL_MINUTES * 60 * 1000)

  await prisma.password_reset_tokens.create({
    data: {
      organization_id: input.organizationId,
      owner_id: input.role === 'owner' ? input.ownerId ?? null : null,
      tenant_id: input.role === 'tenant' ? input.tenantId ?? null : null,
      user_role: input.role,
      email: input.email ?? null,
      tenant_access_id: input.tenantAccessId ?? null,
      token_hash: hashPasswordResetToken(token),
      expires_at: expiresAt,
    },
  })

  return { token, expiresAt }
}

async function loadPasswordResetToken(token: string, role: ResetRole) {
  const data = await prisma.password_reset_tokens.findFirst({
    select: { id: true, organization_id: true, owner_id: true, tenant_id: true, user_role: true, expires_at: true, consumed_at: true },
    where: { token_hash: hashPasswordResetToken(token), user_role: role },
  })

  if (!data) {
    throw new AppError('Invalid password reset link', 400)
  }

  if (data.consumed_at) {
    throw new AppError('This password reset link has already been used', 400)
  }

  if (data.expires_at.getTime() < Date.now()) {
    throw new AppError('This password reset link has expired', 400)
  }

  return data
}

function normalizeOwnerName(owner: {
  full_name?: string | null
  company_name?: string | null
  email: string
}) {
  return owner.full_name?.trim() || owner.company_name?.trim() || owner.email
}

function normalizeTenantName(tenant: {
  full_name?: string | null
  tenant_access_id: string
}) {
  return tenant.full_name?.trim() || tenant.tenant_access_id
}

export async function requestOwnerPasswordReset(email: string) {
  const owner = await findOwnerByEmail(email)
  if (!owner?.email) return

  await invalidatePasswordResetTokens({ role: 'owner', ownerId: owner.id })

  const { token } = await storePasswordResetToken({
    role: 'owner',
    organizationId: owner.organization_id,
    ownerId: owner.id,
    email: owner.email,
  })

  try {
    await sendOwnerPasswordResetEmail({
      to: owner.email,
      ownerName: normalizeOwnerName(owner),
      resetUrl: buildPasswordResetUrl('owner', token),
      expiresInLabel: formatMinutesLabel(env.PASSWORD_RESET_TOKEN_TTL_MINUTES),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = (error as Record<string, unknown>)?.code ?? 'UNKNOWN'
    console.error(`[requestOwnerPasswordReset] email failed — code=${String(code)} message=${message}`, {
      ownerId: owner.id,
      email: owner.email,
    })
  }
}

export async function requestTenantPasswordReset(input: {
  tenantAccessId: string
  email: string
}) {
  const tenant = await findTenantByAccessId(input.tenantAccessId)
  if (!tenant) return

  const tenantEmail = tenant.email?.trim().toLowerCase()
  if (!tenantEmail) {
    console.warn('[requestTenantPasswordReset] tenant has no email on file', {
      tenantId: tenant.id,
      tenantAccessId: tenant.tenant_access_id,
    })
    return
  }

  if (tenantEmail !== input.email.trim().toLowerCase()) return

  await invalidatePasswordResetTokens({ role: 'tenant', tenantId: tenant.id })

  const { token } = await storePasswordResetToken({
    role: 'tenant',
    organizationId: tenant.organization_id,
    tenantId: tenant.id,
    email: tenantEmail,
    tenantAccessId: tenant.tenant_access_id,
  })

  try {
    await sendTenantPasswordResetEmail({
      to: tenantEmail,
      tenantName: normalizeTenantName(tenant),
      tenantAccessId: tenant.tenant_access_id,
      resetUrl: buildPasswordResetUrl('tenant', token),
      expiresInLabel: formatMinutesLabel(env.PASSWORD_RESET_TOKEN_TTL_MINUTES),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code = (error as Record<string, unknown>)?.code ?? 'UNKNOWN'
    console.error(`[requestTenantPasswordReset] email failed — code=${String(code)} message=${message}`, {
      tenantId: tenant.id,
      tenantAccessId: tenant.tenant_access_id,
      email: tenantEmail,
    })
  }
}

async function consumePasswordResetAndUpdatePassword(input: {
  role: ResetRole
  token: string
  nextPassword: string
}) {
  const tokenRow = await loadPasswordResetToken(input.token, input.role)
  const passwordHash = await bcrypt.hash(input.nextPassword, 10)

  if (input.role === 'owner') {
    if (!tokenRow.owner_id) throw new AppError('Password reset token is missing an owner account', 500)

    const owner = await prisma.owners.findFirst({
      select: { id: true },
      where: { id: tokenRow.owner_id, organization_id: tokenRow.organization_id },
    })
    if (!owner) throw new AppError('Owner account not found', 404)

    await prisma.owners.update({
      where: { id: tokenRow.owner_id },
      data: { password_hash: passwordHash },
    })

    await invalidatePasswordResetTokens({ role: 'owner', ownerId: tokenRow.owner_id })
    return
  }

  if (!tokenRow.tenant_id) throw new AppError('Password reset token is missing a tenant account', 500)

  const tenant = await prisma.tenants.findFirst({
    select: { id: true },
    where: { id: tokenRow.tenant_id, organization_id: tokenRow.organization_id },
  })
  if (!tenant) throw new AppError('Tenant account not found', 404)

  await prisma.tenants.update({
    where: { id: tokenRow.tenant_id },
    data: { password_hash: passwordHash },
  })

  await invalidatePasswordResetTokens({ role: 'tenant', tenantId: tokenRow.tenant_id })
}

export async function resetOwnerPassword(input: { token: string; password: string }) {
  await consumePasswordResetAndUpdatePassword({ role: 'owner', token: input.token, nextPassword: input.password })
}

export async function resetTenantPassword(input: { token: string; password: string }) {
  await consumePasswordResetAndUpdatePassword({ role: 'tenant', token: input.token, nextPassword: input.password })
}
