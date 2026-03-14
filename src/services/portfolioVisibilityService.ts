import type { PostgrestError } from '@supabase/supabase-js'

import { sendOwnerPortfolioSummaryNotification } from '../lib/mailer.js'
import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { createOwnerNotification, getOwnerDashboardSummary } from './ownerService.js'

type OwnerRow = {
  id: string
  email: string
  full_name: string | null
  company_name: string | null
  support_email: string | null
  organization_id: string
  owner_automation_settings?:
    | Array<{
        daily_digest_enabled: boolean
        portfolio_visibility_enabled: boolean
      }>
    | null
}

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

function ownerDisplayName(owner: OwnerRow): string {
  return owner.full_name || owner.company_name || owner.email
}

function uniqueRecipientEmails(owner: OwnerRow): string[] {
  return [owner.email, owner.support_email]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .filter((value, index, list) => list.indexOf(value) === index)
}

function isDailyDigestEnabled(owner: OwnerRow): boolean {
  const settings = owner.owner_automation_settings?.[0]
  if (!settings) {
    return true
  }

  return settings.portfolio_visibility_enabled && settings.daily_digest_enabled
}

function hasMeaningfulSignal(summary: {
  open_tickets: number
  overdue_rent: number
  reminders_pending: number
  unread_notifications: number
  awaiting_approvals: number
}) {
  return (
    summary.open_tickets > 0 ||
    summary.overdue_rent > 0 ||
    summary.reminders_pending > 0 ||
    summary.unread_notifications > 0 ||
    summary.awaiting_approvals > 0
  )
}

export async function runDailyPortfolioVisibility(now = new Date()) {
  const { data, error } = await supabaseAdmin
    .from('owners')
    .select(
      'id, email, full_name, company_name, support_email, organization_id, owner_automation_settings(daily_digest_enabled, portfolio_visibility_enabled)',
    )

  throwIfError(error, 'Failed to load owners for portfolio visibility')

  const owners = (data ?? []) as OwnerRow[]

  let ownersEvaluated = 0
  let digestsSent = 0
  let skippedQuiet = 0

  for (const owner of owners) {
    if (!isDailyDigestEnabled(owner)) {
      continue
    }

    ownersEvaluated += 1
    const summary = await getOwnerDashboardSummary(owner.organization_id, owner.id)

    if (!hasMeaningfulSignal(summary)) {
      skippedQuiet += 1
      continue
    }

    await createOwnerNotification({
      organization_id: owner.organization_id,
      owner_id: owner.id,
      notification_type: 'portfolio_daily_brief',
      title: 'Daily portfolio briefing',
      message: `Open tickets: ${summary.open_tickets}, overdue rent: ${summary.overdue_rent}, awaiting approvals: ${summary.awaiting_approvals}.`,
    })

    const recipients = uniqueRecipientEmails(owner)
    if (recipients.length > 0) {
      try {
        await sendOwnerPortfolioSummaryNotification({
          to: recipients.join(', '),
          ownerName: ownerDisplayName(owner),
          summary,
          generatedAtLabel: new Intl.DateTimeFormat('en-GB', {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(now),
        })
      } catch (mailError) {
        console.error('[runDailyPortfolioVisibility] email failed', {
          ownerId: owner.id,
          error: mailError,
        })
      }
    }

    digestsSent += 1
  }

  return {
    owners_evaluated: ownersEvaluated,
    digests_sent: digestsSent,
    skipped_quiet: skippedQuiet,
  }
}
