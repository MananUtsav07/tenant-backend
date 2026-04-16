import { aiClient } from './aiClient.js'
import { env } from '../../config/env.js'

export type TicketReplyDraftInput = {
  subject: string
  message: string
  updates?: Array<{ timestamp: string; author: string; message: string }>
  tenantName?: string
  propertyName?: string
}

export type TicketReplyDraftResult = {
  draft: string
  model: string
}

export async function draftTicketReply(input: TicketReplyDraftInput): Promise<TicketReplyDraftResult | null> {
  if (!aiClient) {
    return null
  }

  try {
    const lines: string[] = [
      `Subject: ${input.subject}`,
      '',
      `Tenant message: ${input.message}`,
    ]

    if (input.updates && input.updates.length > 0) {
      lines.push('', 'Thread history:')
      for (const update of input.updates) {
        lines.push(`[${update.timestamp}] ${update.author}: ${update.message}`)
      }
    }

    if (input.tenantName) lines.push('', `Tenant name: ${input.tenantName}`)
    if (input.propertyName) lines.push(`Property: ${input.propertyName}`)

    const transcript = lines.join('\n')

    const client = aiClient as any
    const completion = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a professional property manager. Draft a polite, concise reply to this tenant\'s support ticket on behalf of the landlord. Use a helpful and professional tone. Reply in under 100 words. Do not use placeholders like [Name] or [Date] — write it as a complete, ready-to-send message.',
        },
        {
          role: 'user',
          content: transcript,
        },
      ],
      temperature: 0.5,
      max_tokens: 200,
    })

    const draft = completion.choices?.[0]?.message?.content?.trim() ?? ''
    if (!draft) return null

    return { draft, model: env.OPENAI_MODEL }
  } catch {
    return null
  }
}
