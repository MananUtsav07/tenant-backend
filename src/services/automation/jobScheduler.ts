import type { AutomationJobType } from './jobTypes.js'

export type ScheduledAutomationJobDefinition = {
  jobType: AutomationJobType
  dedupeKey: string
  runAt: string
  payload: Record<string, unknown>
}

function toDateKey(now: Date) {
  return now.toISOString().slice(0, 10)
}

function toMonthKey(now: Date) {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function toIsoWeekKey(now: Date) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const day = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

function isWeeklyDigestDay(now: Date) {
  // Monday UTC
  return now.getUTCDay() === 1
}

function isMonthlyDigestDay(now: Date) {
  return now.getUTCDate() === 1
}

/**
 * Builds the deterministic job set for the current tick. The engine stays
 * responsible for enqueueing/deduping; this module only defines cadence.
 */
export function buildScheduledAutomationJobs(now = new Date()): ScheduledAutomationJobDefinition[] {
  const runAt = now.toISOString()
  const dateKey = toDateKey(now)
  const jobs: ScheduledAutomationJobDefinition[] = [
    {
      jobType: 'compliance_scan',
      dedupeKey: `compliance_scan:${dateKey}`,
      runAt,
      payload: { date_key: dateKey },
    },
    {
      jobType: 'rent_chase_scan',
      dedupeKey: `rent_chase_scan:${dateKey}`,
      runAt,
      payload: { date_key: dateKey },
    },
    {
      jobType: 'portfolio_daily_digest',
      dedupeKey: `portfolio_daily_digest:${dateKey}`,
      runAt,
      payload: { date_key: dateKey },
    },
    {
      jobType: 'vacancy_reletting_scan',
      dedupeKey: `vacancy_reletting_scan:${dateKey}`,
      runAt,
      payload: { date_key: dateKey },
    },
  ]

  if (isWeeklyDigestDay(now)) {
    const weekKey = toIsoWeekKey(now)
    jobs.push({
      jobType: 'portfolio_weekly_digest',
      dedupeKey: `portfolio_weekly_digest:${weekKey}`,
      runAt,
      payload: { week_key: weekKey },
    })
  }

  if (isMonthlyDigestDay(now)) {
    const monthKey = toMonthKey(now)
    jobs.push(
      {
        jobType: 'portfolio_monthly_digest',
        dedupeKey: `portfolio_monthly_digest:${monthKey}`,
        runAt,
        payload: { month_key: monthKey },
      },
      {
        jobType: 'cash_flow_monthly_report',
        dedupeKey: `cash_flow_monthly_report:${monthKey}`,
        runAt,
        payload: { month_key: monthKey },
      },
    )
  }

  return jobs
}
