import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'
import { runComplianceAlerts } from './complianceService.js'
import { runDailyPortfolioVisibility } from './portfolioVisibilityService.js'
import { runRentChasing } from './rentChasingService.js'

export type AutomationJobType = 'compliance_scan' | 'rent_chase_scan' | 'portfolio_daily_digest'

type AutomationJobRow = {
  id: string
  organization_id: string | null
  owner_id: string | null
  job_type: AutomationJobType
  dedupe_key: string
  payload: Record<string, unknown>
  run_at: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'canceled'
  attempts: number
  max_attempts: number
}

type ListAutomationRunsInput = {
  page: number
  page_size: number
  flow_name?: string
  status?: 'success' | 'failed' | 'partial'
  organization_id?: string
}

type ListAutomationErrorsInput = {
  page: number
  page_size: number
  flow_name?: string
  organization_id?: string
}

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

async function insertAutomationRun(input: {
  jobId: string
  organizationId: string | null
  ownerId: string | null
  flowName: string
  status: 'success' | 'failed' | 'partial'
  startedAt: string
  completedAt: string
  processedCount: number
  metadata: Record<string, unknown>
}) {
  const { error } = await supabaseAdmin.from('automation_runs').insert({
    job_id: input.jobId,
    organization_id: input.organizationId,
    owner_id: input.ownerId,
    flow_name: input.flowName,
    status: input.status,
    started_at: input.startedAt,
    completed_at: input.completedAt,
    processed_count: input.processedCount,
    metadata: input.metadata,
  })

  throwIfError(error, 'Failed to insert automation run record')
}

async function insertAutomationError(input: {
  jobId: string
  organizationId: string | null
  ownerId: string | null
  flowName: string
  errorMessage: string
  context: Record<string, unknown>
}) {
  const { error } = await supabaseAdmin.from('automation_errors').insert({
    job_id: input.jobId,
    organization_id: input.organizationId,
    owner_id: input.ownerId,
    flow_name: input.flowName,
    error_message: input.errorMessage,
    context: input.context,
  })

  throwIfError(error, 'Failed to insert automation error record')
}

async function executeJob(job: AutomationJobRow, now: Date) {
  if (job.job_type === 'compliance_scan') {
    return runComplianceAlerts(now)
  }

  if (job.job_type === 'rent_chase_scan') {
    return runRentChasing(now)
  }

  if (job.job_type === 'portfolio_daily_digest') {
    return runDailyPortfolioVisibility(now)
  }

  throw new AppError(`Unsupported automation job type: ${job.job_type}`, 400)
}

export async function enqueueAutomationJob(input: {
  jobType: AutomationJobType
  dedupeKey: string
  organizationId?: string | null
  ownerId?: string | null
  runAt?: string
  payload?: Record<string, unknown>
}) {
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('automation_jobs')
    .select('id, status')
    .eq('dedupe_key', input.dedupeKey)
    .maybeSingle()

  throwIfError(existingError, 'Failed to check existing automation job')

  if (existing) {
    return {
      created: false,
      job_id: existing.id,
      status: existing.status,
    }
  }

  const { data, error } = await supabaseAdmin
    .from('automation_jobs')
    .insert({
      organization_id: input.organizationId ?? null,
      owner_id: input.ownerId ?? null,
      job_type: input.jobType,
      dedupe_key: input.dedupeKey,
      payload: input.payload ?? {},
      run_at: input.runAt ?? new Date().toISOString(),
      status: 'pending',
      attempts: 0,
      max_attempts: 3,
    })
    .select('id, status')
    .single()

  throwIfError(error, 'Failed to enqueue automation job')
  if (!data) {
    throw new AppError('Failed to enqueue automation job', 500)
  }

  return {
    created: true,
    job_id: data.id as string,
    status: data.status as string,
  }
}

export async function ensureDailyAutomationJobs(now = new Date()) {
  const dateKey = now.toISOString().slice(0, 10)

  const [compliance, rentChase, dailyDigest] = await Promise.all([
    enqueueAutomationJob({
      jobType: 'compliance_scan',
      dedupeKey: `compliance_scan:${dateKey}`,
      payload: { date_key: dateKey },
      runAt: now.toISOString(),
    }),
    enqueueAutomationJob({
      jobType: 'rent_chase_scan',
      dedupeKey: `rent_chase_scan:${dateKey}`,
      payload: { date_key: dateKey },
      runAt: now.toISOString(),
    }),
    enqueueAutomationJob({
      jobType: 'portfolio_daily_digest',
      dedupeKey: `portfolio_daily_digest:${dateKey}`,
      payload: { date_key: dateKey },
      runAt: now.toISOString(),
    }),
  ])

  return {
    date_key: dateKey,
    jobs: [compliance, rentChase, dailyDigest],
    created_count: [compliance, rentChase, dailyDigest].filter((job) => job.created).length,
  }
}

export async function dispatchPendingAutomationJobs(input?: { limit?: number; now?: Date }) {
  const limit = input?.limit ?? 20
  const now = input?.now ?? new Date()
  const nowIso = now.toISOString()

  const { data, error } = await supabaseAdmin
    .from('automation_jobs')
    .select('id, organization_id, owner_id, job_type, dedupe_key, payload, run_at, status, attempts, max_attempts')
    .eq('status', 'pending')
    .lte('run_at', nowIso)
    .order('run_at', { ascending: true })
    .limit(limit)

  throwIfError(error, 'Failed to load pending automation jobs')

  let claimed = 0
  let succeeded = 0
  let failed = 0
  let retried = 0

  const jobs = (data ?? []) as AutomationJobRow[]

  for (const candidate of jobs) {
    const { data: claimedJob, error: claimError } = await supabaseAdmin
      .from('automation_jobs')
      .update({
        status: 'processing',
        locked_at: nowIso,
        attempts: candidate.attempts + 1,
        last_error: null,
      })
      .eq('id', candidate.id)
      .eq('status', 'pending')
      .select('id, organization_id, owner_id, job_type, dedupe_key, payload, run_at, status, attempts, max_attempts')
      .maybeSingle()

    throwIfError(claimError, 'Failed to claim automation job')

    if (!claimedJob) {
      continue
    }

    claimed += 1
    const startedAt = new Date().toISOString()

    try {
      const result = await executeJob(claimedJob as AutomationJobRow, now)

      const { error: completeError } = await supabaseAdmin
        .from('automation_jobs')
        .update({
          status: 'completed',
          processed_at: new Date().toISOString(),
          locked_at: null,
        })
        .eq('id', claimedJob.id)

      throwIfError(completeError, 'Failed to complete automation job')

      await insertAutomationRun({
        jobId: claimedJob.id as string,
        organizationId: (claimedJob.organization_id as string | null) ?? null,
        ownerId: (claimedJob.owner_id as string | null) ?? null,
        flowName: claimedJob.job_type as string,
        status: 'success',
        startedAt,
        completedAt: new Date().toISOString(),
        processedCount: 1,
        metadata: result as Record<string, unknown>,
      })

      succeeded += 1
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown automation failure'
      const nextAttemptCount = claimedJob.attempts as number
      const maxAttempts = claimedJob.max_attempts as number
      const shouldRetry = nextAttemptCount < maxAttempts

      const retryAt = new Date(now.getTime() + Math.min(15, nextAttemptCount * 5) * 60 * 1000).toISOString()

      const { error: failUpdateError } = await supabaseAdmin
        .from('automation_jobs')
        .update({
          status: shouldRetry ? 'pending' : 'failed',
          run_at: shouldRetry ? retryAt : claimedJob.run_at,
          locked_at: null,
          last_error: errorMessage,
          processed_at: shouldRetry ? null : new Date().toISOString(),
        })
        .eq('id', claimedJob.id)

      throwIfError(failUpdateError, 'Failed to update automation job failure state')

      await insertAutomationRun({
        jobId: claimedJob.id as string,
        organizationId: (claimedJob.organization_id as string | null) ?? null,
        ownerId: (claimedJob.owner_id as string | null) ?? null,
        flowName: claimedJob.job_type as string,
        status: shouldRetry ? 'partial' : 'failed',
        startedAt,
        completedAt: new Date().toISOString(),
        processedCount: 0,
        metadata: {
          error: errorMessage,
          retried: shouldRetry,
        },
      })

      await insertAutomationError({
        jobId: claimedJob.id as string,
        organizationId: (claimedJob.organization_id as string | null) ?? null,
        ownerId: (claimedJob.owner_id as string | null) ?? null,
        flowName: claimedJob.job_type as string,
        errorMessage,
        context: {
          attempts: nextAttemptCount,
          max_attempts: maxAttempts,
          retried: shouldRetry,
        },
      })

      if (shouldRetry) {
        retried += 1
      } else {
        failed += 1
      }
    }
  }

  return {
    scanned: jobs.length,
    claimed,
    succeeded,
    failed,
    retried,
  }
}

export async function getAutomationHealth() {
  const [pendingResult, processingResult, failedResult, lastRunResult, lastErrorResult] = await Promise.all([
    supabaseAdmin.from('automation_jobs').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    supabaseAdmin.from('automation_jobs').select('id', { count: 'exact', head: true }).eq('status', 'processing'),
    supabaseAdmin.from('automation_jobs').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
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
  ])

  throwIfError(pendingResult.error, 'Failed to count pending automation jobs')
  throwIfError(processingResult.error, 'Failed to count processing automation jobs')
  throwIfError(failedResult.error, 'Failed to count failed automation jobs')
  throwIfError(lastRunResult.error, 'Failed to load latest automation run')
  throwIfError(lastErrorResult.error, 'Failed to load latest automation error')

  return {
    pending_jobs: pendingResult.count ?? 0,
    processing_jobs: processingResult.count ?? 0,
    failed_jobs: failedResult.count ?? 0,
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
