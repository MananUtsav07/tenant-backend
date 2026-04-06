import { prisma } from '../../lib/db.js'
import { Prisma } from '@prisma/client'

type IntegrationEventStatus = 'received' | 'processing' | 'processed' | 'failed'

type IntegrationEventRow = {
  id: string
  organization_id: string | null
  provider: string
  event_type: string
  dedupe_key: string | null
  payload: Record<string, unknown>
  status: IntegrationEventStatus
  last_error: string | null
  received_at: string
  processed_at: string | null
  created_at: string
  updated_at: string
}

const integrationEventSelect = {
  id: true,
  organization_id: true,
  provider: true,
  event_type: true,
  dedupe_key: true,
  payload: true,
  status: true,
  last_error: true,
  received_at: true,
  processed_at: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.integration_eventsSelect

export async function recordIntegrationEvent(input: {
  organizationId?: string | null
  provider: string
  eventType: string
  dedupeKey?: string | null
  payload?: Record<string, unknown>
  status?: IntegrationEventStatus
  lastError?: string | null
  receivedAt?: string
  processedAt?: string | null
}) {
  try {
    const data = await prisma.integration_events.create({
      data: {
        organization_id: input.organizationId ?? null,
        provider: input.provider,
        event_type: input.eventType,
        dedupe_key: input.dedupeKey ?? null,
        payload: (input.payload ?? {}) as object,
        status: input.status ?? 'received',
        last_error: input.lastError ?? null,
        received_at: input.receivedAt ? new Date(input.receivedAt) : new Date(),
        processed_at: input.processedAt ? new Date(input.processedAt) : null,
      },
      select: integrationEventSelect,
    })
    return data as unknown as IntegrationEventRow
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && input.dedupeKey) {
      const existing = await getIntegrationEventByDedupeKey(input.dedupeKey)
      if (existing) return existing
    }
    throw err
  }
}

export async function getIntegrationEventByDedupeKey(dedupeKey: string) {
  const data = await prisma.integration_events.findFirst({
    select: integrationEventSelect,
    where: { dedupe_key: dedupeKey },
  })
  return (data as unknown as IntegrationEventRow | null) ?? null
}

export async function updateIntegrationEvent(input: {
  id: string
  status?: IntegrationEventStatus
  payload?: Record<string, unknown>
  lastError?: string | null
  processedAt?: string | null
}) {
  const data = await prisma.integration_events.update({
    where: { id: input.id },
    data: {
      ...(input.status !== undefined && { status: input.status }),
      ...(input.payload !== undefined && { payload: input.payload as object }),
      ...(input.lastError !== undefined && { last_error: input.lastError }),
      ...(input.processedAt !== undefined && { processed_at: input.processedAt ? new Date(input.processedAt) : null }),
    },
    select: integrationEventSelect,
  })
  return (data as unknown as IntegrationEventRow | null) ?? null
}
