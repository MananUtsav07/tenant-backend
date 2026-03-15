import { sendBrandedMessageEmail, type BrandedEmailOptions } from '../../../lib/mailer.js'
import { aiClient, isAiConfigured } from '../../ai/aiClient.js'
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
        model: null,
        metadata: input.metadata,
      }
    }

    return {
      provider: 'openai',
      status: 'skipped' as const,
      reason: 'provider_adapter_not_implemented',
      output: null,
      model: null,
      metadata: input.metadata,
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
