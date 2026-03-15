import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'
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

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
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
    payload: {
      organization_id: input.organizationId,
      owner_id: input.ownerId,
      scope: input.scope ?? 'current',
      year: input.year,
      month: input.month,
    },
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
    payload: {
      workflow_id: input.workflowId,
      organization_id: input.organizationId,
      owner_id: input.ownerId,
      ticket_id: input.ticketId,
    },
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
    payload: {
      organization_id: input.organizationId,
      owner_id: input.ownerId,
      property_id: input.propertyId,
      tenant_id: input.tenantId ?? null,
      source_type: input.sourceType,
      expected_vacancy_date: input.expectedVacancyDate,
      trigger_reference: input.triggerReference ?? null,
      trigger_notes: input.triggerNotes ?? null,
      vacancy_state: input.vacancyState,
    },
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
  const dayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [
    queuedResult,
    runningResult,
    failedResult,
    skippedResult,
    lastRunResult,
    lastErrorResult,
    jobsSnapshotResult,
    runs24hResult,
    errors24hResult,
  ] = await Promise.all([
    supabaseAdmin.from('automation_jobs').select('id', { count: 'exact', head: true }).eq('lifecycle_status', 'queued'),
    supabaseAdmin.from('automation_jobs').select('id', { count: 'exact', head: true }).eq('lifecycle_status', 'running'),
    supabaseAdmin.from('automation_jobs').select('id', { count: 'exact', head: true }).eq('lifecycle_status', 'failed'),
    supabaseAdmin.from('automation_jobs').select('id', { count: 'exact', head: true }).eq('lifecycle_status', 'skipped'),
    supabaseAdmin
      .from('automation_runs')
      .select('id, flow_name, status, completed_at')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from('automation_errors')
      .select('id, flow_name, error_message, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin.from('automation_jobs').select('job_type, lifecycle_status'),
    supabaseAdmin.from('automation_runs').select('id', { count: 'exact', head: true }).gte('started_at', dayAgoIso),
    supabaseAdmin.from('automation_errors').select('id', { count: 'exact', head: true }).gte('created_at', dayAgoIso),
  ])

  throwIfError(queuedResult.error, 'Failed to count queued automation jobs')
  throwIfError(runningResult.error, 'Failed to count running automation jobs')
  throwIfError(failedResult.error, 'Failed to count failed automation jobs')
  throwIfError(skippedResult.error, 'Failed to count skipped automation jobs')
  throwIfError(lastRunResult.error, 'Failed to load latest automation run')
  throwIfError(lastErrorResult.error, 'Failed to load latest automation error')
  throwIfError(jobsSnapshotResult.error, 'Failed to load automation job snapshot')
  throwIfError(runs24hResult.error, 'Failed to count recent automation runs')
  throwIfError(errors24hResult.error, 'Failed to count recent automation errors')

  const queuedByFlow = new Map<AutomationJobType, { queued: number; running: number; failed: number; skipped: number }>()
  for (const jobType of Object.keys(automationJobCatalog) as AutomationJobType[]) {
    queuedByFlow.set(jobType, { queued: 0, running: 0, failed: 0, skipped: 0 })
  }

  for (const row of jobsSnapshotResult.data ?? []) {
    const jobType = (row as { job_type?: string }).job_type
    const lifecycleStatus = (row as { lifecycle_status?: string }).lifecycle_status
    if (!jobType || !lifecycleStatus || !isAutomationJobType(jobType)) {
      continue
    }

    const aggregate = queuedByFlow.get(jobType)
    if (!aggregate) {
      continue
    }

    if (lifecycleStatus === 'queued' || lifecycleStatus === 'running' || lifecycleStatus === 'failed' || lifecycleStatus === 'skipped') {
      aggregate[lifecycleStatus] += 1
    }
  }

  return {
    pending_jobs: queuedResult.count ?? 0,
    processing_jobs: runningResult.count ?? 0,
    failed_jobs: failedResult.count ?? 0,
    skipped_jobs: skippedResult.count ?? 0,
    runs_last_24h: runs24hResult.count ?? 0,
    errors_last_24h: errors24hResult.count ?? 0,
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
    last_run: lastRunResult.data ?? null,
    last_error: lastErrorResult.data ?? null,
  }
}

export async function listAutomationRuns(query: ListAutomationRunsInput) {
  const from = (query.page - 1) * query.page_size
  const to = from + query.page_size - 1

  let request = supabaseAdmin
    .from('automation_runs')
    .select('id, job_id, organization_id, owner_id, flow_name, status, started_at, completed_at, processed_count, metadata', {
      count: 'exact',
    })
    .order('started_at', { ascending: false })
    .range(from, to)

  if (query.flow_name) {
    request = request.eq('flow_name', query.flow_name)
  }

  if (query.status) {
    request = request.eq('status', query.status)
  }

  if (query.organization_id) {
    request = request.eq('organization_id', query.organization_id)
  }

  const { data, error, count } = await request
  throwIfError(error, 'Failed to list automation runs')

  return {
    items: data ?? [],
    total: count ?? 0,
  }
}

export async function listAutomationErrors(query: ListAutomationErrorsInput) {
  const from = (query.page - 1) * query.page_size
  const to = from + query.page_size - 1

  let request = supabaseAdmin
    .from('automation_errors')
    .select('id, run_id, job_id, organization_id, owner_id, flow_name, error_message, context, created_at', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (query.flow_name) {
    request = request.eq('flow_name', query.flow_name)
  }

  if (query.organization_id) {
    request = request.eq('organization_id', query.organization_id)
  }

  const { data, error, count } = await request
  throwIfError(error, 'Failed to list automation errors')

  return {
    items: data ?? [],
    total: count ?? 0,
  }
}

export async function listQueuedAutomationJobs(query: ListAutomationJobsInput) {
  return listAutomationJobs(query)
}
