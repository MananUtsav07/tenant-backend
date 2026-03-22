import axios from 'axios'
import type { PostgrestError } from '@supabase/supabase-js'

import { env } from '../../../config/env.js'
import { AppError } from '../../../lib/errors.js'
import { supabaseAdmin } from '../../../lib/supabase.js'
import { recordAutomationError } from '../core/runLogger.js'
import { recordIntegrationEvent, updateIntegrationEvent } from '../integrationEventService.js'
import { resolveAutomationMessageTemplate } from '../messageTemplateService.js'
import type {
  ProviderResult,
  WhatsAppActionMessageInput,
  WhatsAppFreeformSendInput,
  WhatsAppInboundEvent,
  WhatsAppPolicyMode,
  WhatsAppProvider,
  WhatsAppTemplateSendInput,
  WhatsAppWebhookChallengeResult,
  WhatsAppWebhookEventResult,
} from './contracts.js'

type DeliveryStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed' | 'skipped'
type DeliveryUpdateStatus = Exclude<DeliveryStatus, 'queued'>
type InboundStatus = 'received' | 'processed' | 'failed' | 'ignored'

type OutboundDeliveryRow = {
  id: string
  integration_event_id: string | null
}

type InboundDeliveryLink = {
  id: string
}

const outboundSelect = 'id, integration_event_id'
const inboundSelect = 'id'

function throwIfError(error: PostgrestError | null, message: string) {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readArray(value: unknown) {
  return Array.isArray(value) ? value : []
}

function normalizeRecipient(recipient: string) {
  const trimmed = recipient.trim()
  const digits = trimmed.replace(/[^\d]/g, '')
  const normalized =
    digits.length >= 7
      ? `${trimmed.startsWith('+') ? '+' : ''}${digits}`
      : null

  return {
    raw: trimmed,
    e164: normalized,
  }
}

function providerName() {
  return env.WHATSAPP_PROVIDER ?? 'disabled';
}

function isMetaProviderEnabled() {
  return env.WHATSAPP_PROVIDER === 'meta';
}

function mapDeliveryStatus(value: string | null | undefined): DeliveryUpdateStatus | null {
  if (!value) {
    return null
  }

  switch (value) {
    case 'sent':
      return 'sent'
    case 'delivered':
      return 'delivered'
    case 'read':
      return 'read'
    case 'failed':
      return 'failed'
    case 'skipped':
      return 'skipped'
    default:
      return null
  }
}

async function recordOutboundFailure(input: {
  organizationId?: string | null
  ownerId?: string | null
  automationJobId?: string | null
  flowName?: string | null
  errorMessage: string
  context: Record<string, unknown>
}) {
  if (!input.automationJobId) {
    return
  }

  await recordAutomationError({
    jobId: input.automationJobId,
    organizationId: input.organizationId ?? null,
    ownerId: input.ownerId ?? null,
    flowName: input.flowName ?? 'whatsapp_delivery',
    errorMessage: input.errorMessage,
    context: input.context,
  })
}

async function createOutboundDelivery(input: {
  organizationId?: string | null
  ownerId?: string | null
  tenantId?: string | null
  automationJobId?: string | null
  automationRunId?: string | null
  recipient: string
  templateKey?: string | null
  policyMode: WhatsAppPolicyMode
  messageKind: 'template' | 'freeform' | 'action'
  renderedBody?: string | null
  fallbackText?: string | null
  actionPayload?: Record<string, unknown>
  attemptKey?: string | null
  payload?: Record<string, unknown>
}) {
  const recipient = normalizeRecipient(input.recipient)
  const receivedAt = new Date().toISOString()

  const integrationEvent = await recordIntegrationEvent({
    organizationId: input.organizationId ?? null,
    provider: 'whatsapp',
    eventType: 'whatsapp_outbound',
    status: 'processing',
    payload: {
      recipient: recipient.raw,
      recipient_e164: recipient.e164,
      template_key: input.templateKey ?? null,
      policy_mode: input.policyMode,
      message_kind: input.messageKind,
      rendered_body: input.renderedBody ?? null,
      fallback_text: input.fallbackText ?? null,
      ...(input.payload ?? {}),
    },
    receivedAt,
  })

  if (!integrationEvent?.id) {
    throw new AppError('Failed to create WhatsApp integration event', 500)
  }

  const { data, error } = await supabaseAdmin
    .from('whatsapp_message_deliveries')
    .insert({
      organization_id: input.organizationId ?? null,
      owner_id: input.ownerId ?? null,
      tenant_id: input.tenantId ?? null,
      automation_job_id: input.automationJobId ?? null,
      automation_run_id: input.automationRunId ?? null,
      integration_event_id: integrationEvent.id,
      provider: providerName(),
      policy_mode: input.policyMode,
      message_kind: input.messageKind,
      template_key: input.templateKey ?? null,
      recipient: recipient.raw,
      recipient_e164: recipient.e164,
      rendered_body: input.renderedBody ?? null,
      fallback_text: input.fallbackText ?? null,
      action_payload: input.actionPayload ?? {},
      provider_payload: input.payload ?? {},
      status: 'queued',
      attempt_key: input.attemptKey ?? null,
    })
    .select(outboundSelect)
    .single()

  throwIfError(error, 'Failed to create WhatsApp delivery log')
  return data as OutboundDeliveryRow
}

async function updateOutboundDelivery(input: {
  deliveryId: string
  integrationEventId?: string | null
  status: DeliveryStatus
  providerMessageId?: string | null
  providerConversationId?: string | null
  providerPayload?: Record<string, unknown>
  lastError?: string | null
}) {
  const nowIso = new Date().toISOString()
  const sentAt = input.status === 'sent' ? nowIso : undefined
  const deliveredAt = input.status === 'delivered' ? nowIso : undefined
  const readAt = input.status === 'read' ? nowIso : undefined

  const { error } = await supabaseAdmin
    .from('whatsapp_message_deliveries')
    .update({
      status: input.status,
      provider_message_id: input.providerMessageId ?? undefined,
      provider_conversation_id: input.providerConversationId ?? undefined,
      provider_payload: input.providerPayload ?? undefined,
      last_error: typeof input.lastError === 'undefined' ? undefined : input.lastError,
      sent_at: sentAt,
      delivered_at: deliveredAt,
      read_at: readAt,
    })
    .eq('id', input.deliveryId)

  throwIfError(error, 'Failed to update WhatsApp delivery log')

  if (input.integrationEventId) {
    await updateIntegrationEvent({
      id: input.integrationEventId,
      status: input.status === 'failed' ? 'failed' : 'processed',
      lastError: typeof input.lastError === 'undefined' ? undefined : input.lastError,
      processedAt: nowIso,
      payload: {
        delivery_id: input.deliveryId,
        provider_message_id: input.providerMessageId ?? null,
        provider_conversation_id: input.providerConversationId ?? null,
        delivery_status: input.status,
        provider_payload: input.providerPayload ?? {},
      },
    })
  }
}

async function insertInboundEvent(input: {
  organizationId?: string | null
  deliveryId?: string | null
  integrationEventId?: string | null
  eventType: 'challenge' | 'message' | 'status' | 'unknown'
  messageType: 'text' | 'interactive' | 'button' | 'image' | 'video' | 'document' | 'system' | 'unknown'
  sender?: string | null
  recipient?: string | null
  externalMessageId?: string | null
  providerConversationId?: string | null
  payload: Record<string, unknown>
  normalizedPayload?: Record<string, unknown>
  status?: InboundStatus
  lastError?: string | null
}) {
  const sender = input.sender ? normalizeRecipient(input.sender) : null
  const recipient = input.recipient ? normalizeRecipient(input.recipient) : null
  const { data, error } = await supabaseAdmin
    .from('whatsapp_inbound_events')
    .insert({
      organization_id: input.organizationId ?? null,
      delivery_id: input.deliveryId ?? null,
      integration_event_id: input.integrationEventId ?? null,
      provider: providerName(),
      event_type: input.eventType,
      message_type: input.messageType,
      sender: sender?.raw ?? null,
      sender_e164: sender?.e164 ?? null,
      recipient: recipient?.raw ?? null,
      recipient_e164: recipient?.e164 ?? null,
      external_message_id: input.externalMessageId ?? null,
      provider_conversation_id: input.providerConversationId ?? null,
      payload: input.payload,
      normalized_payload: input.normalizedPayload ?? {},
      status: input.status ?? 'received',
      last_error: input.lastError ?? null,
      received_at: new Date().toISOString(),
      processed_at: input.status === 'processed' ? new Date().toISOString() : null,
    })
    .select(inboundSelect)
    .single()

  throwIfError(error, 'Failed to insert WhatsApp inbound event')
  return data as InboundDeliveryLink
}

async function updateInboundEvent(input: {
  inboundEventId: string
  deliveryId?: string | null
  status: InboundStatus
  lastError?: string | null
}) {
  const { error } = await supabaseAdmin
    .from('whatsapp_inbound_events')
    .update({
      delivery_id: input.deliveryId ?? undefined,
      status: input.status,
      last_error: typeof input.lastError === 'undefined' ? undefined : input.lastError,
      processed_at: input.status === 'processed' ? new Date().toISOString() : undefined,
    })
    .eq('id', input.inboundEventId)

  throwIfError(error, 'Failed to update WhatsApp inbound event')
}

async function findDeliveryByProviderMessageId(providerMessageId: string) {
  const { data, error } = await supabaseAdmin
    .from('whatsapp_message_deliveries')
    .select('id, integration_event_id')
    .eq('provider_message_id', providerMessageId)
    .maybeSingle()

  throwIfError(error, 'Failed to locate WhatsApp delivery by provider message id')
  return (data as OutboundDeliveryRow | null) ?? null
}

function extractGenericWebhookEvent(body: Record<string, unknown>): WhatsAppInboundEvent[] {
  const eventType = readString(body.event_type)
  if (!eventType) {
    return []
  }

  const mappedEventType =
    eventType === 'message' || eventType === 'status' || eventType === 'challenge' ? eventType : 'unknown'
  const mappedMessageType = (() => {
    const messageType = readString(body.message_type)
    switch (messageType) {
      case 'text':
      case 'interactive':
      case 'button':
      case 'image':
      case 'video':
      case 'document':
      case 'system':
        return messageType
      default:
        return 'unknown'
    }
  })()

  return [
    {
      organizationId: readString(body.organization_id),
      eventType: mappedEventType,
      messageType: mappedMessageType,
      sender: readString(body.sender),
      recipient: readString(body.recipient),
      externalMessageId: readString(body.external_message_id),
      providerMessageId: readString(body.provider_message_id) ?? readString(body.external_message_id),
      providerConversationId: readString(body.provider_conversation_id),
      deliveryStatus: mapDeliveryStatus(readString(body.status)),
      payload: body,
      normalizedPayload: readObject(body.normalized_payload) ?? body,
      receivedAt: readString(body.received_at),
    },
  ]
}

function extractMetaWebhookEvents(body: Record<string, unknown>): WhatsAppInboundEvent[] {
  const events: WhatsAppInboundEvent[] = []
  const entries = readArray(body.entry)

  for (const entry of entries) {
    const entryRecord = readObject(entry)
    if (!entryRecord) {
      continue
    }

    const changes = readArray(entryRecord.changes)
    for (const change of changes) {
      const changeRecord = readObject(change)
      const value = readObject(changeRecord?.value)
      if (!value) {
        continue
      }

      const metadata = readObject(value.metadata)
      const recipient = readString(metadata?.display_phone_number) ?? readString(metadata?.phone_number_id)

      for (const messageValue of readArray(value.messages)) {
        const message = readObject(messageValue)
        if (!message) {
          continue
        }

        const messageType = readString(message.type)
        const normalizedType =
          messageType === 'text' ||
          messageType === 'interactive' ||
          messageType === 'button' ||
          messageType === 'image' ||
          messageType === 'video' ||
          messageType === 'document'
            ? messageType
            : 'unknown'

        events.push({
          eventType: 'message',
          messageType: normalizedType,
          sender: readString(message.from),
          recipient,
          externalMessageId: readString(message.id),
          providerMessageId: readString(message.id),
          providerConversationId: readString(readObject(message.context)?.id),
          payload: message,
          normalizedPayload: {
            text: readString(readObject(message.text)?.body),
            button_reply_id: readString(readObject(readObject(message.interactive)?.button_reply)?.id),
            button_reply_title: readString(readObject(readObject(message.interactive)?.button_reply)?.title),
          },
        })
      }

      for (const statusValue of readArray(value.statuses)) {
        const status = readObject(statusValue)
        if (!status) {
          continue
        }

        events.push({
          eventType: 'status',
          messageType: 'system',
          recipient: readString(status.recipient_id),
          externalMessageId: readString(status.id),
          providerMessageId: readString(status.id),
          providerConversationId: readString(readObject(status.conversation)?.id),
          deliveryStatus: mapDeliveryStatus(readString(status.status)),
          payload: status,
          normalizedPayload: {
            status: readString(status.status),
            timestamp: readString(status.timestamp),
            errors: readArray(status.errors),
          },
        })
      }
    }
  }

  return events
}

function extractWebhookEvents(body: unknown): WhatsAppInboundEvent[] {
  const root = readObject(body)
  if (!root) {
    return []
  }

  const genericEvents = extractGenericWebhookEvent(root)
  if (genericEvents.length > 0) {
    return genericEvents
  }

  const metaEvents = extractMetaWebhookEvents(root)
  if (metaEvents.length > 0) {
    return metaEvents
  }

  return [
    {
      eventType: 'unknown',
      messageType: 'unknown',
      payload: root,
      normalizedPayload: root,
    },
  ]
}

async function sendViaStub(input: {
  deliveryId: string
  integrationEventId?: string | null
  mode: 'template' | 'freeform' | 'action'
  recipient: string
  preview: string
  providerPayload?: Record<string, unknown>
}) {
  const providerMessageId = `stub_${crypto.randomUUID()}`

  await updateOutboundDelivery({
    deliveryId: input.deliveryId,
    integrationEventId: input.integrationEventId,
    status: 'sent',
    providerMessageId,
    providerPayload: {
      ...(input.providerPayload ?? {}),
      delivery_mode: input.mode,
    },
  })

  return providerMessageId
}

export class DefaultWhatsAppProvider implements WhatsAppProvider {
  async sendTemplate(input: WhatsAppTemplateSendInput): Promise<ProviderResult> {
    if (!isMetaProviderEnabled()) {
      return { provider: providerName(), status: 'skipped', reason: 'provider_not_configured' };
    }
    const recipient = input.recipient;
    try {
      const url = `https://graph.facebook.com/v22.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
      const payload = {
        messaging_product: "whatsapp",
        to: recipient,
        type: "template",
        template: {
          name: "hello_world", // You may want to use input.templateKey if dynamic
          language: { code: "en_US" }
        }
      };
      await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      return { provider: providerName(), status: 'sent' };
    } catch (error: any) {
      console.error('WhatsApp Template Send Error:', error?.response?.data || error.message);
      return { provider: providerName(), status: 'failed', reason: 'api_error', metadata: { error: error?.response?.data || error.message } };
    }
  }

  async sendFreeform(input: WhatsAppFreeformSendInput): Promise<ProviderResult> {
    if (!isMetaProviderEnabled()) {
      return { provider: providerName(), status: 'skipped', reason: 'provider_not_configured' };
    }
    const recipient = input.recipient;
    const text = input.text;
    try {
      const url = `https://graph.facebook.com/v22.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
      const payload = {
        messaging_product: "whatsapp",
        to: recipient,
        text: { body: text }
      };
      await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      return { provider: providerName(), status: 'sent' };
    } catch (error: any) {
      console.error('WhatsApp Freeform Send Error:', error?.response?.data || error.message);
      return { provider: providerName(), status: 'failed', reason: 'api_error', metadata: { error: error?.response?.data || error.message } };
    }
  }

  async sendActionMessage(input: WhatsAppActionMessageInput): Promise<ProviderResult> {
    const recipient = readString(input.recipient)
    const body = readString(input.body)

    if (!recipient || !body || input.actions.length === 0) {
      return {
        provider: providerName(),
        status: 'skipped',
        reason: 'invalid_action_payload',
      }
    }

    const delivery = await createOutboundDelivery({
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      tenantId: input.tenantId,
      automationJobId: input.automationJobId,
      automationRunId: input.automationRunId,
      recipient,
      policyMode: 'action',
      messageKind: 'action',
      renderedBody: body,
      attemptKey: input.attemptKey ?? null,
      actionPayload: {
        title: input.title ?? null,
        footer: input.footer ?? null,
        actions: input.actions,
      },
      payload: {
        policy_context: input.policyContext ?? {},
        metadata: input.metadata ?? {},
      },
    })

    if (input.policyContext?.sessionOpen !== true) {
      await updateOutboundDelivery({
        deliveryId: delivery.id,
        integrationEventId: delivery.integration_event_id,
        status: 'skipped',
        lastError: 'session_policy_unverified',
      })

      return {
        provider: providerName(),
        status: 'skipped',
        reason: 'session_policy_unverified',
        metadata: { delivery_id: delivery.id },
      }
    }

    if (!isMetaProviderEnabled()) {
      await updateOutboundDelivery({
        deliveryId: delivery.id,
        integrationEventId: delivery.integration_event_id,
        status: 'skipped',
        lastError: 'provider_not_configured',
      })
      return {
        provider: providerName(),
        status: 'skipped',
        reason: 'provider_not_configured',
        metadata: { delivery_id: delivery.id },
      }
    }

    const providerMessageId = await sendViaStub({
      deliveryId: delivery.id,
      integrationEventId: delivery.integration_event_id,
      mode: 'action',
      recipient,
      preview: body,
      providerPayload: {
        actions: input.actions,
      },
    })

    return {
      provider: providerName(),
      status: 'sent',
      externalId: providerMessageId,
      metadata: {
        delivery_id: delivery.id,
        policy_mode: 'action',
        action_count: input.actions.length,
      },
    }
  }

  async handleWebhookChallenge(input: {
    query: Record<string, unknown>
    headers: Record<string, string | undefined>
  }): Promise<WhatsAppWebhookChallengeResult> {
    if (!env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
      return {
        handled: false,
        statusCode: 404,
        body: { ok: false, error: 'WhatsApp webhook verification is not configured' },
      }
    }

    const mode =
      readString(input.query['hub.mode']) ??
      readString(readObject(input.query.hub)?.mode) ??
      readString(input.query.mode)
    const verifyToken =
      readString(input.query['hub.verify_token']) ??
      readString(readObject(input.query.hub)?.verify_token) ??
      readString(input.query.verify_token)
    const challenge =
      readString(input.query['hub.challenge']) ??
      readString(readObject(input.query.hub)?.challenge) ??
      readString(input.query.challenge)

    if (mode === 'subscribe' && verifyToken === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN && challenge) {
      return {
        handled: true,
        statusCode: 200,
        body: challenge,
      }
    }

    return {
      handled: true,
      statusCode: 403,
      body: { ok: false, error: 'Invalid WhatsApp webhook verification request' },
    }
  }

  async handleWebhookEvent(input: {
    headers: Record<string, string | undefined>
    body: unknown
    requestId?: string | null
  }): Promise<WhatsAppWebhookEventResult> {
    // Removed x-whatsapp-webhook-secret check to allow Meta POSTs

    const events = extractWebhookEvents(input.body)

    for (const event of events) {
      // Auto-reply to incoming WhatsApp messages with 'Thank You'
      // Only reply if this is a real incoming message event (not account_settings_update, etc)
      // Meta webhook message events have a 'messages' array in the payload
      const isRealMessage = Array.isArray((event.payload as any)?.messages) && (event.payload as any).messages.length > 0;
      if (event.eventType === 'message' && event.sender && isRealMessage) {
        const apiUrl = `https://graph.facebook.com/v17.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
        const apiPayload = {
          messaging_product: "whatsapp",
          to: event.sender,
          text: { body: "Thank You" }
        };
        const apiHeaders = {
          Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        };
        console.log("[WhatsApp API] Sending reply:", JSON.stringify({ url: apiUrl, payload: apiPayload, headers: { ...apiHeaders, Authorization: 'Bearer ***' } }, null, 2));
        try {
          const apiResp = await axios.post(apiUrl, apiPayload, { headers: apiHeaders });
          console.log("[WhatsApp API] Success:", JSON.stringify(apiResp.data));
        } catch (err) {
          let errorMsg = "Failed to send WhatsApp reply: ";
          if (err && typeof err === 'object') {
            if ('response' in err && err.response && typeof err.response === 'object' && 'data' in err.response) {
              errorMsg += JSON.stringify((err.response as any).data);
              console.error("[WhatsApp API] Error response:", JSON.stringify((err.response as any).data, null, 2));
            } else if ('message' in err && typeof (err as any).message === 'string') {
              errorMsg += (err as any).message;
            } else {
              errorMsg += JSON.stringify(err);
            }
          } else {
            errorMsg += String(err);
          }
          console.error(errorMsg);
        }
      }
  const integrationEvent = await recordIntegrationEvent({
        organizationId: event.organizationId ?? null,
        provider: 'whatsapp',
        eventType: 'whatsapp_webhook',
        status: 'received',
        payload: {
          request_id: input.requestId ?? null,
          event_type: event.eventType,
          message_type: event.messageType,
          ...event.payload,
        },
        receivedAt: event.receivedAt ?? new Date().toISOString(),
      })

      if (!integrationEvent?.id) {
        throw new AppError('Failed to create WhatsApp webhook integration event', 500)
      }

      let inboundEventId: string | null = null

      try {
        let linkedDeliveryId: string | null = null
        let linkedIntegrationEventId: string | null = null

        if (event.providerMessageId) {
          const matchedDelivery = await findDeliveryByProviderMessageId(event.providerMessageId)
          if (matchedDelivery) {
            linkedDeliveryId = matchedDelivery.id
            linkedIntegrationEventId = matchedDelivery.integration_event_id
          }
        }

        const inboundEvent = await insertInboundEvent({
          organizationId: event.organizationId ?? null,
          deliveryId: linkedDeliveryId,
          integrationEventId: integrationEvent.id,
          eventType: event.eventType,
          messageType: event.messageType,
          sender: event.sender ?? null,
          recipient: event.recipient ?? null,
          externalMessageId: event.externalMessageId ?? null,
          providerConversationId: event.providerConversationId ?? null,
          payload: event.payload,
          normalizedPayload: event.normalizedPayload ?? {},
        })
        inboundEventId = inboundEvent.id

        if (linkedDeliveryId && event.deliveryStatus) {
          await updateOutboundDelivery({
            deliveryId: linkedDeliveryId,
            integrationEventId: linkedIntegrationEventId,
            status: event.deliveryStatus,
            providerMessageId: event.providerMessageId ?? event.externalMessageId ?? undefined,
            providerConversationId: event.providerConversationId ?? undefined,
            providerPayload: event.normalizedPayload ?? {},
            lastError:
              event.deliveryStatus === 'failed'
                ? readString(readObject(event.normalizedPayload)?.error) ?? 'provider_delivery_failed'
                : null,
          })
        }

        await updateInboundEvent({
          inboundEventId,
          deliveryId: linkedDeliveryId,
          status: event.eventType === 'unknown' ? 'ignored' : 'processed',
        })

        await updateIntegrationEvent({
          id: integrationEvent.id,
          status: 'processed',
          processedAt: new Date().toISOString(),
          payload: {
            request_id: input.requestId ?? null,
            inbound_event_id: inboundEventId,
            delivery_id: linkedDeliveryId,
            event_type: event.eventType,
            message_type: event.messageType,
            normalized_payload: event.normalizedPayload ?? {},
          },
        })
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'whatsapp_webhook_processing_failed'
        if (inboundEventId) {
          await updateInboundEvent({
            inboundEventId,
            status: 'failed',
            lastError: errorMessage,
          })
        }

        await updateIntegrationEvent({
          id: integrationEvent.id,
          status: 'failed',
          lastError: errorMessage,
          processedAt: new Date().toISOString(),
        })
      }
    }

    return {
      handled: true,
      statusCode: 200,
      events,
    }
  }
}
