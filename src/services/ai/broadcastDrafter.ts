import { aiClient } from './aiClient.js'
import { env } from '../../config/env.js'

export type BroadcastDraftInput = {
  topic: string
  ownerName?: string
}

export type BroadcastDraftResult = {
  draft: string
  model: string
}

export async function draftBroadcastMessage(input: BroadcastDraftInput): Promise<BroadcastDraftResult | null> {
  if (!aiClient) {
    return null
  }

  try {
    const userContent = input.ownerName
      ? `Owner: ${input.ownerName}\nTopic: ${input.topic}`
      : `Topic: ${input.topic}`

    const client = aiClient as any
    const completion = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a property manager composing a broadcast message to send to all tenants. Write a clear, professional message based on the owner\'s topic. Keep it under 80 words. Friendly but professional tone. Do not include placeholders. Write the message body only — no subject line.',
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
      temperature: 0.6,
      max_tokens: 150,
    })

    const draft = completion.choices?.[0]?.message?.content?.trim() ?? ''
    if (!draft) return null

    return { draft, model: env.OPENAI_MODEL }
  } catch {
    return null
  }
}
