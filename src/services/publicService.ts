import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

export async function createContactMessage(input: { name: string; email: string; message: string }) {
  const { data, error } = await supabaseAdmin
    .from('contact_messages')
    .insert({
      name: input.name,
      email: input.email,
      message: input.message,
    })
    .select('id, created_at')
    .single()

  throwIfError(error, 'Failed to create contact message')
  if (!data) {
    throw new AppError('Failed to create contact message', 500)
  }
  return data
}

function getDueDaysForNextWeek(referenceDate: Date): number[] {
  const uniqueDays = new Set<number>()
  for (let offset = 0; offset < 7; offset += 1) {
    const upcoming = new Date(referenceDate)
    upcoming.setUTCDate(referenceDate.getUTCDate() + offset)
    uniqueDays.add(upcoming.getUTCDate())
  }
  return Array.from(uniqueDays)
}

export async function getPublicOperationsSnapshot() {
  const dueDays = getDueDaysForNextWeek(new Date())

  const [openTicketsResult, activeTenantsResult, dueThisWeekResult] = await Promise.all([
    supabaseAdmin
      .from('support_tickets')
      .select('id', { count: 'exact', head: true })
      .in('status', ['open', 'in_progress']),
    supabaseAdmin
      .from('tenants')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabaseAdmin
      .from('tenants')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .in('payment_due_day', dueDays),
  ])

  throwIfError(openTicketsResult.error, 'Failed to count open tickets')
  throwIfError(activeTenantsResult.error, 'Failed to count active tenants')
  throwIfError(dueThisWeekResult.error, 'Failed to count due this week')

  return {
    open_tickets: openTicketsResult.count ?? 0,
    active_tenants: activeTenantsResult.count ?? 0,
    due_this_week: dueThisWeekResult.count ?? 0,
    generated_at: new Date().toISOString(),
  }
}
