import { aiClient } from './aiClient.js'
import { env } from '../../config/env.js'

export type LeaseDigestInput = {
  expiringCount: number
  overdueCount: number
  tenantDetails: string
}

export type LeaseDigestResult = {
  digest: string
  model: string
}

export async function generateLeaseDigest(input: LeaseDigestInput): Promise<LeaseDigestResult | null> {
  if (!aiClient) {
    return null
  }

  try {
    const userContent = [
      `Leases expiring within 60 days: ${input.expiringCount}`,
      `Tenants with overdue rent: ${input.overdueCount}`,
      '',
      'Tenant details:',
      input.tenantDetails,
    ].join('\n')

    const client = aiClient as any
    const completion = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are a property management advisor. Write a concise, action-oriented summary for a landlord based on the lease risk data provided. Use short bullet points. Under 120 words total. Focus on what needs attention and suggest practical next steps.',
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
      temperature: 0.4,
      max_tokens: 250,
    })

    const digest = completion.choices?.[0]?.message?.content?.trim() ?? ''
    if (!digest) return null

    return { digest, model: env.OPENAI_MODEL }
  } catch {
    return null
  }
}
