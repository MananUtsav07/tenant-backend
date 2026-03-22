import type { BrandedEmailOptions } from '../../../lib/mailer.js'
import { getOwnerById } from '../../ownerService.js'
import { getOwnerTelegramChatLink, sendTelegramMessage } from '../../telegramService.js'
import { recordIntegrationEvent } from '../integrationEventService.js'
import { resolveAutomationMessageTemplate } from '../messageTemplateService.js'
import { getAutomationProviderRegistry } from './providerRegistry.js'

type DeliveryStatus = {
  channel: 'email' | 'telegram' | 'whatsapp'
  status: 'sent' | 'skipped' | 'failed'
  reason?: string
}

type EmailDeliveryShape = BrandedEmailOptions & {
  subject: string
}

async function recordDeliveryEvent(input: {
  organizationId: string
  ownerId: string
  provider: DeliveryStatus['channel']
  templateKey: string
  status: DeliveryStatus['status']
  reason?: string
  payload?: Record<string, unknown>
}) {
  await recordIntegrationEvent({
    organizationId: input.organizationId,
    provider: input.provider,
    eventType: 'owner_automation_delivery',
    status: input.status === 'failed' ? 'failed' : 'processed',
    lastError: input.reason ?? null,
    payload: {
      owner_id: input.ownerId,
      template_key: input.templateKey,
      delivery_status: input.status,
      ...input.payload,
    },
    processedAt: new Date().toISOString(),
  })
}

function listOwnerRecipientEmails(owner: {
  email?: string | null
  support_email?: string | null
}) {
  return [owner.email, owner.support_email]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .filter((value, index, list) => list.indexOf(value) === index)
}

export async function deliverOwnerAutomationMessage(input: {
  organizationId: string
  ownerId: string
  templateKey: string
  templateVariables?: Record<string, unknown>
  email?: EmailDeliveryShape
  telegram?: {
    fallbackText: string
  }
  whatsapp?: {
    fallbackText: string
  }
}) {
  const owner = await getOwnerById(input.ownerId, input.organizationId)
  if (!owner) {
    return {
      owner_found: false,
      deliveries: [
        {
          channel: 'email' as const,
          status: 'failed' as const,
          reason: 'owner_not_found',
        },
      ],
    }
  }

  const deliveries: DeliveryStatus[] = []
  const templateVariables = {
    owner: {
      full_name: owner.full_name,
      company_name: owner.company_name,
      email: owner.email,
    },
    ...input.templateVariables,
  }

  if (input.email) {
    const recipients = listOwnerRecipientEmails(owner)
    if (recipients.length === 0) {
      const delivery = {
        channel: 'email',
        status: 'skipped',
        reason: 'no_email_recipients',
      } satisfies DeliveryStatus
      deliveries.push(delivery)
      await recordDeliveryEvent({
        organizationId: input.organizationId,
        ownerId: input.ownerId,
        provider: 'email',
        templateKey: input.templateKey,
        status: delivery.status,
        reason: delivery.reason,
      })
    } else {
      try {
        const resolved = await resolveAutomationMessageTemplate({
          organizationId: input.organizationId,
          templateKey: input.templateKey,
          channel: 'email',
          fallbackSubject: input.email.subject,
          fallbackBody: input.email.body?.join('\n\n') ?? '',
          variables: templateVariables,
        })

        const bodyLines = input.email.body ? [...input.email.body] : []
        if (resolved.body.trim().length > 0 && bodyLines.join('\n\n').trim() !== resolved.body.trim()) {
          bodyLines.push(resolved.body)
        }

        const providers = getAutomationProviderRegistry()
        const emailResult = await providers.email.sendMessage({
          to: recipients,
          subject: resolved.subject ?? input.email.subject,
          message: {
            preheader: input.email.preheader,
            eyebrow: input.email.eyebrow,
            title: input.email.title,
            intro: input.email.intro,
            details: input.email.details,
            body: bodyLines,
            note: input.email.note,
            cta: input.email.cta,
            footer: input.email.footer,
          },
        })

        const delivery = {
          channel: 'email',
          status: emailResult.status === 'sent' ? 'sent' : emailResult.status === 'failed' ? 'failed' : 'skipped',
          reason: emailResult.reason,
        } satisfies DeliveryStatus
        deliveries.push(delivery)
        await recordDeliveryEvent({
          organizationId: input.organizationId,
          ownerId: input.ownerId,
          provider: 'email',
          templateKey: input.templateKey,
          status: delivery.status,
          payload: {
            recipients,
            subject: resolved.subject ?? input.email.subject,
          },
        })
      } catch (error) {
        const delivery = {
          channel: 'email',
          status: 'failed',
          reason: error instanceof Error ? error.message : 'email_delivery_failed',
        } satisfies DeliveryStatus
        deliveries.push(delivery)
        await recordDeliveryEvent({
          organizationId: input.organizationId,
          ownerId: input.ownerId,
          provider: 'email',
          templateKey: input.templateKey,
          status: delivery.status,
          reason: delivery.reason,
          payload: {
            recipients,
          },
        })
      }
    }
  }

  if (input.telegram) {
    try {
      const telegramLink = await getOwnerTelegramChatLink({
        organizationId: input.organizationId,
        ownerId: input.ownerId,
      })

      if (!telegramLink) {
        const delivery = {
          channel: 'telegram',
          status: 'skipped',
          reason: 'telegram_not_linked',
        } satisfies DeliveryStatus
        deliveries.push(delivery)
        await recordDeliveryEvent({
          organizationId: input.organizationId,
          ownerId: input.ownerId,
          provider: 'telegram',
          templateKey: input.templateKey,
          status: delivery.status,
          reason: delivery.reason,
        })
      } else {
        await sendTelegramMessage({
          chatId: telegramLink.chat_id,
          text: input.telegram.fallbackText,
        })
        const delivery = {
          channel: 'telegram',
          status: 'sent',
        } satisfies DeliveryStatus
        deliveries.push(delivery)
        await recordDeliveryEvent({
          organizationId: input.organizationId,
          ownerId: input.ownerId,
          provider: 'telegram',
          templateKey: input.templateKey,
          status: delivery.status,
          payload: {
            chat_id: telegramLink.chat_id,
            telegram_username: telegramLink.telegram_username,
          },
        })
      }
    } catch (error) {
      const delivery = {
        channel: 'telegram',
        status: 'failed',
        reason: error instanceof Error ? error.message : 'telegram_delivery_failed',
      } satisfies DeliveryStatus
      deliveries.push(delivery)
      await recordDeliveryEvent({
        organizationId: input.organizationId,
        ownerId: input.ownerId,
        provider: 'telegram',
        templateKey: input.templateKey,
        status: delivery.status,
        reason: delivery.reason,
      })
    }
  }

  if (input.whatsapp) {
    const whatsappRecipient = owner.support_whatsapp?.trim() ?? ''

    if (!whatsappRecipient) {
      const delivery = {
        channel: 'whatsapp',
        status: 'skipped',
        reason: 'whatsapp_not_linked',
      } satisfies DeliveryStatus
      deliveries.push(delivery)
      await recordDeliveryEvent({
        organizationId: input.organizationId,
        ownerId: input.ownerId,
        provider: 'whatsapp',
        templateKey: input.templateKey,
        status: delivery.status,
        reason: delivery.reason,
      })
    } else {
      try {
        const providers = getAutomationProviderRegistry()
        const whatsappResult = await providers.whatsapp.sendTemplate({
          organizationId: input.organizationId,
          ownerId: input.ownerId,
          recipient: whatsappRecipient,
          templateKey: input.templateKey,
          variables: templateVariables,
          fallbackText: input.whatsapp.fallbackText,
          metadata: {
            owner_email: owner.email,
            owner_company_name: owner.company_name,
          },
        })

        const delivery = {
          channel: 'whatsapp',
          status:
            whatsappResult.status === 'sent'
              ? 'sent'
              : whatsappResult.status === 'failed'
                ? 'failed'
                : 'skipped',
          reason: whatsappResult.reason,
        } satisfies DeliveryStatus
        deliveries.push(delivery)
        await recordDeliveryEvent({
          organizationId: input.organizationId,
          ownerId: input.ownerId,
          provider: 'whatsapp',
          templateKey: input.templateKey,
          status: delivery.status,
          reason: delivery.reason,
          payload: {
            recipient: whatsappRecipient,
            provider_message_id: whatsappResult.externalId ?? null,
          },
        })
      } catch (error) {
        const delivery = {
          channel: 'whatsapp',
          status: 'failed',
          reason: error instanceof Error ? error.message : 'whatsapp_delivery_failed',
        } satisfies DeliveryStatus
        deliveries.push(delivery)
        await recordDeliveryEvent({
          organizationId: input.organizationId,
          ownerId: input.ownerId,
          provider: 'whatsapp',
          templateKey: input.templateKey,
          status: delivery.status,
          reason: delivery.reason,
          payload: {
            recipient: whatsappRecipient,
          },
        })
      }
    }
  }

  return {
    owner_found: true,
    deliveries,
  }
}
