import jwt from 'jsonwebtoken'

import { env } from '../config/env.js'
import type { AdminJwtPayload, OwnerJwtPayload, TenantJwtPayload } from '../types/auth.js'

export function signOwnerToken(ownerId: string, email: string, organizationId: string): string {
  return jwt.sign(
    {
      sub: ownerId,
      role: 'owner',
      email,
      organization_id: organizationId,
    },
    env.JWT_SECRET,
    {
      expiresIn: '7d',
    },
  )
}

export function verifyOwnerToken(token: string): OwnerJwtPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET)
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      decoded.role !== 'owner' ||
      typeof decoded.sub !== 'string' ||
      typeof decoded.email !== 'string' ||
      typeof decoded.organization_id !== 'string'
    ) {
      return null
    }

    return {
      sub: decoded.sub,
      role: 'owner',
      email: decoded.email,
      organization_id: decoded.organization_id,
      iat: typeof decoded.iat === 'number' ? decoded.iat : undefined,
      exp: typeof decoded.exp === 'number' ? decoded.exp : undefined,
    }
  } catch {
    return null
  }
}

export function signAdminToken(adminId: string, email: string): string {
  return jwt.sign(
    {
      sub: adminId,
      role: 'admin',
      email,
    },
    env.JWT_SECRET,
    {
      expiresIn: '7d',
    },
  )
}

export function verifyAdminToken(token: string): AdminJwtPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET)
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      decoded.role !== 'admin' ||
      typeof decoded.sub !== 'string' ||
      typeof decoded.email !== 'string'
    ) {
      return null
    }

    return {
      sub: decoded.sub,
      role: 'admin',
      email: decoded.email,
      iat: typeof decoded.iat === 'number' ? decoded.iat : undefined,
      exp: typeof decoded.exp === 'number' ? decoded.exp : undefined,
    }
  } catch {
    return null
  }
}

export function signTenantToken(args: {
  tenantId: string
  ownerId: string
  tenantAccessId: string
  organizationId: string
}): string {
  return jwt.sign(
    {
      sub: args.tenantId,
      role: 'tenant',
      owner_id: args.ownerId,
      tenant_access_id: args.tenantAccessId,
      organization_id: args.organizationId,
    },
    env.JWT_SECRET,
    {
      expiresIn: '7d',
    },
  )
}

export function verifyTenantToken(token: string): TenantJwtPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET)
    if (
      !decoded ||
      typeof decoded !== 'object' ||
      decoded.role !== 'tenant' ||
      typeof decoded.sub !== 'string' ||
      typeof decoded.owner_id !== 'string' ||
      typeof decoded.tenant_access_id !== 'string' ||
      typeof decoded.organization_id !== 'string'
    ) {
      return null
    }

    return {
      sub: decoded.sub,
      role: 'tenant',
      owner_id: decoded.owner_id,
      tenant_access_id: decoded.tenant_access_id,
      organization_id: decoded.organization_id,
      iat: typeof decoded.iat === 'number' ? decoded.iat : undefined,
      exp: typeof decoded.exp === 'number' ? decoded.exp : undefined,
    }
  } catch {
    return null
  }
}
