import { isTicketSummarizationEnabled } from './featureFlags.js';
export async function summarizeTicket(input) {
    const enabled = await isTicketSummarizationEnabled(input.organizationId);
    if (!enabled) {
        return null;
    }
    // Infrastructure-only phase:
    // AI ticket summarization is intentionally not active yet.
    // Future implementation will summarize thread history for owner workflows.
    return null;
}
//# sourceMappingURL=ticketSummarizer.js.map