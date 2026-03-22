import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'

export type AnalyticsUserType = 'public' | 'owner' | 'tenant' | 'admin' | 'system'

type AnalyticsEventInput = {
  event_name: string
  user_type: AnalyticsUserType
  metadata?: Record<string, unknown>
}

type AnalyticsListQuery = {
  page: number
  page_size: number
  search?: string
  sort_by: 'created_at' | 'event_name' | 'user_type'
  sort_order: 'asc' | 'desc'
  days?: number
}

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

function escapeSearchTerm(term: string): string {
  return term.replace(/[%_]/g, '').replaceAll(',', ' ').trim()
}

export async function createAnalyticsEvent(input: AnalyticsEventInput) {
  const { data, error } = await supabaseAdmin
    .from('analytics_events')
    .insert({
      event_name: input.event_name,
      user_type: input.user_type,
      metadata: input.metadata ?? {},
    })
    .select('id, event_name, user_type, metadata, created_at')
    .single()

  throwIfError(error, 'Failed to create analytics event')
  if (!data) {
    throw new AppError('Failed to create analytics event', 500)
  }
  return data
}

export async function listAnalyticsEvents(query: AnalyticsListQuery) {
  const from = (query.page - 1) * query.page_size
  const to = from + query.page_size - 1

  let request = supabaseAdmin
    .from('analytics_events')
    .select('id, event_name, user_type, metadata, created_at', { count: 'exact' })
    .order(query.sort_by, { ascending: query.sort_order === 'asc' })
    .range(from, to)

  if (query.search && query.search.trim().length > 0) {
    const escaped = escapeSearchTerm(query.search)
    if (escaped.length > 0) {
      request = request.or(`event_name.ilike.%${escaped}%,user_type.ilike.%${escaped}%`)
    }
  }

  if (typeof query.days === 'number' && query.days > 0) {
    const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000).toISOString()
    request = request.gte('created_at', since)
  }

  const { data, error, count } = await request
  throwIfError(error, 'Failed to list analytics events')

  return {
    items: data ?? [],
    total: count ?? 0,
  }
}

export async function summarizeAnalytics(days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabaseAdmin
    .from('analytics_events')
    .select('event_name, user_type, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1000)

  throwIfError(error, 'Failed to summarize analytics events')

  const byEvent = new Map<string, number>()
  const byUserType = new Map<string, number>()

  for (const event of data ?? []) {
    byEvent.set(event.event_name, (byEvent.get(event.event_name) ?? 0) + 1)
    byUserType.set(event.user_type, (byUserType.get(event.user_type) ?? 0) + 1)
  }

  return {
    total_events: (data ?? []).length,
    by_event: Array.from(byEvent.entries())
      .map(([event_name, count]) => ({ event_name, count }))
      .sort((a, b) => b.count - a.count),
    by_user_type: Array.from(byUserType.entries())
      .map(([user_type, count]) => ({ user_type, count }))
      .sort((a, b) => b.count - a.count),
  }
}
