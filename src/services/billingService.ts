import { prisma } from '../lib/db.js'
import { AppError } from '../lib/errors.js'
import { createRazorpayOrder, verifyRazorpaySignature, type RazorpayPlanCode, PLAN_PRICES } from './razorpayService.js'

const TRIAL_DAYS = 14

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'inactive'

export interface BillingState {
  status: SubscriptionStatus
  planCode: string | null
  trialEndsAt: string | null
  currentPeriodEnd: string | null
  daysLeftInTrial: number | null
  isTrialExpired: boolean
  isActive: boolean
  canAccess: boolean
}

export async function createTrialSubscription(input: { organizationId: string; ownerId: string }): Promise<void> {
  const trialEnd = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000)

  // Check if subscription already exists
  const existing = await prisma.subscriptions.findFirst({
    where: { organization_id: input.organizationId },
  })
  if (existing) return

  await prisma.subscriptions.create({
    data: {
      organization_id: input.organizationId,
      owner_id: input.ownerId,
      plan_code: 'trial',
      status: 'trialing',
      current_period_start: new Date(),
      current_period_end: trialEnd,
    },
  })
}

export async function getBillingState(organizationId: string): Promise<BillingState> {
  const subscription = await prisma.subscriptions.findFirst({
    where: { organization_id: organizationId },
    orderBy: { created_at: 'desc' },
  })

  if (!subscription) {
    return {
      status: 'inactive',
      planCode: null,
      trialEndsAt: null,
      currentPeriodEnd: null,
      daysLeftInTrial: null,
      isTrialExpired: false,
      isActive: false,
      canAccess: false,
    }
  }

  const now = new Date()
  const periodEnd = subscription.current_period_end ? new Date(subscription.current_period_end) : null
  const isTrialing = subscription.status === 'trialing'
  const isTrialExpired = isTrialing && periodEnd !== null && now > periodEnd

  let daysLeftInTrial: number | null = null
  if (isTrialing && periodEnd) {
    const ms = periodEnd.getTime() - now.getTime()
    daysLeftInTrial = Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)))
  }

  const isActive = subscription.status === 'active' || (isTrialing && !isTrialExpired)
  const canAccess = isActive

  return {
    status: subscription.status as SubscriptionStatus,
    planCode: subscription.plan_code,
    trialEndsAt: periodEnd?.toISOString() ?? null,
    currentPeriodEnd: periodEnd?.toISOString() ?? null,
    daysLeftInTrial,
    isTrialExpired,
    isActive,
    canAccess,
  }
}

export async function initiateSubscription(input: {
  organizationId: string
  ownerId: string
  ownerEmail: string
  planCode: RazorpayPlanCode
}): Promise<{ orderId: string; amount: number; currency: string; keyId: string; planLabel: string }> {
  const order = await createRazorpayOrder({
    planCode: input.planCode,
    organizationId: input.organizationId,
    ownerEmail: input.ownerEmail,
  })

  // Store order ID on the subscription record
  await prisma.subscriptions.updateMany({
    where: { organization_id: input.organizationId },
    data: {
      razorpay_order_id: order.orderId,
      updated_at: new Date(),
    },
  })

  return { ...order, planLabel: PLAN_PRICES[input.planCode].label }
}

export async function confirmSubscription(input: {
  organizationId: string
  ownerId: string
  planCode: RazorpayPlanCode
  razorpayOrderId: string
  razorpayPaymentId: string
  razorpaySignature: string
}): Promise<void> {
  const isValid = verifyRazorpaySignature({
    orderId: input.razorpayOrderId,
    paymentId: input.razorpayPaymentId,
    signature: input.razorpaySignature,
  })

  if (!isValid) {
    throw new AppError('Payment verification failed — invalid signature', 400)
  }

  const now = new Date()
  const nextPeriodEnd = new Date(now)
  nextPeriodEnd.setMonth(nextPeriodEnd.getMonth() + 1)

  await prisma.subscriptions.updateMany({
    where: { organization_id: input.organizationId },
    data: {
      plan_code: input.planCode,
      status: 'active',
      current_period_start: now,
      current_period_end: nextPeriodEnd,
      razorpay_order_id: input.razorpayOrderId,
      razorpay_payment_id: input.razorpayPaymentId,
      razorpay_signature: input.razorpaySignature,
      updated_at: now,
    },
  })

  // Also update organization plan_code
  await prisma.organizations.update({
    where: { id: input.organizationId },
    data: { plan_code: input.planCode, updated_at: now } as never,
  })
}
