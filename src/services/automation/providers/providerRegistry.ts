import { sendBrandedMessageEmail, type BrandedEmailOptions } from '../../../lib/mailer.js'
import { env } from '../../../config/env.js'
import { aiClient, isAiConfigured } from '../../ai/aiClient.js'
import { getOrganizationAiSettings } from '../../ai/aiConfigService.js'
import type {
  AIProvider,
  AutomationProviderRegistry,
  CalendarProvider,
  DocumentProvider,
  EmailProvider,
  ListingProvider,
  ProviderResult,
  StorageProvider,
} from './contracts.js'
import { DefaultWhatsAppProvider } from './whatsappProvider.js'

function skipped(provider: string, reason: string, metadata?: Record<string, unknown>): ProviderResult {
  return {
    provider,
    status: 'skipped',
    reason,
    metadata,
  }
}

class DefaultEmailProvider implements EmailProvider {
  async sendMessage(input: {
    to: string[]
    subject: string
    message: BrandedEmailOptions
  }): Promise<ProviderResult> {
    if (input.to.length === 0) {
      return skipped('email', 'no_recipients')
    }

    await sendBrandedMessageEmail({
      to: input.to.join(', '),
      subject: input.subject,
      ...input.message,
    })

    return {
      provider: 'email',
      status: 'sent',
      metadata: {
        recipients: input.to,
      },
    }
  }
}

type OpenAITextGenerationResponse = {
  id?: string | null
  output_text?: string | null
}

type OpenAIResponsesClient = {
  responses?: {
    create: (input: {
      model: string
      instructions?: string
      input: string
      metadata?: Record<string, string>
    }) => Promise<OpenAITextGenerationResponse>
  }
}

function normalizeMetadataValue(value: unknown): string | null {
  if (value === null || typeof value === 'undefined') {
    return null
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return null
  }
}

function normalizeOpenAiMetadata(metadata?: Record<string, unknown>): Record<string, string> | undefined {
  if (!metadata) {
    return undefined
  }

  const normalizedEntries = Object.entries(metadata)
    .map(([key, value]) => [key, normalizeMetadataValue(value)] as const)
    .filter((entry): entry is [string, string] => entry[1] !== null)

  if (normalizedEntries.length === 0) {
    return undefined
  }

  return Object.fromEntries(normalizedEntries)
}

async function resolveAiModelSelection(organizationId?: string | null) {
  const defaultModel = env.OPENAI_MODEL

  if (!organizationId) {
    return {
      enabled: true,
      model: defaultModel,
      settingsSource: 'env_default' as const,
    }
  }

  const settings = await getOrganizationAiSettings(organizationId)
  const preferredModel = settings.ai_model?.trim() || defaultModel

  return {
    enabled: settings.automation_enabled,
    model: preferredModel,
    settingsSource: settings.id === 'default' ? ('env_default' as const) : ('organization' as const),
  }
}

class DefaultAIProvider implements AIProvider {
  async generateText(input: {
    organizationId?: string | null
    prompt: string
    systemPrompt?: string
    metadata?: Record<string, unknown>
  }) {
    if (!isAiConfigured() || !aiClient) {
      return {
        provider: 'openai',
        status: 'skipped' as const,
        reason: 'ai_not_configured',
        output: null,
        model: env.OPENAI_MODEL,
        metadata: input.metadata,
      }
    }

    const modelSelection = await resolveAiModelSelection(input.organizationId)

    if (!modelSelection.enabled) {
      return {
        provider: 'openai',
        status: 'skipped' as const,
        reason: 'ai_automation_disabled',
        output: null,
        model: modelSelection.model,
        metadata: {
          ...input.metadata,
          settings_source: modelSelection.settingsSource,
        },
      }
    }

    try {
      const client = aiClient as OpenAIResponsesClient
      const response = await client.responses!.create({
        model: modelSelection.model,
        instructions: input.systemPrompt,
        input: input.prompt,
        metadata: normalizeOpenAiMetadata({
          ...input.metadata,
          organization_id: input.organizationId ?? null,
          settings_source: modelSelection.settingsSource,
        }),
      })

      const output = response.output_text?.trim() ?? ''
      if (!output) {
        return {
          provider: 'openai',
          status: 'failed' as const,
          reason: 'empty_output',
          output: null,
          model: modelSelection.model,
          externalId: response.id ?? null,
          metadata: {
            ...input.metadata,
            settings_source: modelSelection.settingsSource,
          },
        }
      }

      return {
        provider: 'openai',
        status: 'generated' as const,
        output,
        model: modelSelection.model,
        externalId: response.id ?? null,
        metadata: {
          ...input.metadata,
          settings_source: modelSelection.settingsSource,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown OpenAI error'

      return {
        provider: 'openai',
        status: 'failed' as const,
        reason: 'provider_request_failed',
        output: null,
        model: modelSelection.model,
        metadata: {
          ...input.metadata,
          settings_source: modelSelection.settingsSource,
          error: message,
        },
      }
    }
  }
}

class DefaultDocumentProvider implements DocumentProvider {
  async renderDocument(_input: {
    templateKey: string
    organizationId?: string | null
    payload: Record<string, unknown>
    format?: 'pdf' | 'html'
  }) {
    return {
      provider: 'documents',
      status: 'skipped' as const,
      reason: 'provider_not_configured',
      documentUrl: null,
    }
  }
}

class DefaultStorageProvider implements StorageProvider {
  async storeAsset(_input: {
    organizationId?: string | null
    path: string
    contentType: string
    body: string | Buffer
  }) {
    return {
      provider: 'storage',
      status: 'skipped' as const,
      reason: 'provider_not_configured',
      url: null,
    }
  }
}

class DefaultListingProvider implements ListingProvider {
  async publishListing(_input: {
    organizationId?: string | null
    propertyId: string
    payload: Record<string, unknown>
  }) {
    return {
      provider: 'listing',
      status: 'skipped' as const,
      reason: 'provider_not_configured',
      listingId: null,
      url: null,
    }
  }
}

class DefaultCalendarProvider implements CalendarProvider {
  async scheduleEvent(_input: {
    organizationId?: string | null
    ownerId?: string | null
    title: string
    startsAt: string
    endsAt: string
    metadata?: Record<string, unknown>
  }) {
    return {
      provider: 'calendar',
      status: 'skipped' as const,
      reason: 'provider_not_configured',
      eventId: null,
    }
  }
}

const defaultProviderRegistry: AutomationProviderRegistry = {
  email: new DefaultEmailProvider(),
  whatsapp: new DefaultWhatsAppProvider(),
  ai: new DefaultAIProvider(),
  documents: new DefaultDocumentProvider(),
  storage: new DefaultStorageProvider(),
  listings: new DefaultListingProvider(),
  calendar: new DefaultCalendarProvider(),
}

export function getAutomationProviderRegistry() {
  return defaultProviderRegistry
}
