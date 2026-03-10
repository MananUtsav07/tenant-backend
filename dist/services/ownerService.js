import { AppError } from '../lib/errors.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { generateTenantAccessId } from '../utils/ids.js';
import { isTicketSummarizationEnabled } from './ai/featureFlags.js';
import { createOrganization, upsertOwnerMembership } from './organizationService.js';
function throwIfError(error, message) {
    if (error) {
        throw new AppError(message, 500, error.message);
    }
}
export async function findOwnerByEmail(email) {
    const { data, error } = await supabaseAdmin
        .from('owners')
        .select('*, organizations(id, name, slug, plan_code, created_at)')
        .eq('email', email)
        .maybeSingle();
    throwIfError(error, 'Failed to query owner');
    return data;
}
export async function createOwner(input) {
    const organizationName = input.company_name?.trim() || input.full_name?.trim() || `${input.email.split('@')[0] ?? 'Owner'} Organization`;
    const organization = input.organization_id
        ? { id: input.organization_id }
        : await createOrganization({
            name: organizationName,
            plan_code: 'starter',
        });
    try {
        const { data, error } = await supabaseAdmin
            .from('owners')
            .insert({
            email: input.email,
            password_hash: input.password_hash,
            full_name: input.full_name ?? null,
            company_name: input.company_name ?? null,
            support_email: input.support_email ?? input.email,
            support_whatsapp: input.support_whatsapp ?? null,
            organization_id: organization.id,
        })
            .select('*, organizations(id, name, slug, plan_code, created_at)')
            .single();
        throwIfError(error, 'Failed to create owner');
        await upsertOwnerMembership({
            organization_id: organization.id,
            owner_id: data.id,
            role: 'owner',
        });
        return data;
    }
    catch (error) {
        if (!input.organization_id) {
            await supabaseAdmin.from('organizations').delete().eq('id', organization.id);
        }
        throw error;
    }
}
export async function getOwnerById(ownerId, organizationId) {
    let request = supabaseAdmin
        .from('owners')
        .select('*, organizations(id, name, slug, plan_code, created_at)')
        .eq('id', ownerId);
    if (organizationId) {
        request = request.eq('organization_id', organizationId);
    }
    const { data, error } = await request.maybeSingle();
    throwIfError(error, 'Failed to fetch owner');
    return data;
}
export async function createProperty(args) {
    const { data, error } = await supabaseAdmin
        .from('properties')
        .insert({
        owner_id: args.ownerId,
        organization_id: args.organizationId,
        property_name: args.input.property_name,
        address: args.input.address,
        unit_number: args.input.unit_number ?? null,
    })
        .select('*')
        .single();
    throwIfError(error, 'Failed to create property');
    return data;
}
export async function listProperties(organizationId) {
    const { data, error } = await supabaseAdmin
        .from('properties')
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
    throwIfError(error, 'Failed to list properties');
    return data ?? [];
}
export async function getPropertyForOwner(organizationId, propertyId) {
    const { data, error } = await supabaseAdmin
        .from('properties')
        .select('*')
        .eq('id', propertyId)
        .eq('organization_id', organizationId)
        .maybeSingle();
    throwIfError(error, 'Failed to fetch property');
    return data;
}
export async function updateProperty(organizationId, propertyId, patch) {
    const { data, error } = await supabaseAdmin
        .from('properties')
        .update(patch)
        .eq('id', propertyId)
        .eq('organization_id', organizationId)
        .select('*')
        .maybeSingle();
    throwIfError(error, 'Failed to update property');
    return data;
}
export async function deleteProperty(organizationId, propertyId) {
    const { error, count } = await supabaseAdmin
        .from('properties')
        .delete({ count: 'exact' })
        .eq('id', propertyId)
        .eq('organization_id', organizationId);
    throwIfError(error, 'Failed to delete property');
    return count ?? 0;
}
async function buildUniqueTenantAccessId() {
    let attempts = 0;
    while (attempts < 8) {
        attempts += 1;
        const candidate = generateTenantAccessId();
        const { data, error } = await supabaseAdmin
            .from('tenants')
            .select('id')
            .eq('tenant_access_id', candidate)
            .maybeSingle();
        throwIfError(error, 'Failed to verify tenant access id uniqueness');
        if (!data) {
            return candidate;
        }
    }
    throw new AppError('Could not generate unique tenant access id', 500);
}
export async function createTenant(args) {
    const tenantAccessId = await buildUniqueTenantAccessId();
    const { data, error } = await supabaseAdmin
        .from('tenants')
        .insert({
        owner_id: args.ownerId,
        organization_id: args.organizationId,
        property_id: args.input.property_id,
        full_name: args.input.full_name,
        email: args.input.email ?? null,
        phone: args.input.phone ?? null,
        tenant_access_id: tenantAccessId,
        password_hash: args.input.password_hash,
        lease_start_date: args.input.lease_start_date ?? null,
        lease_end_date: args.input.lease_end_date ?? null,
        monthly_rent: args.input.monthly_rent,
        payment_due_day: args.input.payment_due_day,
        payment_status: args.input.payment_status ?? 'pending',
        status: args.input.status ?? 'active',
    })
        .select('*')
        .single();
    throwIfError(error, 'Failed to create tenant');
    return data;
}
export async function listTenants(organizationId) {
    const { data, error } = await supabaseAdmin
        .from('tenants')
        .select('*, properties(id, property_name, address, unit_number)')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
    throwIfError(error, 'Failed to list tenants');
    return data ?? [];
}
export async function getTenantForOwner(organizationId, tenantId) {
    const { data, error } = await supabaseAdmin
        .from('tenants')
        .select('*, properties(*)')
        .eq('id', tenantId)
        .eq('organization_id', organizationId)
        .maybeSingle();
    throwIfError(error, 'Failed to fetch tenant');
    return data;
}
export async function updateTenant(organizationId, tenantId, patch) {
    const { data, error } = await supabaseAdmin
        .from('tenants')
        .update(patch)
        .eq('id', tenantId)
        .eq('organization_id', organizationId)
        .select('*')
        .maybeSingle();
    throwIfError(error, 'Failed to update tenant');
    return data;
}
export async function deleteTenant(organizationId, tenantId) {
    const { error, count } = await supabaseAdmin
        .from('tenants')
        .delete({ count: 'exact' })
        .eq('id', tenantId)
        .eq('organization_id', organizationId);
    throwIfError(error, 'Failed to delete tenant');
    return count ?? 0;
}
export async function getTenantDetailAggregate(organizationId, tenantId) {
    const tenant = await getTenantForOwner(organizationId, tenantId);
    if (!tenant) {
        return null;
    }
    const aiTicketSummariesEnabled = await isTicketSummarizationEnabled(organizationId);
    if (aiTicketSummariesEnabled) {
        // Infrastructure-only hook:
        // Ticket summarization is intentionally disabled in live flows for now.
        // Future rollout will add summary payload fields to this aggregate.
    }
    const [{ data: tickets, error: ticketsError }, { data: reminders, error: remindersError }] = await Promise.all([
        supabaseAdmin
            .from('support_tickets')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('organization_id', organizationId)
            .order('created_at', { ascending: false }),
        supabaseAdmin
            .from('rent_reminders')
            .select('*')
            .eq('tenant_id', tenantId)
            .eq('organization_id', organizationId)
            .order('scheduled_for', { ascending: false }),
    ]);
    throwIfError(ticketsError, 'Failed to load tenant tickets');
    throwIfError(remindersError, 'Failed to load tenant reminders');
    return {
        tenant,
        tickets: tickets ?? [],
        reminders: reminders ?? [],
    };
}
export async function listOwnerTickets(organizationId) {
    const { data, error } = await supabaseAdmin
        .from('support_tickets')
        .select('*, tenants(id, full_name, tenant_access_id, property_id, properties(id, property_name))')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
    throwIfError(error, 'Failed to list owner tickets');
    return data ?? [];
}
export async function updateOwnerTicket(organizationId, ticketId, status) {
    const { data, error } = await supabaseAdmin
        .from('support_tickets')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', ticketId)
        .eq('organization_id', organizationId)
        .select('*')
        .maybeSingle();
    throwIfError(error, 'Failed to update ticket');
    return data;
}
export async function listOwnerNotifications(organizationId) {
    const { data, error } = await supabaseAdmin
        .from('owner_notifications')
        .select('*, tenants(id, full_name, tenant_access_id)')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
    throwIfError(error, 'Failed to list notifications');
    return data ?? [];
}
export async function markNotificationRead(organizationId, notificationId) {
    const { data, error } = await supabaseAdmin
        .from('owner_notifications')
        .update({ is_read: true })
        .eq('id', notificationId)
        .eq('organization_id', organizationId)
        .select('*')
        .maybeSingle();
    throwIfError(error, 'Failed to update notification');
    return data;
}
export async function createOwnerNotification(input) {
    const { data, error } = await supabaseAdmin
        .from('owner_notifications')
        .insert({
        owner_id: input.owner_id,
        tenant_id: input.tenant_id ?? null,
        notification_type: input.notification_type,
        title: input.title,
        message: input.message,
        organization_id: input.organization_id,
    })
        .select('*')
        .single();
    throwIfError(error, 'Failed to create owner notification');
    return data;
}
export async function getOwnerDashboardSummary(organizationId) {
    const [tenantsResult, ticketsResult, overdueResult, remindersResult, unreadNotificationsResult] = await Promise.all([
        supabaseAdmin
            .from('tenants')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('status', 'active'),
        supabaseAdmin
            .from('support_tickets')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .in('status', ['open', 'in_progress']),
        supabaseAdmin
            .from('tenants')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('payment_status', 'overdue'),
        supabaseAdmin
            .from('rent_reminders')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('status', 'pending'),
        supabaseAdmin
            .from('owner_notifications')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', organizationId)
            .eq('is_read', false),
    ]);
    throwIfError(tenantsResult.error, 'Failed to count active tenants');
    throwIfError(ticketsResult.error, 'Failed to count open tickets');
    throwIfError(overdueResult.error, 'Failed to count overdue rents');
    throwIfError(remindersResult.error, 'Failed to count pending reminders');
    throwIfError(unreadNotificationsResult.error, 'Failed to count unread notifications');
    return {
        active_tenants: tenantsResult.count ?? 0,
        open_tickets: ticketsResult.count ?? 0,
        overdue_rent: overdueResult.count ?? 0,
        reminders_pending: remindersResult.count ?? 0,
        unread_notifications: unreadNotificationsResult.count ?? 0,
    };
}
//# sourceMappingURL=ownerService.js.map