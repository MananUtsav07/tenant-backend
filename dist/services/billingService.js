import Stripe from 'stripe';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { supabaseAdmin } from '../lib/supabase.js';
const stripe = new Stripe(env.STRIPE_SECRET_KEY);
const PLAN_CODES = ['starter', 'professional', 'enterprise'];
const ACTIVE_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due', 'unpaid'];
function throwIfError(error, message) {
    if (error) {
        throw new AppError(message, 500, error.message);
    }
}
function isPlanCode(value) {
    return PLAN_CODES.includes(value);
}
function normalizePlanCode(value) {
    if (!value) {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    if (isPlanCode(normalized)) {
        return normalized;
    }
    return null;
}
function toPlanRecord(row) {
    const planCode = normalizePlanCode(row.plan_code);
    if (!planCode) {
        throw new AppError(`Unsupported plan_code "${row.plan_code}" found in plans table`, 500);
    }
    return {
        plan_code: planCode,
        plan_name: row.plan_name,
        monthly_price: row.monthly_price,
        features: Array.isArray(row.features) ? row.features.filter((item) => typeof item === 'string') : [],
    };
}
function toSubscriptionRecord(row) {
    const planCode = normalizePlanCode(row.plan_code);
    if (!planCode) {
        throw new AppError(`Unsupported plan_code "${row.plan_code}" found in subscriptions table`, 500);
    }
    return {
        ...row,
        plan_code: planCode,
    };
}
async function getOwnerIdentity(ownerId, organizationId) {
    const { data, error } = await supabaseAdmin
        .from('owners')
        .select('id, email, full_name, organization_id')
        .eq('id', ownerId)
        .eq('organization_id', organizationId)
        .maybeSingle();
    throwIfError(error, 'Failed to load owner profile for billing');
    if (!data) {
        throw new AppError('Owner not found for billing in organization context', 404);
    }
    return data;
}
async function resolveDefaultOwnerForOrganization(organizationId) {
    const { data, error } = await supabaseAdmin
        .from('owner_memberships')
        .select('owner_id')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
    throwIfError(error, 'Failed to resolve default owner for organization');
    if (!data?.owner_id) {
        throw new AppError('No owner membership found for organization billing context', 404);
    }
    return data.owner_id;
}
async function findStoredCustomerId(organizationId) {
    const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .select('stripe_customer_id')
        .eq('organization_id', organizationId)
        .not('stripe_customer_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    throwIfError(error, 'Failed to read Stripe customer id');
    return data?.stripe_customer_id ?? null;
}
async function ensureStripeCustomer(input) {
    const storedCustomerId = await findStoredCustomerId(input.organizationId);
    if (storedCustomerId) {
        return storedCustomerId;
    }
    const owner = await getOwnerIdentity(input.ownerId, input.organizationId);
    const existingByEmail = await stripe.customers.list({
        email: owner.email,
        limit: 10,
    });
    const mappedCustomer = existingByEmail.data.find((customer) => customer.metadata?.organization_id === input.organizationId);
    if (mappedCustomer) {
        return mappedCustomer.id;
    }
    const created = await stripe.customers.create({
        email: owner.email,
        name: owner.full_name ?? owner.email,
        metadata: {
            owner_id: input.ownerId,
            organization_id: input.organizationId,
            app: 'tenantflow',
        },
    });
    return created.id;
}
async function resolveMonthlyPriceId(planCode) {
    const candidateLookupKeys = [`tenantflow_${planCode}_monthly`, `${planCode}_monthly`, planCode];
    const listed = await stripe.prices.list({
        active: true,
        limit: 100,
    });
    const matched = listed.data.find((price) => {
        if (price.type !== 'recurring' || price.recurring?.interval !== 'month') {
            return false;
        }
        const lookupKey = price.lookup_key?.toLowerCase() ?? null;
        const metadataPlan = normalizePlanCode(price.metadata?.plan_code);
        return (lookupKey ? candidateLookupKeys.includes(lookupKey) : false) || metadataPlan === planCode;
    });
    if (!matched) {
        throw new AppError(`No active monthly Stripe price configured for ${planCode}. Set lookup_key to tenantflow_${planCode}_monthly or price metadata.plan_code.`, 400);
    }
    return matched.id;
}
async function resolveOrganizationIdFromCustomer(customerId) {
    const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .select('organization_id')
        .eq('stripe_customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    throwIfError(error, 'Failed to map Stripe customer to organization');
    if (data?.organization_id) {
        return data.organization_id;
    }
    const customer = await stripe.customers.retrieve(customerId);
    if (!customer || customer.deleted) {
        return null;
    }
    const organizationId = customer.metadata?.organization_id;
    return typeof organizationId === 'string' && organizationId.length > 0 ? organizationId : null;
}
async function resolvePlanCodeFromSubscription(subscription) {
    const metadataPlan = normalizePlanCode(subscription.metadata?.plan_code);
    if (metadataPlan) {
        return metadataPlan;
    }
    const item = subscription.items.data[0];
    const priceLookup = item?.price.lookup_key ? normalizePlanCode(item.price.lookup_key) : null;
    if (priceLookup) {
        return priceLookup;
    }
    const priceMetadataPlan = normalizePlanCode(item?.price.metadata?.plan_code);
    if (priceMetadataPlan) {
        return priceMetadataPlan;
    }
    const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .select('plan_code')
        .eq('stripe_subscription_id', subscription.id)
        .maybeSingle();
    throwIfError(error, 'Failed to resolve existing subscription plan');
    const existingPlan = normalizePlanCode(data?.plan_code);
    return existingPlan ?? 'starter';
}
function readInvoiceSubscriptionId(invoice) {
    const subscriptionRef = invoice.parent?.subscription_details?.subscription;
    if (!subscriptionRef) {
        return null;
    }
    return typeof subscriptionRef === 'string' ? subscriptionRef : subscriptionRef.id;
}
export function getStripeClient() {
    return stripe;
}
export async function listPlans() {
    const { data, error } = await supabaseAdmin.from('plans').select('plan_code, plan_name, monthly_price, features').order('monthly_price');
    throwIfError(error, 'Failed to list billing plans');
    return (data ?? []).map((row) => toPlanRecord(row));
}
export async function getPlanByCode(planCode) {
    const { data, error } = await supabaseAdmin
        .from('plans')
        .select('plan_code, plan_name, monthly_price, features')
        .eq('plan_code', planCode)
        .maybeSingle();
    throwIfError(error, 'Failed to load billing plan');
    return data ? toPlanRecord(data) : null;
}
export async function getOrganizationCurrentSubscription(organizationId) {
    const { data: activeData, error: activeError } = await supabaseAdmin
        .from('subscriptions')
        .select('id, organization_id, owner_id, stripe_customer_id, stripe_subscription_id, plan_code, status, current_period_start, current_period_end, created_at')
        .eq('organization_id', organizationId)
        .in('status', [...ACTIVE_SUBSCRIPTION_STATUSES])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    throwIfError(activeError, 'Failed to load active organization subscription');
    if (activeData) {
        return toSubscriptionRecord(activeData);
    }
    const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .select('id, organization_id, owner_id, stripe_customer_id, stripe_subscription_id, plan_code, status, current_period_start, current_period_end, created_at')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    throwIfError(error, 'Failed to load organization subscription');
    return data ? toSubscriptionRecord(data) : null;
}
export async function getOrganizationCurrentPlanCode(organizationId) {
    const subscription = await getOrganizationCurrentSubscription(organizationId);
    return subscription?.plan_code ?? 'starter';
}
export async function getOrganizationBillingSnapshot(organizationId) {
    const [plans, currentSubscription] = await Promise.all([listPlans(), getOrganizationCurrentSubscription(organizationId)]);
    return {
        current_plan_code: currentSubscription?.plan_code ?? 'starter',
        current_subscription: currentSubscription,
        next_billing_date: currentSubscription?.current_period_end ?? null,
        plans,
    };
}
export async function createCheckoutSessionForOrganization(args) {
    const plan = await getPlanByCode(args.planCode);
    if (!plan) {
        throw new AppError('Selected plan does not exist', 404);
    }
    const existing = await getOrganizationCurrentSubscription(args.organizationId);
    if (existing && ACTIVE_SUBSCRIPTION_STATUSES.includes(existing.status)) {
        throw new AppError('An active subscription already exists. Use Manage Billing to upgrade or cancel.', 409);
    }
    const customerId = await ensureStripeCustomer({
        ownerId: args.ownerId,
        organizationId: args.organizationId,
    });
    const priceId = await resolveMonthlyPriceId(args.planCode);
    const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        line_items: [
            {
                price: priceId,
                quantity: 1,
            },
        ],
        success_url: args.successUrl,
        cancel_url: args.cancelUrl,
        allow_promotion_codes: true,
        client_reference_id: args.organizationId,
        metadata: {
            owner_id: args.ownerId,
            organization_id: args.organizationId,
            plan_code: plan.plan_code,
        },
        subscription_data: {
            metadata: {
                owner_id: args.ownerId,
                organization_id: args.organizationId,
                plan_code: plan.plan_code,
            },
        },
    });
    return {
        sessionId: session.id,
        url: session.url,
    };
}
export async function createPortalSessionForOrganization(args) {
    const customerId = await ensureStripeCustomer({
        ownerId: args.ownerId,
        organizationId: args.organizationId,
    });
    const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: args.returnUrl,
    });
    return { url: session.url };
}
export async function upsertStripeSubscription(subscription) {
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    const organizationIdFromMeta = subscription.metadata?.organization_id;
    const organizationId = typeof organizationIdFromMeta === 'string' && organizationIdFromMeta.length > 0
        ? organizationIdFromMeta
        : await resolveOrganizationIdFromCustomer(customerId);
    if (!organizationId) {
        throw new AppError('Unable to resolve organization from Stripe subscription event', 400);
    }
    const ownerIdFromMeta = subscription.metadata?.owner_id;
    const ownerId = typeof ownerIdFromMeta === 'string' && ownerIdFromMeta.length > 0
        ? ownerIdFromMeta
        : await resolveDefaultOwnerForOrganization(organizationId);
    const planCode = await resolvePlanCodeFromSubscription(subscription);
    const subscriptionItem = subscription.items.data[0];
    const currentPeriodStart = subscriptionItem?.current_period_start
        ? new Date(subscriptionItem.current_period_start * 1000).toISOString()
        : null;
    const currentPeriodEnd = subscriptionItem?.current_period_end ? new Date(subscriptionItem.current_period_end * 1000).toISOString() : null;
    const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .upsert({
        owner_id: ownerId,
        organization_id: organizationId,
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
        plan_code: planCode,
        status: subscription.status,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
    }, { onConflict: 'stripe_subscription_id' })
        .select('id, organization_id, owner_id, stripe_customer_id, stripe_subscription_id, plan_code, status, current_period_start, current_period_end, created_at')
        .maybeSingle();
    throwIfError(error, 'Failed to upsert Stripe subscription');
    if (!data) {
        throw new AppError('Failed to persist Stripe subscription', 500);
    }
    const { error: orgPlanError } = await supabaseAdmin
        .from('organizations')
        .update({ plan_code: planCode })
        .eq('id', organizationId);
    throwIfError(orgPlanError, 'Failed to sync organization plan');
    return toSubscriptionRecord(data);
}
export async function markInvoicePaymentFailed(invoice) {
    const subscriptionId = readInvoiceSubscriptionId(invoice);
    if (subscriptionId) {
        const { error } = await supabaseAdmin
            .from('subscriptions')
            .update({ status: 'past_due' })
            .eq('stripe_subscription_id', subscriptionId);
        throwIfError(error, 'Failed to mark subscription as past due');
        return;
    }
    const customerId = typeof invoice.customer === 'string' ? invoice.customer : null;
    if (!customerId) {
        return;
    }
    const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .select('id')
        .eq('stripe_customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
    throwIfError(error, 'Failed to find subscription for failed payment');
    if (!data?.id) {
        return;
    }
    const { error: updateError } = await supabaseAdmin.from('subscriptions').update({ status: 'past_due' }).eq('id', data.id);
    throwIfError(updateError, 'Failed to update failed payment status');
}
export async function getRevenueSummary() {
    const { data, error } = await supabaseAdmin
        .from('subscriptions')
        .select('organization_id, plan_code, status, plans(monthly_price)');
    throwIfError(error, 'Failed to load subscription revenue metrics');
    const rows = (data ?? []);
    const activeStatuses = new Set(ACTIVE_SUBSCRIPTION_STATUSES);
    const churnedStatuses = new Set(['canceled', 'unpaid', 'incomplete_expired']);
    const planCounts = new Map();
    const countedActiveOrganizations = new Set();
    let mrr = 0;
    let activeSubscriptions = 0;
    let churnedSubscriptions = 0;
    for (const row of rows) {
        const planCode = normalizePlanCode(row.plan_code);
        if (!planCode) {
            continue;
        }
        if (activeStatuses.has(row.status) && !countedActiveOrganizations.has(row.organization_id)) {
            countedActiveOrganizations.add(row.organization_id);
            activeSubscriptions += 1;
            planCounts.set(planCode, (planCounts.get(planCode) ?? 0) + 1);
            const planData = Array.isArray(row.plans) ? row.plans[0] : row.plans;
            mrr += Number(planData?.monthly_price ?? 0);
        }
        if (churnedStatuses.has(row.status)) {
            churnedSubscriptions += 1;
        }
    }
    return {
        total_subscriptions: rows.length,
        monthly_recurring_revenue: mrr,
        active_subscriptions: activeSubscriptions,
        churned_subscriptions: churnedSubscriptions,
        active_plans: PLAN_CODES.map((planCode) => ({
            plan_code: planCode,
            count: planCounts.get(planCode) ?? 0,
        })),
    };
}
export function planSatisfies(requiredPlan, actualPlan) {
    const rank = {
        starter: 1,
        professional: 2,
        enterprise: 3,
    };
    return rank[actualPlan] >= rank[requiredPlan];
}
//# sourceMappingURL=billingService.js.map