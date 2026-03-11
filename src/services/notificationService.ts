import { sendOwnerTicketNotification } from '../lib/mailer.js'
import { AppError } from '../lib/errors.js'
import { createOwnerNotification, getOwnerById } from './ownerService.js'

function normalizeOwnerName(owner: { full_name?: string | null; company_name?: string | null; email: string }) {
  return owner.full_name || owner.company_name || owner.email
}

export async function notifyOwnerTicketCreated(input: {
  organizationId: string
  ownerId: string
  tenantId: string
  tenantName: string
  tenantAccessId: string
  propertyName: string | null
  unitNumber: string | null
  subject: string
  message: string
}) {
  const owner = await getOwnerById(input.ownerId, input.organizationId)
  if (!owner) {
    throw new AppError('Owner not found for ticket notification', 404)
  }

  await createOwnerNotification({
    organization_id: input.organizationId,
    owner_id: input.ownerId,
    tenant_id: input.tenantId,
    notification_type: 'ticket_created',
    title: `New support ticket from ${input.tenantName}`,
    message: `${input.subject}: ${input.message}`,
  })

  const toEmail = [owner.email, owner.support_email]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .filter((value, index, list) => list.indexOf(value) === index)
    .join(', ')
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
    })
  } catch (error) {
    console.error('[notifyOwnerTicketCreated] email failed', error)
  }
}
