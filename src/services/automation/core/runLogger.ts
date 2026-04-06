import { prisma } from '../../../lib/db.js'
import type { AutomationRunStatus } from './types.js'

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
  const data = await prisma.automation_runs.create({
    data: {
      job_id: input.jobId,
      organization_id: input.organizationId,
      owner_id: input.ownerId,
      flow_name: input.flowName,
      status: input.status,
      started_at: input.startedAt,
      completed_at: input.completedAt,
      processed_count: input.processedCount,
      metadata: input.metadata as object,
    },
    select: { id: true },
  })

  return { id: data.id as string }
}

export async function recordAutomationError(input: {
  jobId: string
  organizationId: string | null
  ownerId: string | null
  flowName: string
  errorMessage: string
  context: Record<string, unknown>
}) {
  await prisma.automation_errors.create({
    data: {
      job_id: input.jobId,
      organization_id: input.organizationId,
      owner_id: input.ownerId,
      flow_name: input.flowName,
      error_message: input.errorMessage,
      context: input.context as object,
    },
  })
}
