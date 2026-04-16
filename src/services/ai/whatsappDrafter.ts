import { aiClient } from './aiClient.js'
import { env } from '../../config/env.js'

export type WhatsappDraftInput = {
  intent: string
  tenantName: string
  ownerName?: string
}

export type WhatsappDraftResult = {
  draft: string
  model: string
}

export async function draftWhatsappMessage(input: WhatsappDraftInput): Promise<WhatsappDraftResult | null> {
  if (!aiClient) {
    return null
  }

  try {
    const lines = [
      `Tenant name: ${input.tenantName}`,
      `What the landlord wants to say: ${input.intent}`,
    ]
    if (input.ownerName) lines.push(`Landlord name: ${input.ownerName}`)

    const client = aiClient as any
    const completion = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are drafting a WhatsApp message from a landlord to a specific tenant. Keep it under 60 words. Conversational but professional. Do not use emojis unless the intent explicitly mentions them. Write the message body only — ready to send as-is.',
        },
        {
          role: 'user',
          content: lines.join('\n'),
        },
      ],
      temperature: 0.55,
      max_tokens: 120,
    })

    const draft = completion.choices?.[0]?.message?.content?.trim() ?? ''
    if (!draft) return null

    return { draft, model: env.OPENAI_MODEL }
  } catch {
    return null
  }
}
