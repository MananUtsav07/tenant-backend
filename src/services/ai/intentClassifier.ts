import { isTicketClassificationEnabled } from './featureFlags.js'
import { aiClient } from './aiClient.js'
import { env } from '../../config/env.js'
import type { TicketIntentClassificationInput, TicketIntentClassificationResult } from './aiTypes.js'

const VALID_CATEGORIES = ['maintenance', 'rent', 'utilities', 'noise', 'security', 'neighbor_dispute', 'other'] as const

export async function classifyTicketIntent(
  input: TicketIntentClassificationInput,
): Promise<TicketIntentClassificationResult | null> {
  const enabled = await isTicketClassificationEnabled(input.organizationId)
  if (!enabled) {
    return null
  }

  if (!aiClient) {
    return null
  }

  try {
    const client = aiClient as any
    const completion = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are a property management ticket classifier. Classify the tenant support ticket into exactly one of these categories:
- maintenance: physical repairs, plumbing, electrical, HVAC, appliances, structural issues
- rent: payment questions, rent increases, receipts, lease terms, deposits
- utilities: water, electricity, gas, internet billing or outages
- noise: noise complaints from neighbours or common areas
- security: door locks, building access, CCTV, safety concerns
- neighbor_dispute: conflicts between tenants (beyond noise)
- other: anything that does not fit above

Respond with valid JSON only, no markdown fences:
{ "category": "<one of the categories above>", "confidence": <0.0 to 1.0>, "reasoning": "<one sentence>" }`,
        },
        {
          role: 'user',
          content: `Subject: ${input.subject}\n\nMessage: ${input.message}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 200,
    })

    const raw = completion.choices?.[0]?.message?.content?.trim() ?? ''
    const parsed = JSON.parse(raw) as { category: string; confidence: number; reasoning?: string }

    const category = VALID_CATEGORIES.includes(parsed.category as any)
      ? (parsed.category as TicketIntentClassificationResult['category'])
      : 'other'

    const confidence = typeof parsed.confidence === 'number'
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.5

    return {
      category,
      confidence,
      model: env.OPENAI_MODEL,
      reasoning: parsed.reasoning,
    }
  } catch {
    return null
  }
}

