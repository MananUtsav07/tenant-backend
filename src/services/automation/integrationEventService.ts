import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../../lib/errors.js'
import { supabaseAdmin } from '../../lib/supabase.js'

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

const integrationEventSelect =
  'id, organization_id, provider, event_type, dedupe_key, payload, status, last_error, received_at, processed_at, created_at, updated_at'

function throwIntegrationEventError(error: PostgrestError | null, message: string) {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

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
  const { data, error } = await supabaseAdmin
    .from('integration_events')
    .insert({
      organization_id: input.organizationId ?? null,
      provider: input.provider,
      event_type: input.eventType,
      dedupe_key: input.dedupeKey ?? null,
      payload: input.payload ?? {},
      status: input.status ?? 'received',
      last_error: input.lastError ?? null,
      received_at: input.receivedAt ?? new Date().toISOString(),
      processed_at: input.processedAt ?? null,
    })
    .select(integrationEventSelect)
    .maybeSingle()

  if (!error) {
    return data as IntegrationEventRow
  }

  if (error.code === '23505' && input.dedupeKey) {
    const existing = await getIntegrationEventByDedupeKey(input.dedupeKey)
    if (existing) {
      return existing
    }
  }

  throwIntegrationEventError(error, 'Failed to record integration event')
}

export async function getIntegrationEventByDedupeKey(dedupeKey: string) {
  const { data, error } = await supabaseAdmin
    .from('integration_events')
    .select(integrationEventSelect)
    .eq('dedupe_key', dedupeKey)
    .maybeSingle()

  throwIntegrationEventError(error, 'Failed to load integration event')
  return (data as IntegrationEventRow | null) ?? null
}

export async function updateIntegrationEvent(input: {
  id: string
  status?: IntegrationEventStatus
  payload?: Record<string, unknown>
  lastError?: string | null
  processedAt?: string | null
}) {
  const { data, error } = await supabaseAdmin
    .from('integration_events')
    .update({
      status: input.status,
      payload: input.payload,
      last_error: typeof input.lastError === 'undefined' ? undefined : input.lastError,
      processed_at: typeof input.processedAt === 'undefined' ? undefined : input.processedAt,
    })
    .eq('id', input.id)
    .select(integrationEventSelect)
    .maybeSingle()

  throwIntegrationEventError(error, 'Failed to update integration event')
  return (data as IntegrationEventRow | null) ?? null
}
