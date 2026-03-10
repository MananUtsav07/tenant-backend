import { openaiClient } from '../lib/openai.js';
const intentValues = ['maintenance', 'payment', 'renewal', 'complaint', 'general', 'escalation'];
const escalationKeywords = [
    'urgent',
    'emergency',
    'human',
    'owner',
    'manager',
    'lawsuit',
    'legal',
    'complaint',
    'angry',
    'refund',
    'dispute',
];
function containsEscalationKeyword(message) {
    const text = message.toLowerCase();
    return escalationKeywords.some((keyword) => text.includes(keyword));
}
function coerceIntent(value) {
    if (value && intentValues.includes(value)) {
        return value;
    }
    return 'general';
}
function safeParseJson(value) {
    try {
        return JSON.parse(value);
    }
    catch {
        return null;
    }
}
function buildSystemPrompt(context) {
    return [
        'You are a property management AI support assistant for tenants.',
        'Answer only from provided context. If not enough context, say: "Let me connect you with our team."',
        'Be concise, empathetic, and practical.',
        'Classify intent into one of: maintenance, payment, renewal, complaint, general, escalation.',
        'Escalate if tenant asks for a human, mentions urgency/emergency, legal issues, payment disputes, or severe complaints.',
        'Output JSON only with keys: intent, response, escalate, confidence.',
        'Use confidence "low" if uncertain.',
        'TENANT CONTEXT:',
        JSON.stringify(context),
    ].join('\n');
}
export async function getTenantAssistantReply(message, context) {
    const shouldEscalateByKeyword = containsEscalationKeyword(message);
    try {
        const completion = await openaiClient.chat.completions.create({
            model: 'gpt-4o-mini',
            temperature: 0.2,
            messages: [
                {
                    role: 'system',
                    content: buildSystemPrompt(context),
                },
                {
                    role: 'user',
                    content: message,
                },
            ],
        });
        const raw = completion.choices?.[0]?.message?.content?.trim() ?? '';
        const parsed = safeParseJson(raw);
        if (parsed) {
            const intent = coerceIntent(parsed.intent);
            const response = parsed.response?.trim() || 'Let me connect you with our team.';
            const lowConfidence = (parsed.confidence || '').toLowerCase() === 'low';
            const escalated = Boolean(parsed.escalate) || lowConfidence || shouldEscalateByKeyword || intent === 'escalation';
            return {
                intent,
                response,
                escalated,
            };
        }
    }
    catch (error) {
        console.error('[tenant-chat] openai error', error);
    }
    return {
        intent: shouldEscalateByKeyword ? 'escalation' : 'general',
        response: 'Let me connect you with our team.',
        escalated: true,
    };
}
//# sourceMappingURL=chatService.js.map