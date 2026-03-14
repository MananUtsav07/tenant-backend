import { sendOwnerRentPaymentApprovalNotification, sendOwnerTicketNotification } from '../lib/mailer.js'
import { AppError } from '../lib/errors.js'
import { createOwnerNotification, getOwnerById } from './ownerService.js'
import { getOwnerTelegramChatLink, sendTelegramMessage } from './telegramService.js'

function normalizeOwnerName(owner: { full_name?: string | null; company_name?: string | null; email: string }) {
  return owner.full_name || owner.company_name || owner.email
}

function listUniqueRecipientEmails(owner: { email: string; support_email?: string | null }) {
  return [owner.email, owner.support_email]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .filter((value, index, list) => list.indexOf(value) === index)
}

function formatCurrencyLabel(amount: number, currencyCode: string): string {
  const normalized = currencyCode.trim().toUpperCase() || 'INR'
  try {
    return new Intl.NumberFormat('en', {
      style: 'currency',
      currency: normalized,
      maximumFractionDigits: 0,
    }).format(amount)
  } catch {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount)
  }
}

function formatTicketTelegramMessage(input: {
  tenantName: string
  tenantAccessId: string
  propertyName: string | null
  unitNumber: string | null
  subject: string
  message: string
}) {
  const propertyLabel = input.propertyName
    ? `${input.propertyName}${input.unitNumber ? ` (${input.unitNumber})` : ''}`
    : '-'
  const messagePreview = input.message.length > 500 ? `${input.message.slice(0, 500)}...` : input.message

  return [
    'New support ticket',
    `Tenant: ${input.tenantName} (${input.tenantAccessId})`,
    `Property: ${propertyLabel}`,
    `Subject: ${input.subject}`,
    `Message: ${messagePreview}`,
  ].join('\n')
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

  const toEmail = listUniqueRecipientEmails(owner).join(', ')
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

  try {
    const telegramLink = await getOwnerTelegramChatLink({
      organizationId: input.organizationId,
      ownerId: input.ownerId,
    })

    if (telegramLink) {
      await sendTelegramMessage({
        chatId: telegramLink.chat_id,
        text: formatTicketTelegramMessage({
          tenantName: input.tenantName,
          tenantAccessId: input.tenantAccessId,
          propertyName: input.propertyName,
          unitNumber: input.unitNumber,
          subject: input.subject,
          message: input.message,
        }),
      })
    }
  } catch (error) {
    console.error('[notifyOwnerTicketCreated] telegram failed', error)
  }
}

export async function notifyOwnerRentPaymentAwaitingApproval(input: {
  organizationId: string
  ownerId: string
  tenantId: string
  tenantName: string
  tenantAccessId: string
  propertyName: string | null
  unitNumber: string | null
  dueDateIso: string
  amountPaid: number
  currencyCode: string
}) {
  const owner = await getOwnerById(input.ownerId, input.organizationId)
  if (!owner) {
    throw new AppError('Owner not found for rent payment notification', 404)
  }

  const dueDate = new Date(input.dueDateIso)
  const dueDateLabel = Number.isNaN(dueDate.getTime())
    ? input.dueDateIso.slice(0, 10)
    : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(dueDate)
  const amountPaidLabel = formatCurrencyLabel(input.amountPaid, input.currencyCode)

  await createOwnerNotification({
    organization_id: input.organizationId,
    owner_id: input.ownerId,
    tenant_id: input.tenantId,
    notification_type: 'rent_payment_awaiting_approval',
    title: `Rent payment awaiting approval: ${input.tenantName}`,
    message: `${input.tenantName} (${input.tenantAccessId}) marked ${amountPaidLabel} as paid for due date ${dueDateLabel}.`,
  })

  const toEmail = listUniqueRecipientEmails(owner).join(', ')
  try {
    await sendOwnerRentPaymentApprovalNotification({
      to: toEmail,
      ownerName: normalizeOwnerName(owner),
      tenantName: input.tenantName,
      tenantAccessId: input.tenantAccessId,
      propertyName: input.propertyName,
      unitNumber: input.unitNumber,
      dueDateLabel,
      amountPaidLabel,
    })
  } catch (error) {
    console.error('[notifyOwnerRentPaymentAwaitingApproval] email failed', error)
  }
}
