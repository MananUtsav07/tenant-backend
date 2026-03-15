import type { AutomationJobType } from '../jobTypes.js'

export type AutomationJobTriggerType = 'schedule' | 'event' | 'manual'

export type AutomationJobLifecycleStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'cancelled'

export type AutomationJobLegacyStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'canceled'

export type AutomationRunStatus = 'success' | 'failed' | 'partial' | 'skipped' | 'cancelled'

export type AutomationJobRecord = {
  id: string
  organization_id: string | null
  owner_id: string | null
  job_type: AutomationJobType
  handler_key: string
  trigger_type: AutomationJobTriggerType
  dedupe_key: string
  payload: Record<string, unknown>
  run_at: string
  next_run_at: string
  lifecycle_status: AutomationJobLifecycleStatus
  status: AutomationJobLegacyStatus
  attempts: number
  retry_count: number
  max_attempts: number
  last_error: string | null
  last_error_code: string | null
  locked_at: string | null
  started_at: string | null
  finished_at: string | null
  processed_at: string | null
  source_type: string | null
  source_ref: string | null
}

export type AutomationHandlerResult = {
  status: 'succeeded' | 'skipped'
  processedCount?: number
  metadata?: Record<string, unknown>
  reason?: string
}

export type AutomationHandlerContext = {
  job: AutomationJobRecord
  now: Date
}

export interface AutomationJobHandler {
  readonly key: AutomationJobType
  handle(context: AutomationHandlerContext): Promise<AutomationHandlerResult>
}

export function lifecycleToLegacyStatus(status: AutomationJobLifecycleStatus): AutomationJobLegacyStatus {
  switch (status) {
    case 'queued':
      return 'pending'
    case 'running':
      return 'processing'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'canceled'
    case 'skipped':
    case 'succeeded':
      return 'completed'
  }
}

export function legacyToLifecycleStatus(status: string): AutomationJobLifecycleStatus {
  switch (status) {
    case 'pending':
      return 'queued'
    case 'processing':
      return 'running'
    case 'completed':
      return 'succeeded'
    case 'failed':
      return 'failed'
    case 'canceled':
      return 'cancelled'
    default:
      return 'queued'
  }
}
