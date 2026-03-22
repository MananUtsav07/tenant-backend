import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../../../lib/errors.js'
import { supabaseAdmin } from '../../../lib/supabase.js'
import { attachCashFlowSnapshotsToRun } from '../cashFlowReportService.js'
import { attachComplianceAlertEventsToRun } from '../../complianceService.js'
import { attachPortfolioVisibilitySnapshotsToRun } from '../../portfolioVisibilityService.js'
import { getAutomationJobHandler } from './registry.js'
import { recordAutomationError, recordAutomationRun } from './runLogger.js'
import {
  lifecycleToLegacyStatus,
  type AutomationHandlerResult,
  type AutomationJobLifecycleStatus,
  type AutomationJobRecord,
} from './types.js'

const automationJobSelect = [
  'id',
  'organization_id',
  'owner_id',
  'job_type',
  'handler_key',
  'trigger_type',
  'dedupe_key',
  'payload',
  'run_at',
  'next_run_at',
  'lifecycle_status',
  'status',
  'attempts',
  'retry_count',
  'max_attempts',
  'last_error',
  'last_error_code',
  'locked_at',
  'started_at',
  'finished_at',
  'processed_at',
  'source_type',
  'source_ref',
].join(', ')

function throwIfError(error: PostgrestError | null, message: string) {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

function toUpdateStatus(status: AutomationJobLifecycleStatus) {
  return {
    lifecycle_status: status,
    status: lifecycleToLegacyStatus(status),
  }
}

function calculateRetryAt(now: Date, attemptNumber: number) {
  const minutes = Math.min(30, Math.max(5, attemptNumber * 5))
  return new Date(now.getTime() + minutes * 60 * 1000).toISOString()
}

async function finalizeJob(input: {
  jobId: string
  lifecycleStatus: AutomationJobLifecycleStatus
  lastError?: string | null
  finishedAt?: string | null
  processedAt?: string | null
  nextRunAt?: string | null
  clearLock?: boolean
}) {
  const { error } = await supabaseAdmin
    .from('automation_jobs')
    .update({
      ...toUpdateStatus(input.lifecycleStatus),
      last_error: input.lastError ?? null,
      finished_at: input.finishedAt ?? null,
      processed_at: input.processedAt ?? null,
      next_run_at: input.nextRunAt ?? undefined,
      run_at: input.nextRunAt ?? undefined,
      locked_at: input.clearLock === false ? undefined : null,
    })
    .eq('id', input.jobId)

  throwIfError(error, 'Failed to update automation job status')
}

function mapRunStatus(result: AutomationHandlerResult) {
  if (result.status === 'skipped') {
    return 'skipped' as const
  }

  return 'success' as const
}

async function bindRunArtifacts(runId: string, metadata: Record<string, unknown>) {
  const complianceAlertEventIds = metadata.compliance_alert_event_ids
  if (
    Array.isArray(complianceAlertEventIds) &&
    complianceAlertEventIds.every((value) => typeof value === 'string' && value.length > 0)
  ) {
    await attachComplianceAlertEventsToRun(complianceAlertEventIds as string[], runId)
  }

  const cashFlowSnapshotIds = metadata.cash_flow_snapshot_ids
  if (Array.isArray(cashFlowSnapshotIds) && cashFlowSnapshotIds.every((value) => typeof value === 'string' && value.length > 0)) {
    await attachCashFlowSnapshotsToRun(cashFlowSnapshotIds as string[], runId)
  }

  const portfolioVisibilitySnapshotIds = metadata.portfolio_visibility_snapshot_ids
  if (
    Array.isArray(portfolioVisibilitySnapshotIds) &&
    portfolioVisibilitySnapshotIds.every((value) => typeof value === 'string' && value.length > 0)
  ) {
    await attachPortfolioVisibilitySnapshotsToRun(portfolioVisibilitySnapshotIds as string[], runId)
  }
}

export async function dispatchAutomationJobs(input?: { limit?: number; now?: Date }) {
  const limit = input?.limit ?? 20
  const now = input?.now ?? new Date()
  const nowIso = now.toISOString()

  const { data, error } = await supabaseAdmin
    .from('automation_jobs')
    .select(automationJobSelect)
    .eq('lifecycle_status', 'queued')
    .lte('next_run_at', nowIso)
    .order('next_run_at', { ascending: true })
    .limit(limit)

  throwIfError(error, 'Failed to load queued automation jobs')

  let claimed = 0
  let succeeded = 0
  let failed = 0
  let retried = 0
  let skipped = 0

  const jobs = (data ?? []) as unknown as AutomationJobRecord[]

  for (const candidate of jobs) {
    const nextAttemptCount = candidate.attempts + 1

    const { data: claimedJob, error: claimError } = await supabaseAdmin
      .from('automation_jobs')
      .update({
        ...toUpdateStatus('running'),
        locked_at: nowIso,
        started_at: nowIso,
        attempts: nextAttemptCount,
        retry_count: nextAttemptCount,
        last_error: null,
        last_error_code: null,
      })
      .eq('id', candidate.id)
      .eq('lifecycle_status', 'queued')
      .select(automationJobSelect)
      .maybeSingle()

    throwIfError(claimError, 'Failed to claim automation job')

    if (!claimedJob) {
      continue
    }

    claimed += 1
    const job = claimedJob as unknown as AutomationJobRecord
    const startedAt = nowIso

    try {
      const handler = getAutomationJobHandler(job.job_type)
      if (!handler) {
        throw new AppError(`No automation handler registered for ${job.job_type}`, 500)
      }

      const result = await handler.handle({ job, now })
      const completedAt = new Date().toISOString()
      const terminalStatus = result.status === 'skipped' ? 'skipped' : 'succeeded'

      await finalizeJob({
        jobId: job.id,
        lifecycleStatus: terminalStatus,
        finishedAt: completedAt,
        processedAt: completedAt,
      })

      const runRecord = await recordAutomationRun({
        jobId: job.id,
        organizationId: job.organization_id,
        ownerId: job.owner_id,
        flowName: job.job_type,
        status: mapRunStatus(result),
        startedAt,
        completedAt,
        processedCount: result.processedCount ?? 0,
        metadata: {
          ...(result.metadata ?? {}),
          execution_status: result.status,
          skip_reason: result.reason ?? null,
        },
      })

      await bindRunArtifacts(runRecord.id, {
        ...(result.metadata ?? {}),
        execution_status: result.status,
        skip_reason: result.reason ?? null,
      })

      if (result.status === 'skipped') {
        skipped += 1
      } else {
        succeeded += 1
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown automation failure'
      const maxAttempts = job.max_attempts
      const shouldRetry = nextAttemptCount < maxAttempts
      const completedAt = new Date().toISOString()

      if (shouldRetry) {
        const retryAt = calculateRetryAt(now, nextAttemptCount)
        await finalizeJob({
          jobId: job.id,
          lifecycleStatus: 'queued',
          lastError: errorMessage,
          nextRunAt: retryAt,
          finishedAt: null,
          processedAt: null,
        })
      } else {
        await finalizeJob({
          jobId: job.id,
          lifecycleStatus: 'failed',
          lastError: errorMessage,
          finishedAt: completedAt,
          processedAt: completedAt,
        })
      }

      const runRecord = await recordAutomationRun({
        jobId: job.id,
        organizationId: job.organization_id,
        ownerId: job.owner_id,
        flowName: job.job_type,
        status: shouldRetry ? 'partial' : 'failed',
        startedAt,
        completedAt,
        processedCount: 0,
        metadata: {
          error: errorMessage,
          retried: shouldRetry,
          retry_count: nextAttemptCount,
          max_attempts: maxAttempts,
        },
      })

      await bindRunArtifacts(runRecord.id, {
        error: errorMessage,
        retried: shouldRetry,
        retry_count: nextAttemptCount,
        max_attempts: maxAttempts,
      })

      await recordAutomationError({
        jobId: job.id,
        organizationId: job.organization_id,
        ownerId: job.owner_id,
        flowName: job.job_type,
        errorMessage,
        context: {
          retry_count: nextAttemptCount,
          max_attempts: maxAttempts,
          retried: shouldRetry,
          source_type: job.source_type,
          source_ref: job.source_ref,
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
    skipped,
    failed,
    retried,
  }
}
