import { isTicketClassificationEnabled } from './featureFlags.js'
import type { TicketIntentClassificationInput, TicketIntentClassificationResult } from './aiTypes.js'

export async function classifyTicketIntent(
  input: TicketIntentClassificationInput,
): Promise<TicketIntentClassificationResult | null> {
  const enabled = await isTicketClassificationEnabled(input.organizationId)
  if (!enabled) {
    return null
  }

  // Infrastructure-only phase:
  // AI ticket classification is intentionally not active yet.
  // Future implementation will call aiClient with organization-scoped prompts.
  return null
}

