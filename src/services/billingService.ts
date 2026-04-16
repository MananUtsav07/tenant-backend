import { prisma } from '../lib/db.js'
import { AppError } from '../lib/errors.js'
import { createRazorpayOrder, verifyRazorpaySignature, type RazorpayPlanCode, PLAN_PRICES } from './razorpayService.js'

const TRIAL_DAYS = 14

export type SubscriptionStatus = 'trialing' | 'active' | 'past_due' | 'cancelled' | 'inactive'

export interface BillingState {
  status: SubscriptionStatus
  planCode: string | null
  planDisplayName: string
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
      planDisplayName: 'Free Trial',
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
    planDisplayName: getPlanDisplayName(subscription.plan_code),
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
  propertyCount?: number
}): Promise<{ orderId: string; amount: number; currency: string; keyId: string; planLabel: string }> {
  const order = await createRazorpayOrder({
    planCode: input.planCode,
    organizationId: input.organizationId,
    ownerEmail: input.ownerEmail,
    propertyCount: input.propertyCount,
  })

  // Store order ID on the subscription record
  await prisma.subscriptions.updateMany({
    where: { organization_id: input.organizationId },
    data: {
      razorpay_order_id: order.orderId,
      updated_at: new Date(),
    },
  })

  const count = input.planCode === 'beyond' ? Math.max(21, input.propertyCount ?? 21) : null
  const planLabel = input.planCode === 'beyond' && count !== null
    ? `$${(count * 1.5).toFixed(2)}/mo (${count} properties)`
    : PLAN_PRICES[input.planCode].label
  return { ...order, planLabel }
}

export const PLAN_LIMITS: Record<string, { maxProperties: number; maxTenants: number; whatsapp: boolean; telegram: boolean; ai: boolean; aiAdvanced: boolean }> = {
  trial:    { maxProperties: 3,   maxTenants: 15,  whatsapp: false, telegram: false, ai: false, aiAdvanced: false },
  starter:  { maxProperties: 3,   maxTenants: 15,  whatsapp: false, telegram: false, ai: false, aiAdvanced: false },
  standard: { maxProperties: 10,  maxTenants: 999, whatsapp: true,  telegram: true,  ai: true,  aiAdvanced: false },
  plus:     { maxProperties: 20,  maxTenants: 999, whatsapp: true,  telegram: true,  ai: true,  aiAdvanced: true  },
  beyond:   { maxProperties: 999, maxTenants: 999, whatsapp: true,  telegram: true,  ai: true,  aiAdvanced: true  },
}

export function getPlanDisplayName(planCode: string | null): string {
  switch (planCode) {
    case 'trial':    return 'Free Trial'
    case 'starter':  return 'Starter'
    case 'standard': return 'Standard'
    case 'plus':     return 'Plus'
    case 'beyond':   return 'Beyond'
    default:         return 'Free Trial'
  }
}

export async function getPlanLimits(organizationId: string) {
  const state = await getBillingState(organizationId)
  const planCode = state.status === 'trialing' && !state.isTrialExpired ? 'trial' : (state.planCode ?? 'starter')
  return PLAN_LIMITS[planCode] ?? PLAN_LIMITS['starter']
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
