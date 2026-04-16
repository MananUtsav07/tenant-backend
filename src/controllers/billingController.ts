import type { Request, Response } from 'express'
import { z } from 'zod'
import { AppError, asyncHandler } from '../lib/errors.js'
import { getBillingState, initiateSubscription, confirmSubscription } from '../services/billingService.js'
import { verifyRazorpayWebhookSignature } from '../services/razorpayService.js'

const planCodeSchema = z.enum(['starter', 'standard', 'plus', 'beyond'])

const initiateSchema = z.object({
  plan_code: planCodeSchema,
  property_count: z.number().int().min(21).optional(),
})

const confirmSchema = z.object({
  plan_code: planCodeSchema,
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
})

export const getBillingStateController = asyncHandler(async (request: Request, response: Response) => {
  const { organizationId } = request.owner!
  const state = await getBillingState(organizationId)
  response.json({ ok: true, billing: state })
})

export const initiateSubscriptionController = asyncHandler(async (request: Request, response: Response) => {
  const { organizationId, ownerId, email } = request.owner!
  const { plan_code, property_count } = initiateSchema.parse(request.body)

  const order = await initiateSubscription({
    organizationId,
    ownerId,
    ownerEmail: email,
    planCode: plan_code,
    propertyCount: property_count,
  })

  response.json({ ok: true, order })
})

export const confirmSubscriptionController = asyncHandler(async (request: Request, response: Response) => {
  const { organizationId, ownerId } = request.owner!
  const { plan_code, razorpay_order_id, razorpay_payment_id, razorpay_signature } = confirmSchema.parse(request.body)

  await confirmSubscription({
    organizationId,
    ownerId,
    planCode: plan_code,
    razorpayOrderId: razorpay_order_id,
    razorpayPaymentId: razorpay_payment_id,
    razorpaySignature: razorpay_signature,
  })

  const billing = await getBillingState(organizationId)
  response.json({ ok: true, billing })
})

export const razorpayWebhookController = asyncHandler(async (request: Request, response: Response) => {
  const signature = request.headers['x-razorpay-signature'] as string
  const rawBody = (request as Request & { rawBody?: string }).rawBody ?? JSON.stringify(request.body)

  if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
    throw new AppError('Invalid webhook signature', 400)
  }

  const event = request.body as { event: string; payload?: { payment?: { entity?: { notes?: Record<string, string> } } } }

  // We handle payment confirmation via the client-side confirm endpoint.
  // Webhook is used as a safety net for future recurring billing.
  if (event.event === 'payment.captured') {
    // Future: handle auto-renewal here
  }

  response.json({ ok: true })
})
