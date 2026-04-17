import { isTicketClassificationEnabled } from './featureFlags.js'
import { aiClient } from './aiClient.js'
import { env } from '../../config/env.js'
import type { MaintenanceCategory, MaintenanceUrgency } from '../maintenanceWorkflowService.js'

export type MaintenanceTriageResult = {
  urgency: MaintenanceUrgency
  category: MaintenanceCategory
  notes: string
}

export async function triageMaintenanceTicket(input: {
  subject: string
  message: string
  organizationId: string
}): Promise<MaintenanceTriageResult | null> {
  const enabled = await isTicketClassificationEnabled(input.organizationId)
  if (!enabled) return null

  if (!aiClient) return null

  try {
    const client = aiClient as any
    const completion = await client.chat.completions.create({
      model: env.OPENAI_MODEL,
      messages: [
        {
          role: 'system',
          content: `You are triaging a property maintenance request. Respond with valid JSON only, no markdown fences:
{ "urgency": "<emergency|urgent|standard>", "category": "<plumbing|electrical|hvac|appliance|locksmith|pest_control|cleaning|painting|carpentry|waterproofing|general|other>", "notes": "<one sentence describing the issue for the contractor>" }

Urgency guide:
- emergency: immediate risk of injury, flooding, fire, or total loss of power/water
- urgent: habitability affected but not immediately dangerous (no heating, broken lock, sewage smell)
- standard: inconvenient or cosmetic (dripping tap, cracked tile, broken appliance that has a workaround)`,
        },
        {
          role: 'user',
          content: `Subject: ${input.subject}\n\nMessage: ${input.message}`,
        },
      ],
      temperature: 0.2,
      max_tokens: 120,
    })

    const raw = completion.choices?.[0]?.message?.content?.trim() ?? ''
    const parsed = JSON.parse(raw) as { urgency: string; category: string; notes: string }

    const validUrgencies: MaintenanceUrgency[] = ['emergency', 'urgent', 'standard']
    const validCategories: MaintenanceCategory[] = [
      'general', 'plumbing', 'electrical', 'hvac', 'appliance', 'locksmith',
      'pest_control', 'cleaning', 'painting', 'carpentry', 'waterproofing', 'other',
    ]

    const urgency = validUrgencies.includes(parsed.urgency as MaintenanceUrgency)
      ? (parsed.urgency as MaintenanceUrgency)
      : 'standard'

    const category = validCategories.includes(parsed.category as MaintenanceCategory)
      ? (parsed.category as MaintenanceCategory)
      : 'general'

    return { urgency, category, notes: parsed.notes ?? '' }
  } catch {
    return null
  }
}
