import Razorpay from 'razorpay'
import crypto from 'crypto'
import { env } from '../config/env.js'
import { AppError } from '../lib/errors.js'

function getRazorpayClient(): Razorpay {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw new AppError('Razorpay is not configured', 500)
  }
  return new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET })
}

export type RazorpayPlanCode = 'starter' | 'standard' | 'plus' | 'beyond'

// Prices in USD cents — Razorpay uses smallest currency unit
export const PLAN_PRICES: Record<RazorpayPlanCode, { amount: number; currency: string; label: string }> = {
  starter:  { amount: 600,  currency: 'USD', label: '$6/mo' },
  standard: { amount: 1200, currency: 'USD', label: '$12/mo' },
  plus:     { amount: 2000, currency: 'USD', label: '$20/mo' },
  beyond:   { amount: 3000, currency: 'USD', label: '$30/mo' },
}

export async function createRazorpayOrder(input: {
  planCode: RazorpayPlanCode
  organizationId: string
  ownerEmail: string
  propertyCount?: number  // only used for 'beyond' plan (min 21, $1.50/property)
}): Promise<{ orderId: string; amount: number; currency: string; keyId: string }> {
  const razorpay = getRazorpayClient()
  const plan = PLAN_PRICES[input.planCode]

  // For Beyond plan: $25 base (21 props) + $1.50 per additional property
  const amount = input.planCode === 'beyond'
    ? 2500 + Math.max(0, (input.propertyCount ?? 21) - 21) * 150
    : plan.amount

  const order = await razorpay.orders.create({
    amount,
    currency: plan.currency,
    receipt: `org_${input.organizationId.slice(0, 8)}`,
    notes: {
      organization_id: input.organizationId,
      plan_code: input.planCode,
      owner_email: input.ownerEmail,
      ...(input.planCode === 'beyond' ? { property_count: String(input.propertyCount ?? 21) } : {}),
    },
  })

  return {
    orderId: order.id,
    amount,
    currency: plan.currency,
    keyId: env.RAZORPAY_KEY_ID!,
  }
}

export function verifyRazorpaySignature(input: {
  orderId: string
  paymentId: string
  signature: string
}): boolean {
  if (!env.RAZORPAY_KEY_SECRET) return false
  const body = `${input.orderId}|${input.paymentId}`
  const expectedSignature = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(body)
    .digest('hex')
  return expectedSignature === input.signature
}

export function verifyRazorpayWebhookSignature(rawBody: string, signature: string): boolean {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return false
  const expectedSignature = crypto
    .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex')
  return expectedSignature === signature
}
