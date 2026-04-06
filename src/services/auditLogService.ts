import { prisma } from '../lib/db.js'

export async function createAuditLog(input: {
  organization_id?: string | null
  actor_id: string
  actor_role: 'owner' | 'tenant' | 'admin' | 'system'
  action: string
  entity_type: string
  entity_id?: string | null
  metadata?: Record<string, unknown>
}) {
  return prisma.audit_logs.create({
    data: {
      organization_id: input.organization_id ?? null,
      actor_id: input.actor_id,
      actor_role: input.actor_role,
      action: input.action,
      entity_type: input.entity_type,
      entity_id: input.entity_id ?? null,
      metadata: (input.metadata ?? {}) as object,
    },
    select: { id: true, created_at: true },
  })
}
