import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../../../lib/errors.js'
import { supabaseAdmin } from '../../../lib/supabase.js'
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

function assertHandler(jobType: AutomationJobType) {
  const handler = getAutomationJobHandler(jobType)
  if (!handler) {
    throw new AppError(`No automation handler registered for ${jobType}`, 500)
  }
  return handler
}

export async function queueAutomationJob(input: QueueAutomationJobInput) {
  assertHandler(input.jobType)

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('automation_jobs')
    .select('id, lifecycle_status, status')
    .eq('dedupe_key', input.dedupeKey)
    .maybeSingle()

  throwIfError(existingError, 'Failed to check existing automation job')

  if (existing) {
    return {
      created: false,
      job_id: existing.id as string,
      status: ((existing as { lifecycle_status?: string }).lifecycle_status ??
        (existing as { status?: string }).status ??
        'queued') as string,
    }
  }

  const runAt = input.runAt ?? new Date().toISOString()
  const lifecycleStatus = 'queued'

  const { data, error } = await supabaseAdmin
    .from('automation_jobs')
    .insert({
      organization_id: input.organizationId ?? null,
      owner_id: input.ownerId ?? null,
      job_type: input.jobType,
      handler_key: input.jobType,
      trigger_type: input.triggerType ?? 'manual',
      dedupe_key: input.dedupeKey,
      payload: input.payload ?? {},
      run_at: runAt,
      next_run_at: runAt,
      lifecycle_status: lifecycleStatus,
      status: lifecycleToLegacyStatus(lifecycleStatus),
      attempts: 0,
      retry_count: 0,
      max_attempts: input.maxAttempts ?? 3,
      source_type: input.sourceType ?? null,
      source_ref: input.sourceRef ?? null,
    })
    .select('id, lifecycle_status')
    .single()

  throwIfError(error, 'Failed to queue automation job')

  return {
    created: true,
    job_id: data?.id as string,
    status: (data?.lifecycle_status as string) ?? lifecycleStatus,
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
  const from = (query.page - 1) * query.page_size
  const to = from + query.page_size - 1

  let request = supabaseAdmin
    .from('automation_jobs')
    .select(automationJobSelect, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (query.job_type) {
    if (!isAutomationJobType(query.job_type)) {
      throw new AppError('Invalid automation job type filter', 400)
    }

    request = request.eq('job_type', query.job_type)
  }

  if (query.lifecycle_status) {
    request = request.eq('lifecycle_status', query.lifecycle_status)
  }

  if (query.organization_id) {
    request = request.eq('organization_id', query.organization_id)
  }

  const { data, error, count } = await request
  throwIfError(error, 'Failed to list automation jobs')

  return {
    items: (data ?? []) as unknown as AutomationJobRecord[],
    total: count ?? 0,
  }
}
