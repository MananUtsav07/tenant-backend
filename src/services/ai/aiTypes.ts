export type OrganizationAiSettings = {
  id: string
  organization_id: string
  automation_enabled: boolean
  ticket_classification_enabled: boolean
  reminder_generation_enabled: boolean
  ticket_summarization_enabled: boolean
  ai_model: string
  created_at: string
  updated_at: string
}

export type OrganizationAiSettingsUpdate = Partial<
  Pick<
    OrganizationAiSettings,
    | 'automation_enabled'
    | 'ticket_classification_enabled'
    | 'reminder_generation_enabled'
    | 'ticket_summarization_enabled'
    | 'ai_model'
  >
>

export type TicketIntentCategory =
  | 'maintenance'
  | 'rent'
  | 'utilities'
  | 'noise'
  | 'security'
  | 'neighbor_dispute'
  | 'other'

export type TicketIntentClassificationInput = {
  organizationId: string
  ticketId?: string
  subject: string
  message: string
}

export type TicketIntentClassificationResult = {
  category: TicketIntentCategory
  confidence: number
  model: string
  reasoning?: string
}

export type ReminderGenerationRequest = {
  organizationId: string
  tenantId: string
  tenantName: string
  reminderType: string
  paymentDueDay: number
  monthlyRent: number
  dueDateIso: string
}

export type ReminderGenerationResult = {
  message: string
  model: string
}

export type TicketSummarizationRequest = {
  organizationId: string
  ticketId: string
  subject: string
  message: string
  updates?: Array<{
    timestamp: string
    author: string
    message: string
  }>
}

export type TicketSummarizationResult = {
  summary: string
  model: string
}

export type AdminAiStatusSummary = {
  openai_configured: boolean
  organizations_with_ai_enabled: number
  ticket_classification_enabled_count: number
  reminder_generation_enabled_count: number
  ticket_summarization_enabled_count: number
}

