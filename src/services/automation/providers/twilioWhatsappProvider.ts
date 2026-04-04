import crypto from 'node:crypto'

import { env } from '../../../config/env.js'
import { processWhatsAppOwnerBotMessage } from '../../whatsappBotService.js'
import type {
  ProviderResult,
  WhatsAppActionMessageInput,
  WhatsAppFreeformSendInput,
  WhatsAppInboundEvent,
  WhatsAppProvider,
  WhatsAppTemplateSendInput,
  WhatsAppWebhookChallengeResult,
  WhatsAppWebhookEventResult,
} from './contracts.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isConfigured(): boolean {
  return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_NUMBER)
}

/**
 * Twilio signature verification.
 * https://www.twilio.com/docs/usage/webhooks/webhooks-security
 *
 * Signature = Base64(HMAC-SHA1(authToken, url + sorted params concatenated))
 */
function verifyTwilioSignature(
  authToken: string,
  signature: string,
  url: string,
  params: Record<string, string>,
): boolean {
  const sortedKeys = Object.keys(params).sort()
  const paramString = sortedKeys.map((k) => `${k}${params[k]}`).join('')
  const hmac = crypto.createHmac('sha1', authToken).update(url + paramString).digest('base64')
  return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(signature))
}

/**
 * Strip the "whatsapp:" prefix Twilio adds to phone numbers.
 */
function stripWhatsappPrefix(value: string): string {
  return value.replace(/^whatsapp:/i, '')
}

/** POST to Twilio Messages API. Returns the message SID on success. */
async function twilioSend(to: string, body: string): Promise<string> {
  const sid = env.TWILIO_ACCOUNT_SID!
  const token = env.TWILIO_AUTH_TOKEN!
  const from = env.TWILIO_WHATSAPP_NUMBER!

  const fromFormatted = from.startsWith('whatsapp:') ? from : `whatsapp:${from}`
  const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`

  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`
  const auth = Buffer.from(`${sid}:${token}`).toString('base64')

  const formData = new URLSearchParams({
    From: fromFormatted,
    To: toFormatted,
    Body: body,
  })

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Twilio send failed (${response.status}): ${errText}`)
  }

  const json = (await response.json()) as { sid?: string }
  return json.sid ?? 'unknown'
}

// ---------------------------------------------------------------------------
// Provider implementation
// ---------------------------------------------------------------------------

export class TwilioWhatsAppProvider implements WhatsAppProvider {
  // ── Sending ────────────────────────────────────────────────────────────────

  async sendFreeform(input: WhatsAppFreeformSendInput): Promise<ProviderResult> {
    if (!isConfigured()) {
      return { provider: 'twilio', status: 'skipped', reason: 'twilio_not_configured' }
    }

    try {
      const externalId = await twilioSend(input.recipient, input.text)
      return { provider: 'twilio', status: 'sent', externalId }
    } catch (error) {
      return {
        provider: 'twilio',
        status: 'failed',
        reason: error instanceof Error ? error.message : 'unknown_error',
      }
    }
  }

  /**
   * Twilio WhatsApp does not support Meta-style named templates.
   * Fall back to sending the fallbackText (or a generic placeholder) as a
   * plain freeform message so the flow keeps working.
   */
  async sendTemplate(input: WhatsAppTemplateSendInput): Promise<ProviderResult> {
    if (!isConfigured()) {
      return { provider: 'twilio', status: 'skipped', reason: 'twilio_not_configured' }
    }

    const text = input.fallbackText?.trim() || `[${input.templateKey}]`

    try {
      const externalId = await twilioSend(input.recipient, text)
      return {
        provider: 'twilio',
        status: 'sent',
        externalId,
        metadata: { template_key: input.templateKey, sent_as: 'freeform_fallback' },
      }
    } catch (error) {
      return {
        provider: 'twilio',
        status: 'failed',
        reason: error instanceof Error ? error.message : 'unknown_error',
      }
    }
  }

  /**
   * Twilio basic WhatsApp does not support interactive buttons.
   * Render the actions as a numbered list and send as plain text.
   */
  async sendActionMessage(input: WhatsAppActionMessageInput): Promise<ProviderResult> {
    if (!isConfigured()) {
      return { provider: 'twilio', status: 'skipped', reason: 'twilio_not_configured' }
    }

    const lines: string[] = []
    if (input.title) lines.push(`*${input.title}*`)
    lines.push(input.body)
    input.actions.forEach((action, idx) => lines.push(`${idx + 1}. ${action.label}`))
    if (input.footer) lines.push(`_${input.footer}_`)

    const text = lines.join('\n')

    try {
      const externalId = await twilioSend(input.recipient, text)
      return {
        provider: 'twilio',
        status: 'sent',
        externalId,
        metadata: { sent_as: 'text_menu' },
      }
    } catch (error) {
      return {
        provider: 'twilio',
        status: 'failed',
        reason: error instanceof Error ? error.message : 'unknown_error',
      }
    }
  }

  // ── Webhook ────────────────────────────────────────────────────────────────

  /**
   * Twilio has no GET challenge handshake — return not handled so the
   * controller responds 404, which is correct.
   */
  async handleWebhookChallenge(_input: {
    query: Record<string, unknown>
    headers: Record<string, string | undefined>
  }): Promise<WhatsAppWebhookChallengeResult> {
    return { handled: false, statusCode: 404, body: 'not_applicable' }
  }

  /**
   * Twilio posts application/x-www-form-urlencoded to the webhook URL.
   * Express's urlencoded middleware has already parsed it into req.body by
   * the time we get here.
   *
   * Expected fields: From, To, Body, MessageSid, SmsStatus, etc.
   */
  async handleWebhookEvent(input: {
    headers: Record<string, string | undefined>
    body: unknown
    rawBody?: Buffer | null
    requestId?: string | null
  }): Promise<WhatsAppWebhookEventResult> {
    if (!isConfigured()) {
      return { handled: false, statusCode: 200, events: [] }
    }

    // ── Signature verification ──────────────────────────────────────────────
    const twilioSig = input.headers['x-twilio-signature']
    if (env.TWILIO_AUTH_TOKEN && twilioSig) {
      // We need the full public webhook URL for verification.
      // Build it from HOST header + path. Works on Vercel / LightSail.
      const host = input.headers['x-forwarded-host'] ?? input.headers['host'] ?? ''
      const proto = input.headers['x-forwarded-proto'] ?? 'https'
      const webhookUrl = `${proto}://${host}/api/public/whatsapp/webhook`

      const params = typeof input.body === 'object' && input.body !== null
        ? (input.body as Record<string, string>)
        : {}

      try {
        const valid = verifyTwilioSignature(env.TWILIO_AUTH_TOKEN, twilioSig, webhookUrl, params)
        if (!valid) {
          return { handled: true, statusCode: 403, events: [] }
        }
      } catch {
        // If verification throws (e.g. malformed sig) treat as invalid
        return { handled: true, statusCode: 403, events: [] }
      }
    }

    // ── Parse Twilio form body ──────────────────────────────────────────────
    const body = typeof input.body === 'object' && input.body !== null
      ? (input.body as Record<string, string>)
      : {}

    const messageSid = body['MessageSid'] ?? null
    const from = body['From'] ? stripWhatsappPrefix(body['From']) : null
    const to = body['To'] ? stripWhatsappPrefix(body['To']) : null
    const text = body['Body'] ?? ''
    const smsStatus = body['SmsStatus'] ?? body['MessageStatus'] ?? null

    // Status update (delivery receipt) — not a message
    if (smsStatus && !text && !from) {
      return { handled: true, statusCode: 200, events: [] }
    }

    if (!from || !text) {
      return { handled: true, statusCode: 200, events: [] }
    }

    const event: WhatsAppInboundEvent = {
      eventType: 'message',
      messageType: 'text',
      sender: from,
      recipient: to,
      externalMessageId: messageSid,
      providerMessageId: messageSid,
      payload: body,
      normalizedPayload: { text, from, to, messageSid },
      receivedAt: new Date().toISOString(),
    }

    // ── Route to bot service ────────────────────────────────────────────────
    try {
      const registry = await import('../providers/providerRegistry.js')
      const whatsapp = registry.getAutomationProviderRegistry().whatsapp

      await processWhatsAppOwnerBotMessage({
        senderPhone: from,
        text,
        sendText: async ({ to: recipient, text: msg }) => {
          await whatsapp.sendFreeform({ recipient, text: msg })
        },
        sendAction: async ({ to: recipient, body: actionBody, title, footer, actions }) => {
          await whatsapp.sendActionMessage({ recipient, body: actionBody, title, footer, actions })
        },
      })
    } catch (err) {
      console.error('[twilio] bot processing error', err)
    }

    return { handled: true, statusCode: 200, events: [event] }
  }
}
