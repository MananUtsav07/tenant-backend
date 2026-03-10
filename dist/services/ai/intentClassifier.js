import { isTicketClassificationEnabled } from './featureFlags.js';
export async function classifyTicketIntent(input) {
    const enabled = await isTicketClassificationEnabled(input.organizationId);
    if (!enabled) {
        return null;
    }
    // Infrastructure-only phase:
    // AI ticket classification is intentionally not active yet.
    // Future implementation will call aiClient with organization-scoped prompts.
    return null;
}
//# sourceMappingURL=intentClassifier.js.map