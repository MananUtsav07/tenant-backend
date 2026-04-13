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

export type RazorpayPlanCode = 'starter' | 'professional'

// Prices in paise (INR) and cents (USD) — Razorpay uses smallest currency unit
export const PLAN_PRICES: Record<RazorpayPlanCode, { amount: number; currency: string; label: string }> = {
  starter:      { amount: 249900, currency: 'INR', label: '₹2,499/mo' },
  professional: { amount: 829900, currency: 'INR', label: '₹8,299/mo' },
}

export async function createRazorpayOrder(input: {
  planCode: RazorpayPlanCode
  organizationId: string
  ownerEmail: string
}): Promise<{ orderId: string; amount: number; currency: string; keyId: string }> {
  const razorpay = getRazorpayClient()
  const plan = PLAN_PRICES[input.planCode]

  const order = await razorpay.orders.create({
    amount: plan.amount,
    currency: plan.currency,
    receipt: `org_${input.organizationId.slice(0, 8)}`,
    notes: {
      organization_id: input.organizationId,
      plan_code: input.planCode,
      owner_email: input.ownerEmail,
    },
  })

  return {
    orderId: order.id,
    amount: plan.amount,
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
