import { prisma } from '../lib/db.js'
import type { Prisma } from '@prisma/client'

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

function escapeSearchTerm(term: string): string {
  return term.replace(/[%_]/g, '').replaceAll(',', ' ').trim()
}

const analyticsSelect = {
  id: true,
  event_name: true,
  user_type: true,
  metadata: true,
  created_at: true,
} satisfies Prisma.analytics_eventsSelect

export async function createAnalyticsEvent(input: AnalyticsEventInput) {
  return prisma.analytics_events.create({
    data: {
      event_name: input.event_name,
      user_type: input.user_type,
      metadata: (input.metadata ?? {}) as object,
    },
    select: analyticsSelect,
  })
}

export async function listAnalyticsEvents(query: AnalyticsListQuery) {
  const skip = (query.page - 1) * query.page_size

  const where: Prisma.analytics_eventsWhereInput = {}

  if (query.search && query.search.trim().length > 0) {
    const escaped = escapeSearchTerm(query.search)
    if (escaped.length > 0) {
      where.OR = [
        { event_name: { contains: escaped, mode: 'insensitive' } },
        { user_type: { contains: escaped, mode: 'insensitive' } },
      ]
    }
  }

  if (typeof query.days === 'number' && query.days > 0) {
    const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000)
    where.created_at = { gte: since }
  }

  const [items, total] = await prisma.$transaction([
    prisma.analytics_events.findMany({
      select: analyticsSelect,
      where,
      orderBy: { [query.sort_by]: query.sort_order },
      skip,
      take: query.page_size,
    }),
    prisma.analytics_events.count({ where }),
  ])

  return { items, total }
}

export async function summarizeAnalytics(days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const data = await prisma.analytics_events.findMany({
    select: { event_name: true, user_type: true, created_at: true },
    where: { created_at: { gte: since } },
    orderBy: { created_at: 'desc' },
    take: 1000,
  })

  const byEvent = new Map<string, number>()
  const byUserType = new Map<string, number>()

  for (const event of data) {
    byEvent.set(event.event_name, (byEvent.get(event.event_name) ?? 0) + 1)
    byUserType.set(event.user_type, (byUserType.get(event.user_type) ?? 0) + 1)
  }

  return {
    total_events: data.length,
    by_event: Array.from(byEvent.entries())
      .map(([event_name, count]) => ({ event_name, count }))
      .sort((a, b) => b.count - a.count),
    by_user_type: Array.from(byUserType.entries())
      .map(([user_type, count]) => ({ user_type, count }))
      .sort((a, b) => b.count - a.count),
  }
}
