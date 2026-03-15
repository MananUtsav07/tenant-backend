/**
 * Automation job types are centralized here so scheduling, dispatch, admin
 * visibility, and future provider/webhook integrations all use the same names.
 */

export const automationJobTypes = [
  'compliance_scan',
  'rent_chase_scan',
  'portfolio_daily_digest',
  'portfolio_weekly_digest',
  'portfolio_monthly_digest',
  'cash_flow_monthly_report',
  'cash_flow_refresh',
  'maintenance_follow_up_check',
  'vacancy_reletting_scan',
  'vacancy_campaign_refresh',
] as const

export type AutomationJobType = (typeof automationJobTypes)[number]

export const automationJobCatalog: Record<
  AutomationJobType,
  {
    label: string
    phase: 'phase_1' | 'phase_2' | 'phase_3' | 'phase_4'
    cadence: 'daily' | 'weekly' | 'monthly' | 'event'
    description: string
  }
> = {
  compliance_scan: {
    label: 'Compliance Scan',
    phase: 'phase_2',
    cadence: 'daily',
    description: 'Evaluates legal renewal dates and sends milestone alerts.',
  },
  rent_chase_scan: {
    label: 'Rent Chase Scan',
    phase: 'phase_2',
    cadence: 'daily',
    description: 'Refreshes rent ledger state and triggers reminder processing.',
  },
  portfolio_daily_digest: {
    label: 'Portfolio Daily Digest',
    phase: 'phase_2',
    cadence: 'daily',
    description: 'Sends owner daily operational briefings when meaningful signals exist.',
  },
  portfolio_weekly_digest: {
    label: 'Portfolio Weekly Digest',
    phase: 'phase_2',
    cadence: 'weekly',
    description: 'Sends weekly portfolio visibility summaries to owners.',
  },
  portfolio_monthly_digest: {
    label: 'Portfolio Monthly Digest',
    phase: 'phase_2',
    cadence: 'monthly',
    description: 'Sends month-end portfolio visibility summaries to owners.',
  },
  cash_flow_monthly_report: {
    label: 'Cash Flow Monthly Report',
    phase: 'phase_2',
    cadence: 'monthly',
    description: 'Builds owner cash-flow and yield summaries from rent ledger data.',
  },
  cash_flow_refresh: {
    label: 'Cash Flow Refresh',
    phase: 'phase_2',
    cadence: 'event',
    description: 'Refreshes current cash-flow snapshots when rent or maintenance events change the books.',
  },
  maintenance_follow_up_check: {
    label: 'Maintenance Follow-up Check',
    phase: 'phase_3',
    cadence: 'event',
    description: 'Alerts owners when assigned contractor work remains unresolved after the follow-up window.',
  },
  vacancy_reletting_scan: {
    label: 'Vacancy Re-letting Scan',
    phase: 'phase_4',
    cadence: 'daily',
    description: 'Detects upcoming vacancy, advances re-letting campaigns, and sends owner status updates.',
  },
  vacancy_campaign_refresh: {
    label: 'Vacancy Campaign Refresh',
    phase: 'phase_4',
    cadence: 'event',
    description: 'Refreshes a single vacancy campaign when notice, lease, or manual events occur.',
  },
}

export function isAutomationJobType(value: string): value is AutomationJobType {
  return automationJobTypes.includes(value as AutomationJobType)
}
