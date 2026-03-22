import type { BrandedEmailOptions } from '../../../lib/mailer.js'

export type ProviderSendStatus = 'sent' | 'generated' | 'stored' | 'scheduled' | 'linked' | 'skipped' | 'failed'

export type ProviderResult = {
  provider: string
  status: ProviderSendStatus
  externalId?: string | null
  reason?: string
  metadata?: Record<string, unknown>
}

export interface EmailProvider {
  sendMessage(input: {
    to: string[]
    subject: string
    message: BrandedEmailOptions
  }): Promise<ProviderResult>
}

export type WhatsAppPolicyMode = 'template' | 'session' | 'action'

export type WhatsAppDeliveryContext = {
  organizationId?: string | null
  ownerId?: string | null
  tenantId?: string | null
  automationJobId?: string | null
  automationRunId?: string | null
  flowName?: string | null
  metadata?: Record<string, unknown>
}

export type WhatsAppTemplateSendInput = WhatsAppDeliveryContext & {
  recipient: string
  templateKey: string
  variables?: Record<string, unknown>
  fallbackText?: string
  language?: string
  attemptKey?: string | null
}

export type WhatsAppFreeformSendInput = WhatsAppDeliveryContext & {
  recipient: string
  text: string
  attemptKey?: string | null
  policyContext?: {
    sessionOpen?: boolean | null
  }
}

export type WhatsAppActionMessageInput = WhatsAppDeliveryContext & {
  recipient: string
  body: string
  title?: string
  footer?: string
  actions: Array<{
    id: string
    label: string
  }>
  attemptKey?: string | null
  policyContext?: {
    sessionOpen?: boolean | null
  }
}

export type WhatsAppWebhookChallengeResult = {
  handled: boolean
  statusCode: number
  body: string | Record<string, unknown>
}

export type WhatsAppInboundEvent = {
  organizationId?: string | null
  eventType: 'challenge' | 'message' | 'status' | 'unknown'
  messageType: 'text' | 'interactive' | 'button' | 'image' | 'video' | 'document' | 'system' | 'unknown'
  sender?: string | null
  recipient?: string | null
  externalMessageId?: string | null
  providerMessageId?: string | null
  providerConversationId?: string | null
  deliveryStatus?: 'sent' | 'delivered' | 'read' | 'failed' | 'skipped' | null
  payload: Record<string, unknown>
  normalizedPayload?: Record<string, unknown>
  receivedAt?: string | null
}

export type WhatsAppWebhookEventResult = {
  handled: boolean
  statusCode: number
  events: WhatsAppInboundEvent[]
}

export interface WhatsAppProvider {
  sendTemplate(input: WhatsAppTemplateSendInput): Promise<ProviderResult>
  sendFreeform(input: WhatsAppFreeformSendInput): Promise<ProviderResult>
  sendActionMessage(input: WhatsAppActionMessageInput): Promise<ProviderResult>
  handleWebhookChallenge(input: {
    query: Record<string, unknown>
    headers: Record<string, string | undefined>
  }): Promise<WhatsAppWebhookChallengeResult>
  handleWebhookEvent(input: {
    headers: Record<string, string | undefined>
    body: unknown
    requestId?: string | null
  }): Promise<WhatsAppWebhookEventResult>
}

export interface AIProvider {
  generateText(input: {
    organizationId?: string | null
    prompt: string
    systemPrompt?: string
    metadata?: Record<string, unknown>
  }): Promise<ProviderResult & { output: string | null; model?: string | null }>
}

export interface DocumentProvider {
  renderDocument(input: {
    templateKey: string
    organizationId?: string | null
    payload: Record<string, unknown>
    format?: 'pdf' | 'html'
  }): Promise<ProviderResult & { documentUrl?: string | null }>
}

export interface StorageProvider {
  storeAsset(input: {
    organizationId?: string | null
    path: string
    contentType: string
    body: string | Buffer
  }): Promise<ProviderResult & { url?: string | null }>
}

export interface ListingProvider {
  publishListing(input: {
    organizationId?: string | null
    propertyId: string
    payload: Record<string, unknown>
  }): Promise<ProviderResult & { listingId?: string | null; url?: string | null }>
}

export interface CalendarProvider {
  scheduleEvent(input: {
    organizationId?: string | null
    ownerId?: string | null
    title: string
    startsAt: string
    endsAt: string
    metadata?: Record<string, unknown>
  }): Promise<ProviderResult & { eventId?: string | null }>
}

export type AutomationProviderRegistry = {
  email: EmailProvider
  whatsapp: WhatsAppProvider
  ai: AIProvider
  documents: DocumentProvider
  storage: StorageProvider
  listings: ListingProvider
  calendar: CalendarProvider
}
