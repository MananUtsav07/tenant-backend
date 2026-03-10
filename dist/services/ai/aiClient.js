import OpenAI from 'openai';
import { env } from '../../config/env.js';
const openAiApiKey = env.OPENAI_API_KEY?.trim() ?? '';
export const aiClient = openAiApiKey ? new OpenAI({ apiKey: openAiApiKey }) : null;
export function isAiConfigured() {
    return openAiApiKey.length > 0;
}
//# sourceMappingURL=aiClient.js.map