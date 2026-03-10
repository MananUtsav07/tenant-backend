import Stripe from 'stripe';
import { env } from '../config/env.js';
import { AppError, asyncHandler } from '../lib/errors.js';
import { createAnalyticsEvent } from '../services/analyticsService.js';
import { createAuditLog } from '../services/auditLogService.js';
import { createCheckoutSessionForOrganization, createPortalSessionForOrganization, getOrganizationBillingSnapshot, getStripeClient, markInvoicePaymentFailed, upsertStripeSubscription, } from '../services/billingService.js';
import { createCheckoutSessionSchema, createPortalSessionSchema } from '../validations/billingSchemas.js';
const stripe = getStripeClient();
function requireOwnerContext(request) {
    const ownerId = request.owner?.ownerId;
    const organizationId = request.owner?.organizationId ?? request.auth?.organizationId ?? null;
    if (!ownerId || !organizationId) {
        throw new AppError('Owner authentication required', 401);
    }
    return { ownerId, organizationId };
}
async function trackBillingEventSafe(eventName, metadata) {
    try {
        await createAnalyticsEvent({
            event_name: eventName,
            user_type: 'owner',
            metadata,
        });
    }
    catch (error) {
        console.error('[billing-analytics-failed]', { eventName, error });
    }
}
export const getOwnerBilling = asyncHandler(async (request, response) => {
    const { organizationId } = requireOwnerContext(request);
    const snapshot = await getOrganizationBillingSnapshot(organizationId);
    response.json({
        ok: true,
        billing: snapshot,
    });
});
export const postCreateCheckoutSession = asyncHandler(async (request, response) => {
    const { ownerId, organizationId } = requireOwnerContext(request);
    const parsed = createCheckoutSessionSchema.parse(request.body);
    const successUrl = parsed.success_url ?? `${env.FRONTEND_URL}/owner/billing?billing=success`;
    const cancelUrl = parsed.cancel_url ?? `${env.FRONTEND_URL}/owner/billing?billing=canceled`;
    const session = await createCheckoutSessionForOrganization({
        ownerId,
        organizationId,
        planCode: parsed.plan_code,
        successUrl,
        cancelUrl,
    });
    await trackBillingEventSafe('billing_checkout_session_created', {
        owner_id: ownerId,
        organization_id: organizationId,
        plan_code: parsed.plan_code,
        stripe_session_id: session.sessionId,
    });
    await createAuditLog({
        organization_id: organizationId,
        actor_id: ownerId,
        actor_role: 'owner',
        action: 'billing.checkout_session_created',
        entity_type: 'subscription',
        entity_id: session.sessionId,
        metadata: { plan_code: parsed.plan_code },
    });
    response.status(201).json({
        ok: true,
        session_id: session.sessionId,
        checkout_url: session.url,
    });
});
export const postCreatePortalSession = asyncHandler(async (request, response) => {
    const { ownerId, organizationId } = requireOwnerContext(request);
    const parsed = createPortalSessionSchema.parse(request.body);
    const returnUrl = parsed.return_url ?? `${env.FRONTEND_URL}/owner/billing`;
    const portal = await createPortalSessionForOrganization({
        ownerId,
        organizationId,
        returnUrl,
    });
    await trackBillingEventSafe('billing_portal_opened', {
        owner_id: ownerId,
        organization_id: organizationId,
    });
    await createAuditLog({
        organization_id: organizationId,
        actor_id: ownerId,
        actor_role: 'owner',
        action: 'billing.portal_opened',
        entity_type: 'subscription',
    });
    response.status(201).json({
        ok: true,
        portal_url: portal.url,
    });
});
function readStripeSignature(request) {
    const signature = request.header('stripe-signature');
    if (!signature) {
        throw new AppError('Missing Stripe signature header', 400);
    }
    return signature;
}
async function handleStripeSubscriptionEvent(subscription) {
    const saved = await upsertStripeSubscription(subscription);
    await trackBillingEventSafe('subscription_status_changed', {
        owner_id: saved.owner_id,
        organization_id: saved.organization_id,
        plan_code: saved.plan_code,
        status: saved.status,
        stripe_subscription_id: saved.stripe_subscription_id,
    });
    await createAuditLog({
        organization_id: saved.organization_id,
        actor_id: 'stripe-webhook',
        actor_role: 'system',
        action: 'billing.subscription_synced',
        entity_type: 'subscription',
        entity_id: saved.stripe_subscription_id,
        metadata: {
            owner_id: saved.owner_id,
            plan_code: saved.plan_code,
            status: saved.status,
        },
    });
}
function readInvoiceSubscriptionId(invoice) {
    const subscriptionRef = invoice.parent?.subscription_details?.subscription;
    if (!subscriptionRef) {
        return null;
    }
    return typeof subscriptionRef === 'string' ? subscriptionRef : subscriptionRef.id;
}
export const postStripeWebhook = asyncHandler(async (request, response) => {
    const signature = readStripeSignature(request);
    const rawBody = request.body;
    let event;
    try {
        event = stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
    }
    catch (error) {
        throw new AppError('Invalid Stripe webhook signature', 400, error instanceof Error ? error.message : 'Unknown signature error');
    }
    switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
            await handleStripeSubscriptionEvent(event.data.object);
            break;
        }
        case 'invoice.payment_failed': {
            const invoice = event.data.object;
            await markInvoicePaymentFailed(invoice);
            await trackBillingEventSafe('subscription_payment_failed', {
                stripe_invoice_id: invoice.id,
                stripe_subscription_id: readInvoiceSubscriptionId(invoice),
            });
            break;
        }
        default:
            break;
    }
    response.json({ ok: true });
});
//# sourceMappingURL=billingController.js.map