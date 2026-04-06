import { AppError } from '../../../lib/errors.js'
import { prisma } from '../../../lib/db.js'
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

const automationJobSelect = {
  id: true,
  organization_id: true,
  owner_id: true,
  job_type: true,
  handler_key: true,
  trigger_type: true,
  dedupe_key: true,
  payload: true,
  run_at: true,
  next_run_at: true,
  lifecycle_status: true,
  status: true,
  attempts: true,
  retry_count: true,
  max_attempts: true,
  last_error: true,
  last_error_code: true,
  locked_at: true,
  started_at: true,
  finished_at: true,
  processed_at: true,
  source_type: true,
  source_ref: true,
}

function toUpdateStatus(status: AutomationJobLifecycleStatus) {
  return {
    lifecycle_status: status,
    status: lifecycleToLegacyStatus(status),
  }
}

function calculateRetryAt(now: Date, attemptNumber: number) {
  const minutes = Math.min(30, Math.max(5, attemptNumber * 5))
  return new Date(now.getTime() + minutes * 60 * 1000)
}

async function finalizeJob(input: {
  jobId: string
  lifecycleStatus: AutomationJobLifecycleStatus
  lastError?: string | null
  finishedAt?: Date | null
  processedAt?: Date | null
  nextRunAt?: Date | null
  clearLock?: boolean
}) {
  const updateData: Record<string, unknown> = {
    ...toUpdateStatus(input.lifecycleStatus),
    last_error: input.lastError ?? null,
    finished_at: input.finishedAt ?? null,
    processed_at: input.processedAt ?? null,
  }

  if (input.nextRunAt !== undefined) {
    updateData.next_run_at = input.nextRunAt
    updateData.run_at = input.nextRunAt
  }

  if (input.clearLock !== false) {
    updateData.locked_at = null
  }

  await prisma.automation_jobs.update({ where: { id: input.jobId }, data: updateData })
}

function mapRunStatus(result: AutomationHandlerResult) {
  if (result.status === 'skipped') return 'skipped' as const
  return 'success' as const
}

async function bindRunArtifacts(runId: string, metadata: Record<string, unknown>) {
  const complianceAlertEventIds = metadata.compliance_alert_event_ids
  if (Array.isArray(complianceAlertEventIds) && complianceAlertEventIds.every((v) => typeof v === 'string' && v.length > 0)) {
    await attachComplianceAlertEventsToRun(complianceAlertEventIds as string[], runId)
  }

  const cashFlowSnapshotIds = metadata.cash_flow_snapshot_ids
  if (Array.isArray(cashFlowSnapshotIds) && cashFlowSnapshotIds.every((v) => typeof v === 'string' && v.length > 0)) {
    await attachCashFlowSnapshotsToRun(cashFlowSnapshotIds as string[], runId)
  }

  const portfolioVisibilitySnapshotIds = metadata.portfolio_visibility_snapshot_ids
  if (Array.isArray(portfolioVisibilitySnapshotIds) && portfolioVisibilitySnapshotIds.every((v) => typeof v === 'string' && v.length > 0)) {
    await attachPortfolioVisibilitySnapshotsToRun(portfolioVisibilitySnapshotIds as string[], runId)
  }
}

export async function dispatchAutomationJobs(input?: { limit?: number; now?: Date }) {
  const limit = input?.limit ?? 20
  const now = input?.now ?? new Date()

  const jobs = await prisma.automation_jobs.findMany({
    select: automationJobSelect,
    where: { lifecycle_status: 'queued', next_run_at: { lte: now } },
    orderBy: { next_run_at: 'asc' },
    take: limit,
  })

  let claimed = 0
  let succeeded = 0
  let failed = 0
  let retried = 0
  let skipped = 0

  for (const candidate of jobs as unknown as AutomationJobRecord[]) {
    const nextAttemptCount = candidate.attempts + 1

    // Optimistic claim: only update if still queued
    const claimResult = await prisma.automation_jobs.updateMany({
      where: { id: candidate.id, lifecycle_status: 'queued' },
      data: {
        ...toUpdateStatus('running'),
        locked_at: now,
        started_at: now,
        attempts: nextAttemptCount,
        retry_count: nextAttemptCount,
        last_error: null,
        last_error_code: null,
      },
    })

    if (claimResult.count === 0) {
      // Already claimed by another worker
      continue
    }

    claimed += 1
    const job = candidate
    const startedAt = now.toISOString()

    try {
      const handler = getAutomationJobHandler(job.job_type)
      if (!handler) {
        throw new AppError(`No automation handler registered for ${job.job_type}`, 500)
      }

      const result = await handler.handle({ job, now })
      const completedAt = new Date()
      const terminalStatus = result.status === 'skipped' ? 'skipped' : 'succeeded'

      await finalizeJob({ jobId: job.id, lifecycleStatus: terminalStatus, finishedAt: completedAt, processedAt: completedAt })

      const runRecord = await recordAutomationRun({
        jobId: job.id,
        organizationId: job.organization_id,
        ownerId: job.owner_id,
        flowName: job.job_type,
        status: mapRunStatus(result),
        startedAt,
        completedAt: completedAt.toISOString(),
        processedCount: result.processedCount ?? 0,
        metadata: { ...(result.metadata ?? {}), execution_status: result.status, skip_reason: result.reason ?? null },
      })

      await bindRunArtifacts(runRecord.id, { ...(result.metadata ?? {}), execution_status: result.status, skip_reason: result.reason ?? null })

      if (result.status === 'skipped') skipped += 1
      else succeeded += 1
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown automation failure'
      const maxAttempts = job.max_attempts
      const shouldRetry = nextAttemptCount < maxAttempts
      const completedAt = new Date()

      if (shouldRetry) {
        const retryAt = calculateRetryAt(now, nextAttemptCount)
        await finalizeJob({ jobId: job.id, lifecycleStatus: 'queued', lastError: errorMessage, nextRunAt: retryAt, finishedAt: null, processedAt: null })
      } else {
        await finalizeJob({ jobId: job.id, lifecycleStatus: 'failed', lastError: errorMessage, finishedAt: completedAt, processedAt: completedAt })
      }

      const runRecord = await recordAutomationRun({
        jobId: job.id,
        organizationId: job.organization_id,
        ownerId: job.owner_id,
        flowName: job.job_type,
        status: shouldRetry ? 'partial' : 'failed',
        startedAt,
        completedAt: completedAt.toISOString(),
        processedCount: 0,
        metadata: { error: errorMessage, retried: shouldRetry, retry_count: nextAttemptCount, max_attempts: maxAttempts },
      })

      await bindRunArtifacts(runRecord.id, { error: errorMessage, retried: shouldRetry, retry_count: nextAttemptCount, max_attempts: maxAttempts })

      await recordAutomationError({
        jobId: job.id,
        organizationId: job.organization_id,
        ownerId: job.owner_id,
        flowName: job.job_type,
        errorMessage,
        context: { retry_count: nextAttemptCount, max_attempts: maxAttempts, retried: shouldRetry, source_type: job.source_type, source_ref: job.source_ref },
      })

      if (shouldRetry) retried += 1
      else failed += 1
    }
  }

  return { scanned: jobs.length, claimed, succeeded, skipped, failed, retried }
}
