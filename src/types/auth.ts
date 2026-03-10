export type OwnerJwtPayload = {
  sub: string
  role: 'owner'
  email: string
  organization_id: string
  iat?: number
  exp?: number
}

export type AdminJwtPayload = {
  sub: string
  role: 'admin'
  email: string
  iat?: number
  exp?: number
}

export type TenantJwtPayload = {
  sub: string
  role: 'tenant'
  owner_id: string
  tenant_access_id: string
  organization_id: string
  iat?: number
  exp?: number
}
