import { AppError } from '../../../lib/errors.js'
import { prisma } from '../../../lib/db.js'
import { buildScheduledAutomationJobs } from '../jobScheduler.js'
import { isAutomationJobType, type AutomationJobType } from '../jobTypes.js'
import { getAutomationJobHandler } from './registry.js'
import { lifecycleToLegacyStatus, type AutomationJobRecord, type AutomationJobTriggerType } from './types.js'

type QueueAutomationJobInput = {
  jobType: AutomationJobType
  dedupeKey: string
  organizationId?: string | null
  ownerId?: string | null
  triggerType?: AutomationJobTriggerType
  runAt?: string
  payload?: Record<string, unknown>
  maxAttempts?: number
  sourceType?: string | null
  sourceRef?: string | null
}

type ListAutomationJobsInput = {
  page: number
  page_size: number
  job_type?: string
  lifecycle_status?: string
  organization_id?: string
}

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

function assertHandler(jobType: AutomationJobType) {
  const handler = getAutomationJobHandler(jobType)
  if (!handler) {
    throw new AppError(`No automation handler registered for ${jobType}`, 500)
  }
  return handler
}

export async function queueAutomationJob(input: QueueAutomationJobInput) {
  assertHandler(input.jobType)

  const existing = await prisma.automation_jobs.findFirst({
    select: { id: true, lifecycle_status: true, status: true },
    where: { dedupe_key: input.dedupeKey },
  })

  if (existing) {
    return {
      created: false,
      job_id: existing.id,
      status: (existing.lifecycle_status ?? existing.status ?? 'queued') as string,
    }
  }

  const runAt = input.runAt ? new Date(input.runAt) : new Date()
  const lifecycleStatus = 'queued'

  const data = await prisma.automation_jobs.create({
    select: { id: true, lifecycle_status: true },
    data: {
      organization_id: input.organizationId ?? null,
      owner_id: input.ownerId ?? null,
      job_type: input.jobType,
      handler_key: input.jobType,
      trigger_type: input.triggerType ?? 'manual',
      dedupe_key: input.dedupeKey,
      payload: (input.payload ?? {}) as object,
      run_at: runAt,
      next_run_at: runAt,
      lifecycle_status: lifecycleStatus,
      status: lifecycleToLegacyStatus(lifecycleStatus),
      attempts: 0,
      retry_count: 0,
      max_attempts: input.maxAttempts ?? 3,
      source_type: input.sourceType ?? null,
      source_ref: input.sourceRef ?? null,
    },
  })

  return {
    created: true,
    job_id: data.id,
    status: (data.lifecycle_status as string) ?? lifecycleStatus,
  }
}

export async function queueScheduledAutomationJobs(now = new Date()) {
  const definitions = buildScheduledAutomationJobs(now)
  const jobs = await Promise.all(
    definitions.map((definition) =>
      queueAutomationJob({
        jobType: definition.jobType,
        dedupeKey: definition.dedupeKey,
        payload: definition.payload,
        runAt: definition.runAt,
        triggerType: 'schedule',
      }),
    ),
  )

  return {
    date_key: now.toISOString().slice(0, 10),
    jobs,
    job_types: definitions.map((definition) => definition.jobType),
    created_count: jobs.filter((job) => job.created).length,
  }
}

export async function queueEventAutomationJob(input: {
  jobType: AutomationJobType
  dedupeKey: string
  organizationId?: string | null
  ownerId?: string | null
  payload?: Record<string, unknown>
  sourceType: string
  sourceRef: string
  runAt?: string
  maxAttempts?: number
}) {
  return queueAutomationJob({
    jobType: input.jobType,
    dedupeKey: input.dedupeKey,
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    triggerType: 'event',
    payload: input.payload,
    sourceType: input.sourceType,
    sourceRef: input.sourceRef,
    runAt: input.runAt,
    maxAttempts: input.maxAttempts,
  })
}

export async function listAutomationJobs(query: ListAutomationJobsInput) {
  const skip = (query.page - 1) * query.page_size

  const where: Record<string, unknown> = {}
  if (query.job_type) {
    if (!isAutomationJobType(query.job_type)) {
      throw new AppError('Invalid automation job type filter', 400)
    }
    where.job_type = query.job_type
  }
  if (query.lifecycle_status) where.lifecycle_status = query.lifecycle_status
  if (query.organization_id) where.organization_id = query.organization_id

  const [items, total] = await prisma.$transaction([
    prisma.automation_jobs.findMany({ select: automationJobSelect, where, orderBy: { created_at: 'desc' }, skip, take: query.page_size }),
    prisma.automation_jobs.count({ where }),
  ])

  return { items: items as unknown as AutomationJobRecord[], total }
}
