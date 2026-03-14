import { env } from '../config/env.js'
import {
  sendOwnerRentPaymentApprovalNotification,
  sendOwnerTicketReplyNotification,
  sendOwnerTicketNotification,
  sendTenantCredentialNotification,
  sendTenantPasswordChangeRecommendationEmail,
  sendTenantRentPaymentApprovedEmail,
  sendTenantRentPaymentRejectedEmail,
  sendTenantTicketClosedEmail,
  sendTenantTicketReplyEmail,
} from '../lib/mailer.js'
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

function formatDateLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value.slice(0, 10)
    : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(date)
}

function buildFrontendUrl(path: string): string {
  return new URL(path, `${env.FRONTEND_URL.replace(/\/$/, '')}/`).toString()
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

export async function notifyOwnerTicketReply(input: {
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
    throw new AppError('Owner not found for ticket reply notification', 404)
  }

  await createOwnerNotification({
    organization_id: input.organizationId,
    owner_id: input.ownerId,
    tenant_id: input.tenantId,
    notification_type: 'ticket_reply',
    title: `New ticket reply from ${input.tenantName}`,
    message: `${input.subject}: ${input.message}`,
  })

  const toEmail = listUniqueRecipientEmails(owner).join(', ')
  try {
    await sendOwnerTicketReplyNotification({
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
    console.error('[notifyOwnerTicketReply] email failed', error)
  }

  try {
    const telegramLink = await getOwnerTelegramChatLink({
      organizationId: input.organizationId,
      ownerId: input.ownerId,
    })

    if (telegramLink) {
      await sendTelegramMessage({
        chatId: telegramLink.chat_id,
        text: [
          'New tenant reply',
          `Tenant: ${input.tenantName} (${input.tenantAccessId})`,
          `Subject: ${input.subject}`,
          `Reply: ${input.message.length > 500 ? `${input.message.slice(0, 500)}...` : input.message}`,
        ].join('\n'),
      })
    }
  } catch (error) {
    console.error('[notifyOwnerTicketReply] telegram failed', error)
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

export async function notifyTenantTicketReply(input: {
  organizationId: string
  ownerId: string
  tenantId: string
  tenantEmail: string | null
  tenantName: string
  subject: string
  senderName: string
  senderRoleLabel: string
  propertyName: string | null
  unitNumber: string | null
  message: string
}) {
  const tenantEmail = input.tenantEmail?.trim().toLowerCase()
  if (!tenantEmail) {
    console.warn('[notifyTenantTicketReply] skipped: tenant email missing', {
      tenantId: input.tenantId,
      subject: input.subject,
    })
    return
  }

  try {
    await sendTenantTicketReplyEmail({
      to: tenantEmail,
      tenantName: input.tenantName,
      subject: input.subject,
      senderName: input.senderName,
      senderRoleLabel: input.senderRoleLabel,
      propertyName: input.propertyName,
      unitNumber: input.unitNumber,
      message: input.message,
    })
  } catch (error) {
    console.error('[notifyTenantTicketReply] email failed', {
      tenantId: input.tenantId,
      subject: input.subject,
      error,
    })
  }
}

export async function notifyTenantTicketClosed(input: {
  organizationId: string
  ownerId: string
  tenantId: string
  tenantEmail: string | null
  tenantName: string
  subject: string
  senderName: string
  senderRoleLabel: string
  propertyName: string | null
  unitNumber: string | null
  closingMessage?: string | null
}) {
  const tenantEmail = input.tenantEmail?.trim().toLowerCase()
  if (!tenantEmail) {
    console.warn('[notifyTenantTicketClosed] skipped: tenant email missing', {
      tenantId: input.tenantId,
      subject: input.subject,
    })
    return
  }

  try {
    await sendTenantTicketClosedEmail({
      to: tenantEmail,
      tenantName: input.tenantName,
      subject: input.subject,
      senderName: input.senderName,
      senderRoleLabel: input.senderRoleLabel,
      propertyName: input.propertyName,
      unitNumber: input.unitNumber,
      closingMessage: input.closingMessage ?? null,
    })
  } catch (error) {
    console.error('[notifyTenantTicketClosed] email failed', {
      tenantId: input.tenantId,
      subject: input.subject,
      error,
    })
  }
}

export async function notifyTenantAccountProvisioned(input: {
  organizationId: string
  ownerId: string
  tenantId: string
  tenantName: string
  tenantEmail: string | null
  tenantAccessId: string
  temporaryPassword: string
  propertyName: string | null
  unitNumber: string | null
}) {
  const tenantEmail = input.tenantEmail?.trim().toLowerCase()
  if (!tenantEmail) {
    console.warn('[notifyTenantAccountProvisioned] skipped: tenant email missing', {
      tenantId: input.tenantId,
      tenantAccessId: input.tenantAccessId,
    })
    return
  }

  const owner = await getOwnerById(input.ownerId, input.organizationId)
  if (!owner) {
    throw new AppError('Owner not found for tenant onboarding email', 404)
  }

  const ownerName = normalizeOwnerName(owner)
  const loginUrl = buildFrontendUrl('/login-tenant')
  const resetRequestUrl = buildFrontendUrl('/tenant/forgot-password')

  const results = await Promise.allSettled([
    sendTenantCredentialNotification({
      to: tenantEmail,
      tenantName: input.tenantName,
      tenantAccessId: input.tenantAccessId,
      temporaryPassword: input.temporaryPassword,
      loginUrl,
      propertyName: input.propertyName,
      unitNumber: input.unitNumber,
      ownerName,
      supportEmail: owner.support_email ?? owner.email,
    }),
    sendTenantPasswordChangeRecommendationEmail({
      to: tenantEmail,
      tenantName: input.tenantName,
      tenantAccessId: input.tenantAccessId,
      resetRequestUrl,
    }),
  ])

  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      console.error('[notifyTenantAccountProvisioned] email failed', {
        emailNumber: index + 1,
        tenantId: input.tenantId,
        tenantAccessId: input.tenantAccessId,
        error: result.reason,
      })
    }
  }
}

export async function notifyTenantRentPaymentReviewed(input: {
  organizationId: string
  ownerId: string
  tenantId: string
  tenantEmail: string | null
  tenantName: string
  propertyName: string | null
  unitNumber: string | null
  dueDateIso: string
  amountPaid: number
  currencyCode: string
  status: 'approved' | 'rejected'
  rejectionReason?: string | null
}) {
  const tenantEmail = input.tenantEmail?.trim().toLowerCase()
  if (!tenantEmail) {
    console.warn('[notifyTenantRentPaymentReviewed] skipped: tenant email missing', {
      tenantId: input.tenantId,
      status: input.status,
    })
    return
  }

  const owner = await getOwnerById(input.ownerId, input.organizationId)
  if (!owner) {
    console.error('[notifyTenantRentPaymentReviewed] skipped: owner missing', {
      ownerId: input.ownerId,
      tenantId: input.tenantId,
      status: input.status,
    })
    return
  }

  const ownerName = normalizeOwnerName(owner)
  const dueDateLabel = formatDateLabel(input.dueDateIso)
  const amountPaidLabel = formatCurrencyLabel(input.amountPaid, input.currencyCode)

  try {
    if (input.status === 'approved') {
      await sendTenantRentPaymentApprovedEmail({
        to: tenantEmail,
        tenantName: input.tenantName,
        propertyName: input.propertyName,
        unitNumber: input.unitNumber,
        dueDateLabel,
        amountPaidLabel,
        ownerName,
      })
      return
    }

    await sendTenantRentPaymentRejectedEmail({
      to: tenantEmail,
      tenantName: input.tenantName,
      propertyName: input.propertyName,
      unitNumber: input.unitNumber,
      dueDateLabel,
      amountPaidLabel,
      ownerName,
      rejectionReason:
        input.rejectionReason?.trim() ||
        'The submitted payment could not be approved yet. Please review your details and contact the property team if needed.',
    })
  } catch (error) {
    console.error('[notifyTenantRentPaymentReviewed] email failed', {
      tenantId: input.tenantId,
      status: input.status,
      error,
    })
  }
}
