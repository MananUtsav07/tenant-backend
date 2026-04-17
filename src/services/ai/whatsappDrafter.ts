import { aiClient } from './aiClient.js'
import { env } from '../../config/env.js'

export type SmartComposeInput = {
  intent: string
  tenantName: string
  ownerName?: string | null
  propertyName?: string | null
  leaseEndDate?: string | null
  rentStatus?: string | null
  openTicketCount?: number
}

export type SmartComposeResult = {
  draft: string
  model: string
}

export async function draftSmartMessage(input: SmartComposeInput): Promise<SmartComposeResult | null> {
  if (!aiClient) return null

  try {
    const contextLines: string[] = [`Tenant name: ${input.tenantName}`]
    if (input.propertyName) contextLines.push(`Property: ${input.propertyName}`)
    if (input.leaseEndDate) contextLines.push(`Lease end date: ${input.leaseEndDate}`)
    if (input.rentStatus) contextLines.push(`Rent status: ${input.rentStatus}`)
    if (typeof input.openTicketCount === 'number') {
      contextLines.push(`Open support tickets: ${input.openTicketCount}`)
    }
    if (input.ownerName) contextLines.push(`Landlord name: ${input.ownerName}`)
    contextLines.push(`What the landlord wants to say: ${input.intent}`)

    const client = aiClient as any
    const completion = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are helping a landlord compose a short, personalised WhatsApp message to a specific tenant. Use the context provided to make the message specific and relevant. Under 80 words. Conversational but professional. Do not use emojis unless explicitly requested. Write the message body only — ready to send as-is.',
        },
        {
          role: 'user',
          content: contextLines.join('\n'),
        },
      ],
      temperature: 0.55,
      max_tokens: 150,
    })

    const draft = completion.choices?.[0]?.message?.content?.trim() ?? ''
    if (!draft) return null

    return { draft, model: env.OPENAI_MODEL }
  } catch {
    return null
  }
}
