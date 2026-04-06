import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/db.js'
import { dispatchAutomationJobs } from './automation/core/dispatcherService.js'
import { listAutomationJobs, queueAutomationJob, queueEventAutomationJob, queueScheduledAutomationJobs } from './automation/core/jobQueueService.js'
import { listAutomationRegistryEntries } from './automation/core/registry.js'
import { type AutomationRunStatus } from './automation/core/types.js'
import { automationJobCatalog, isAutomationJobType, type AutomationJobType } from './automation/jobTypes.js'

type ListAutomationRunsInput = {
  page: number
  page_size: number
  flow_name?: string
  status?: AutomationRunStatus
  organization_id?: string
}

type ListAutomationErrorsInput = {
  page: number
  page_size: number
  flow_name?: string
  organization_id?: string
}

type ListAutomationJobsInput = {
  page: number
  page_size: number
  job_type?: string
  lifecycle_status?: string
  organization_id?: string
}

export async function enqueueAutomationJob(input: {
  jobType: AutomationJobType
  dedupeKey: string
  organizationId?: string | null
  ownerId?: string | null
  runAt?: string
  payload?: Record<string, unknown>
}) {
  return queueAutomationJob({
    jobType: input.jobType,
    dedupeKey: input.dedupeKey,
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    runAt: input.runAt,
    payload: input.payload,
    triggerType: 'manual',
  })
}

export async function enqueueEventDrivenAutomationJob(input: {
  jobType: AutomationJobType
  dedupeKey: string
  organizationId?: string | null
  ownerId?: string | null
  payload?: Record<string, unknown>
  sourceType: string
  sourceRef: string
  runAt?: string
}) {
  return queueEventAutomationJob(input)
}

export async function enqueueCashFlowRefreshJob(input: {
  organizationId: string
  ownerId: string
  sourceType: string
  sourceRef: string
  year?: number
  month?: number
  scope?: 'current' | 'monthly' | 'annual'
}) {
  return enqueueEventDrivenAutomationJob({
    jobType: 'cash_flow_refresh',
    dedupeKey: `cash_flow_refresh:${input.ownerId}:${input.sourceType}:${input.sourceRef}:${input.scope ?? 'current'}:${input.year ?? 'na'}-${input.month ?? 'na'}`,
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef,
    payload: { organization_id: input.organizationId, owner_id: input.ownerId, scope: input.scope ?? 'current', year: input.year, month: input.month },
  })
}

export async function enqueueMaintenanceFollowUpJob(input: {
  organizationId: string
  ownerId: string
  workflowId: string
  ticketId: string
  runAt: string
}) {
  return enqueueEventDrivenAutomationJob({
    jobType: 'maintenance_follow_up_check',
    dedupeKey: `maintenance_follow_up:${input.workflowId}:${input.runAt}`,
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    sourceType: 'maintenance_workflow',
    sourceRef: input.workflowId,
    runAt: input.runAt,
    payload: { workflow_id: input.workflowId, organization_id: input.organizationId, owner_id: input.ownerId, ticket_id: input.ticketId },
  })
}

export async function enqueueVacancyCampaignRefreshJob(input: {
  organizationId: string
  ownerId: string
  propertyId: string
  tenantId?: string | null
  sourceType: 'tenant_notice' | 'lease_expiry' | 'manual'
  expectedVacancyDate: string
  triggerReference?: string | null
  triggerNotes?: string | null
  vacancyState?: 'pre_vacant' | 'vacant' | 'relisting_in_progress'
}) {
  return enqueueEventDrivenAutomationJob({
    jobType: 'vacancy_campaign_refresh',
    dedupeKey: `vacancy_campaign_refresh:${input.propertyId}:${input.sourceType}:${input.expectedVacancyDate}`,
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    sourceType: 'vacancy_campaign',
    sourceRef: input.triggerReference ?? input.propertyId,
    payload: { organization_id: input.organizationId, owner_id: input.ownerId, property_id: input.propertyId, tenant_id: input.tenantId ?? null, source_type: input.sourceType, expected_vacancy_date: input.expectedVacancyDate, trigger_reference: input.triggerReference ?? null, trigger_notes: input.triggerNotes ?? null, vacancy_state: input.vacancyState },
  })
}

export async function ensureScheduledAutomationJobs(now = new Date()) {
  return queueScheduledAutomationJobs(now)
}

export async function ensureDailyAutomationJobs(now = new Date()) {
  return ensureScheduledAutomationJobs(now)
}

export async function dispatchPendingAutomationJobs(input?: { limit?: number; now?: Date }) {
  return dispatchAutomationJobs(input)
}

export async function getAutomationHealth() {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const [queuedCount, runningCount, failedCount, skippedCount, lastRun, lastError, jobsSnapshot, runs24h, errors24h] = await Promise.all([
    prisma.automation_jobs.count({ where: { lifecycle_status: 'queued' } }),
    prisma.automation_jobs.count({ where: { lifecycle_status: 'running' } }),
    prisma.automation_jobs.count({ where: { lifecycle_status: 'failed' } }),
    prisma.automation_jobs.count({ where: { lifecycle_status: 'skipped' } }),
    prisma.automation_runs.findFirst({ select: { id: true, flow_name: true, status: true, completed_at: true }, orderBy: { completed_at: 'desc' } }),
    prisma.automation_errors.findFirst({ select: { id: true, flow_name: true, error_message: true, created_at: true }, orderBy: { created_at: 'desc' } }),
    prisma.automation_jobs.findMany({ select: { job_type: true, lifecycle_status: true } }),
    prisma.automation_runs.count({ where: { started_at: { gte: dayAgo } } }),
    prisma.automation_errors.count({ where: { created_at: { gte: dayAgo } } }),
  ])

  const queuedByFlow = new Map<AutomationJobType, { queued: number; running: number; failed: number; skipped: number }>()
  for (const jobType of Object.keys(automationJobCatalog) as AutomationJobType[]) {
    queuedByFlow.set(jobType, { queued: 0, running: 0, failed: 0, skipped: 0 })
  }

  for (const row of jobsSnapshot) {
    const jobType = row.job_type
    const lifecycleStatus = row.lifecycle_status as string | null
    if (!jobType || !lifecycleStatus || !isAutomationJobType(jobType)) continue

    const aggregate = queuedByFlow.get(jobType as AutomationJobType)
    if (!aggregate) continue

    if (lifecycleStatus === 'queued' || lifecycleStatus === 'running' || lifecycleStatus === 'failed' || lifecycleStatus === 'skipped') {
      aggregate[lifecycleStatus as 'queued' | 'running' | 'failed' | 'skipped'] += 1
    }
  }

  return {
    pending_jobs: queuedCount,
    processing_jobs: runningCount,
    failed_jobs: failedCount,
    skipped_jobs: skippedCount,
    runs_last_24h: runs24h,
    errors_last_24h: errors24h,
    registered_handlers: listAutomationRegistryEntries().length,
    queued_by_flow: Array.from(queuedByFlow.entries()).map(([jobType, counts]) => ({
      job_type: jobType,
      label: automationJobCatalog[jobType].label,
      cadence: automationJobCatalog[jobType].cadence,
      phase: automationJobCatalog[jobType].phase,
      pending: counts.queued,
      processing: counts.running,
      failed: counts.failed,
      skipped: counts.skipped,
      description: automationJobCatalog[jobType].description,
    })),
    handlers: listAutomationRegistryEntries(),
    last_run: lastRun ?? null,
    last_error: lastError ?? null,
  }
}

export async function listAutomationRuns(query: ListAutomationRunsInput) {
  const skip = (query.page - 1) * query.page_size

  const where: Record<string, unknown> = {}
  if (query.flow_name) where.flow_name = query.flow_name
  if (query.status) where.status = query.status
  if (query.organization_id) where.organization_id = query.organization_id

  const [items, total] = await prisma.$transaction([
    prisma.automation_runs.findMany({ select: { id: true, job_id: true, organization_id: true, owner_id: true, flow_name: true, status: true, started_at: true, completed_at: true, processed_count: true, metadata: true }, where, orderBy: { started_at: 'desc' }, skip, take: query.page_size }),
    prisma.automation_runs.count({ where }),
  ])

  return { items, total }
}

export async function listAutomationErrors(query: ListAutomationErrorsInput) {
  const skip = (query.page - 1) * query.page_size

  const where: Record<string, unknown> = {}
  if (query.flow_name) where.flow_name = query.flow_name
  if (query.organization_id) where.organization_id = query.organization_id

  const [items, total] = await prisma.$transaction([
    prisma.automation_errors.findMany({ select: { id: true, run_id: true, job_id: true, organization_id: true, owner_id: true, flow_name: true, error_message: true, context: true, created_at: true }, where, orderBy: { created_at: 'desc' }, skip, take: query.page_size }),
    prisma.automation_errors.count({ where }),
  ])

  return { items, total }
}

export async function listQueuedAutomationJobs(query: ListAutomationJobsInput) {
  return listAutomationJobs(query)
}
