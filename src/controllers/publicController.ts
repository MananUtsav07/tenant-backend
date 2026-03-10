import type { Request, Response } from 'express'

import { env } from '../config/env.js'
import { asyncHandler } from '../lib/errors.js'
import { sendPublicContactNotification } from '../lib/mailer.js'
import { createAnalyticsEvent } from '../services/analyticsService.js'
import { createContactMessage, getPublicOperationsSnapshot } from '../services/publicService.js'
import { createAnalyticsEventSchema, createContactMessageSchema } from '../validations/publicSchemas.js'

async function trackAnalyticsSafe(input: {
  event_name: string
  user_type: 'public'
  metadata: Record<string, unknown>
}) {
  try {
    await createAnalyticsEvent(input)
  } catch (error) {
    console.error('[analytics-event-failed]', {
      event_name: input.event_name,
      error,
    })
  }
}

export const postPublicContactMessage = asyncHandler(async (request: Request, response: Response) => {
  const parsed = createContactMessageSchema.parse(request.body)
  const contactMessage = await createContactMessage(parsed)

  await trackAnalyticsSafe({
    event_name: 'contact_form_submit',
    user_type: 'public',
    metadata: {
      contact_message_id: contactMessage.id,
    },
  })

  try {
    await sendPublicContactNotification({
      to: env.EMAIL_USER,
      name: parsed.name,
      email: parsed.email,
      message: parsed.message,
      createdAt: contactMessage.created_at,
    })
  } catch (mailError) {
    console.error('[contact-notification-email-failed]', {
      requestId: request.requestId,
      error: mailError,
    })
  }

  response.status(201).json({
    ok: true,
    message: 'Contact message submitted successfully',
    contact_message: contactMessage,
  })
})

export const postPublicAnalyticsEvent = asyncHandler(async (request: Request, response: Response) => {
  const parsed = createAnalyticsEventSchema.parse(request.body)
  const event = await createAnalyticsEvent({
    event_name: parsed.event_name,
    user_type: parsed.user_type,
    metadata: parsed.metadata,
  })

  response.status(201).json({
    ok: true,
    event,
  })
})

export const getPublicSnapshot = asyncHandler(async (_request: Request, response: Response) => {
  const snapshot = await getPublicOperationsSnapshot()
  response.json({
    ok: true,
    snapshot,
  })
})
