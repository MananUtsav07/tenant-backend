import { sendOwnerTicketNotification } from '../lib/mailer.js';
import { AppError } from '../lib/errors.js';
import { createOwnerNotification, getOwnerById } from './ownerService.js';
function normalizeOwnerName(owner) {
    return owner.full_name || owner.company_name || owner.email;
}
export async function notifyOwnerTicketCreated(input) {
    const owner = await getOwnerById(input.ownerId, input.organizationId);
    if (!owner) {
        throw new AppError('Owner not found for ticket notification', 404);
    }
    await createOwnerNotification({
        organization_id: input.organizationId,
        owner_id: input.ownerId,
        tenant_id: input.tenantId,
        notification_type: 'ticket_created',
        title: `New support ticket from ${input.tenantName}`,
        message: `${input.subject}: ${input.message}`,
    });
    const toEmail = owner.support_email || owner.email;
    try {
        await sendOwnerTicketNotification({
            to: toEmail,
            ownerName: normalizeOwnerName(owner),
            tenantName: input.tenantName,
            tenantAccessId: input.tenantAccessId,
            propertyName: input.propertyName,
            unitNumber: input.unitNumber,
            subject: input.subject,
            message: input.message,
        });
    }
    catch (error) {
        console.error('[notifyOwnerTicketCreated] email failed', error);
    }
}
//# sourceMappingURL=notificationService.js.map