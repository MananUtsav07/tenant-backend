import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../../../lib/errors.js'
import { supabaseAdmin } from '../../../lib/supabase.js'
import type { AutomationRunStatus } from './types.js'

function throwIfError(error: PostgrestError | null, message: string) {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

export async function recordAutomationRun(input: {
  jobId: string
  organizationId: string | null
  ownerId: string | null
  flowName: string
  status: AutomationRunStatus
  startedAt: string
  completedAt: string
  processedCount: number
  metadata: Record<string, unknown>
}) {
  const { data, error } = await supabaseAdmin
    .from('automation_runs')
    .insert({
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
    .select('id')
    .single()

  throwIfError(error, 'Failed to insert automation run record')
  return { id: data?.id as string }
}

export async function recordAutomationError(input: {
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
