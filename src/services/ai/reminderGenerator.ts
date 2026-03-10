import { isReminderGenerationEnabled } from './featureFlags.js'
import type { ReminderGenerationRequest, ReminderGenerationResult } from './aiTypes.js'

export async function generateReminderMessage(
  input: ReminderGenerationRequest,
): Promise<ReminderGenerationResult | null> {
  const enabled = await isReminderGenerationEnabled(input.organizationId)
  if (!enabled) {
    return null
  }

  // Infrastructure-only phase:
  // AI reminder generation is intentionally not active yet.
  // Future implementation will return generated text from model output.
  return null
}

