import { runComplianceAlerts } from '../../complianceService.js'
import { runMaintenanceFollowUpCheck } from '../../maintenanceWorkflowService.js'
import {
  runDailyPortfolioVisibility,
  runMonthlyPortfolioVisibility,
  runWeeklyPortfolioVisibility,
} from '../../portfolioVisibilityService.js'
import { runRentChasing } from '../../rentChasingService.js'
import { runDailyVacancyReletting, runVacancyCampaignRefresh } from '../../vacancyWorkflowService.js'
import { runCashFlowRefresh, runMonthlyCashFlowReports } from '../cashFlowReportService.js'
import { automationJobCatalog, type AutomationJobType } from '../jobTypes.js'
import type { AutomationHandlerContext, AutomationJobHandler } from './types.js'

const automationRegistry: Record<AutomationJobType, AutomationJobHandler> = {
  compliance_scan: {
    key: 'compliance_scan',
    async handle(context: AutomationHandlerContext) {
      const metadata = await runComplianceAlerts(context.now, { jobId: context.job.id })
      return {
        status: 'succeeded',
        processedCount: 1,
        metadata,
      }
    },
  },
  rent_chase_scan: {
    key: 'rent_chase_scan',
    async handle(context: AutomationHandlerContext) {
      const metadata = await runRentChasing(context.now)
      return {
        status: 'succeeded',
        processedCount: 1,
        metadata,
      }
    },
  },
  portfolio_daily_digest: {
    key: 'portfolio_daily_digest',
    async handle(context: AutomationHandlerContext) {
      const metadata = await runDailyPortfolioVisibility(context.now, { jobId: context.job.id })
      return {
        status: 'succeeded',
        processedCount: 1,
        metadata,
      }
    },
  },
  portfolio_weekly_digest: {
    key: 'portfolio_weekly_digest',
    async handle(context: AutomationHandlerContext) {
      const metadata = await runWeeklyPortfolioVisibility(context.now, { jobId: context.job.id })
      return {
        status: 'succeeded',
        processedCount: 1,
        metadata,
      }
    },
  },
  portfolio_monthly_digest: {
    key: 'portfolio_monthly_digest',
    async handle(context: AutomationHandlerContext) {
      const metadata = await runMonthlyPortfolioVisibility(context.now, { jobId: context.job.id })
      return {
        status: 'succeeded',
        processedCount: 1,
        metadata,
      }
    },
  },
  cash_flow_monthly_report: {
    key: 'cash_flow_monthly_report',
    async handle(context: AutomationHandlerContext) {
      const metadata = await runMonthlyCashFlowReports(context.now, { jobId: context.job.id })
      return {
        status: 'succeeded',
        processedCount: 1,
        metadata,
      }
    },
  },
  cash_flow_refresh: {
    key: 'cash_flow_refresh',
    async handle(context: AutomationHandlerContext) {
      const payload = (context.job.payload ?? {}) as {
        owner_id?: string
        organization_id?: string
        year?: number
        month?: number
        scope?: 'current' | 'monthly' | 'annual'
      }

      if (!payload.owner_id || !payload.organization_id) {
        return {
          status: 'skipped',
          processedCount: 0,
          metadata: {
            reason: 'missing_owner_or_organization',
          },
        }
      }

      const metadata = await runCashFlowRefresh({
        ownerId: payload.owner_id,
        organizationId: payload.organization_id,
        year: payload.year,
        month: payload.month,
        scope: payload.scope,
        now: context.now,
        triggerType: 'event',
        automationJobId: context.job.id,
      })
      return {
        status: metadata.skipped ? 'skipped' : 'succeeded',
        processedCount: metadata.skipped ? 0 : 1,
        metadata,
      }
    },
  },
  maintenance_follow_up_check: {
    key: 'maintenance_follow_up_check',
    async handle(context: AutomationHandlerContext) {
      const payload = (context.job.payload ?? {}) as {
        workflow_id?: string
        organization_id?: string
        owner_id?: string
      }

      if (!payload.workflow_id || !payload.organization_id || !payload.owner_id) {
        return {
          status: 'skipped',
          processedCount: 0,
          metadata: {
            reason: 'missing_workflow_owner_or_organization',
          },
        }
      }

      const metadata = await runMaintenanceFollowUpCheck({
        workflowId: payload.workflow_id,
        organizationId: payload.organization_id,
        ownerId: payload.owner_id,
        now: context.now,
      })

      return {
        status: metadata.skipped ? 'skipped' : 'succeeded',
        processedCount: metadata.skipped ? 0 : 1,
        metadata,
      }
    },
  },
  vacancy_reletting_scan: {
    key: 'vacancy_reletting_scan',
    async handle(context: AutomationHandlerContext) {
      const metadata = await runDailyVacancyReletting(context.now, { jobId: context.job.id })
      return {
        status: 'succeeded',
        processedCount: 1,
        metadata,
      }
    },
  },
  vacancy_campaign_refresh: {
    key: 'vacancy_campaign_refresh',
    async handle(context: AutomationHandlerContext) {
      const payload = (context.job.payload ?? {}) as {
        organization_id?: string
        owner_id?: string
        property_id?: string
        tenant_id?: string | null
        source_type?: 'tenant_notice' | 'lease_expiry' | 'manual'
        expected_vacancy_date?: string
        trigger_reference?: string | null
        trigger_notes?: string | null
        vacancy_state?: 'pre_vacant' | 'vacant' | 'relisting_in_progress'
      }

      if (!payload.organization_id || !payload.owner_id || !payload.property_id || !payload.source_type || !payload.expected_vacancy_date) {
        return {
          status: 'skipped',
          processedCount: 0,
          metadata: {
            reason: 'missing_vacancy_campaign_payload',
          },
        }
      }

      const metadata = await runVacancyCampaignRefresh({
        organizationId: payload.organization_id,
        ownerId: payload.owner_id,
        propertyId: payload.property_id,
        tenantId: payload.tenant_id ?? null,
        sourceType: payload.source_type,
        expectedVacancyDate: payload.expected_vacancy_date,
        triggerReference: payload.trigger_reference ?? null,
        triggerNotes: payload.trigger_notes ?? null,
        vacancyState: payload.vacancy_state,
        now: context.now,
        automationJobId: context.job.id,
      })

      return {
        status: 'succeeded',
        processedCount: 1,
        metadata,
      }
    },
  },
}

export function getAutomationJobHandler(jobType: AutomationJobType) {
  return automationRegistry[jobType]
}

export function listAutomationRegistryEntries() {
  return (Object.keys(automationRegistry) as AutomationJobType[]).map((jobType) => ({
    job_type: jobType,
    handler_key: automationRegistry[jobType].key,
    ...automationJobCatalog[jobType],
  }))
}
