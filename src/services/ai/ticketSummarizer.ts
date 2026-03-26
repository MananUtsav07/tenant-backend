import { isTicketSummarizationEnabled } from './featureFlags.js'
import { aiClient } from './aiClient.js'
import { env } from '../../config/env.js'
import type { TicketSummarizationRequest, TicketSummarizationResult } from './aiTypes.js'

export async function summarizeTicket(input: TicketSummarizationRequest): Promise<TicketSummarizationResult | null> {
  const enabled = await isTicketSummarizationEnabled(input.organizationId)
  if (!enabled) {
    return null
  }

  if (!aiClient) {
    return null
  }

  try {
    const lines: string[] = [
      `Subject: ${input.subject}`,
      '',
      `Initial message: ${input.message}`,
    ]

    if (input.updates && input.updates.length > 0) {
      lines.push('', 'Updates:')
      for (const update of input.updates) {
        lines.push(`[${update.timestamp}] ${update.author}: ${update.message}`)
      }
    }

    const transcript = lines.join('\n')

    const client = aiClient as any
    const completion = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a property management assistant. Summarize the following tenant support ticket thread in 2-3 concise sentences for the property owner. Focus on the core issue, current status, and any outstanding action needed. Do not include greetings or filler.',
        },
        {
          role: 'user',
          content: transcript,
        },
      ],
      temperature: 0.3,
      max_tokens: 300,
    })

    const summary = completion.choices?.[0]?.message?.content?.trim() ?? ''
    if (!summary) {
      return null
    }

    return {
      summary,
      model: env.OPENAI_MODEL,
    }
  } catch {
    return null
  }
}

