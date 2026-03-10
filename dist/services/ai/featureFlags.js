import { getOrganizationAiSettings } from './aiConfigService.js';
import { isAiConfigured } from './aiClient.js';
export async function isAiEnabledForOrganization(organizationId) {
    const settings = await getOrganizationAiSettings(organizationId);
    return settings.automation_enabled && isAiConfigured();
}
export async function isTicketClassificationEnabled(organizationId) {
    const settings = await getOrganizationAiSettings(organizationId);
    return settings.automation_enabled && settings.ticket_classification_enabled && isAiConfigured();
}
export async function isReminderGenerationEnabled(organizationId) {
    const settings = await getOrganizationAiSettings(organizationId);
    return settings.automation_enabled && settings.reminder_generation_enabled && isAiConfigured();
}
export async function isTicketSummarizationEnabled(organizationId) {
    const settings = await getOrganizationAiSettings(organizationId);
    return settings.automation_enabled && settings.ticket_summarization_enabled && isAiConfigured();
}
//# sourceMappingURL=featureFlags.js.map