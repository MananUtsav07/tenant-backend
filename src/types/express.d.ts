import type { AdminJwtPayload, OwnerJwtPayload, TenantJwtPayload } from './auth.js'

declare global {
  namespace Express {
    interface Request {
      requestId?: string
      auth?: {
        userId: string
        role: 'admin' | 'owner' | 'tenant'
        organizationId: string | null
      }
      owner?: {
        ownerId: string
        email: string
        organizationId: string
      }
      admin?: {
        adminId: string
        email: string
      }
      tenant?: {
        tenantId: string
        ownerId: string
        tenantAccessId: string
        organizationId: string
      }
      authPayload?: OwnerJwtPayload | TenantJwtPayload | AdminJwtPayload
    }
  }
}

export {}
