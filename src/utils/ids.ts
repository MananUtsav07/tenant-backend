import crypto from 'node:crypto'

export function generateTenantAccessId(): string {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase()
  return `TEN-${suffix}`
}