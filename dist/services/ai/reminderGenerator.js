import { isReminderGenerationEnabled } from './featureFlags.js';
export async function generateReminderMessage(input) {
    const enabled = await isReminderGenerationEnabled(input.organizationId);
    if (!enabled) {
        return null;
    }
    // Infrastructure-only phase:
    // AI reminder generation is intentionally not active yet.
    // Future implementation will return generated text from model output.
    return null;
}
//# sourceMappingURL=reminderGenerator.js.map