import { env } from '../config/env.js'
import {
  sendOwnerRentPaymentApprovalNotification,
  sendOwnerTicketReplyNotification,
  sendOwnerTicketNotification,
  sendBrandedMessageEmail,
  sendTenantCredentialNotification,
  sendTenantPasswordChangeRecommendationEmail,
  sendTenantRentPaymentApprovedEmail,
  sendTenantRentPaymentRejectedEmail,
  sendTenantTicketClosedEmail,
  sendTenantTicketReplyEmail,
} from '../lib/mailer.js'
import { AppError } from '../lib/errors.js'
import { getOwnerNotificationPreferences } from './ownerNotificationPreferenceService.js'
import { createOwnerNotification, getOwnerById } from './ownerService.js'
import { getOwnerTelegramChatLink, getTenantTelegramChatLink, sendTelegramMessageWithRetry } from './telegramService.js'

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

function formatDateTimeLabel(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function buildFrontendUrl(path: string): string {
  return new URL(path, `${env.FRONTEND_URL.replace(/\/$/, '')}/`).toString()
}

function truncateText(input: string, max = 500): string {
  const value = input.trim()
  return value.length > max ? `${value.slice(0, max)}...` : value
}

function formatPropertyLabel(propertyName: string | null, unitNumber: string | null): string {
  if (!propertyName) {
    return '-'
  }
  return `${propertyName}${unitNumber ? ` (${unitNumber})` : ''}`
}

function formatTicketTelegramMessage(input: {
  ticketId: string
  tenantName: string
  tenantAccessId: string
  propertyName: string | null
  unitNumber: string | null
  subject: string
  message: string
}) {
  const propertyLabel = formatPropertyLabel(input.propertyName, input.unitNumber)
  const messagePreview = truncateText(input.message, 450)
  const ownerTicketsUrl = buildFrontendUrl('/owner/notifications')

  return [
    '🚨 New Support Ticket',
    `🎫 Ticket: #${input.ticketId.slice(0, 8)} (${input.ticketId})`,
    `👤 Tenant: ${input.tenantName} (${input.tenantAccessId})`,
    `🏠 Property: ${propertyLabel}`,
    `📝 Subject: ${input.subject}`,
    `💬 Preview: ${messagePreview}`,
    '',
    '⚡ Quick actions',
    '• Use buttons below to update status',
    '• Reply from chat:',
    `/reply ${input.ticketId} <your message>`,
    `🔗 Dashboard: ${ownerTicketsUrl}`,
  ].join('\n')
}

export async function notifyOwnerTicketCreated(input: {
  ticketId: string
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
  const preferences = await getOwnerNotificationPreferences(input.ownerId, input.organizationId)

  await createOwnerNotification({
    organization_id: input.organizationId,
    owner_id: input.ownerId,
    tenant_id: input.tenantId,
    notification_type: 'ticket_created',
    title: `New support ticket from ${input.tenantName}`,
    message: `${input.subject}: ${input.message}`,
  })

  if (preferences.ticket_created_email) {
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
  }

  if (preferences.ticket_created_telegram) {
    try {
      const telegramLink = await getOwnerTelegramChatLink({
        organizationId: input.organizationId,
        ownerId: input.ownerId,
      })

      if (telegramLink) {
        await sendTelegramMessageWithRetry({
          chatId: telegramLink.chat_id,
          text: formatTicketTelegramMessage({
            ticketId: input.ticketId,
            tenantName: input.tenantName,
            tenantAccessId: input.tenantAccessId,
            propertyName: input.propertyName,
            unitNumber: input.unitNumber,
            subject: input.subject,
            message: input.message,
          }),
          replyMarkup: {
            inline_keyboard: [
              [
                { text: 'Mark In Progress', callback_data: `ts|${input.ticketId}|in_progress` },
                { text: 'Mark Resolved', callback_data: `ts|${input.ticketId}|resolved` },
              ],
              [{ text: 'Mark Closed', callback_data: `ts|${input.ticketId}|closed` }],
            ],
          },
          logContext: {
            organizationId: input.organizationId,
            ownerId: input.ownerId,
            tenantId: input.tenantId,
            userRole: 'owner',
            eventType: 'ticket_created',
            metadata: {
              ticket_id: input.ticketId,
            },
          },
        })
      }
    } catch (error) {
      console.error('[notifyOwnerTicketCreated] telegram failed', error)
    }
  }
}

export async function notifyOwnerTicketReply(input: {
  ticketId: string
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
  const preferences = await getOwnerNotificationPreferences(input.ownerId, input.organizationId)

  await createOwnerNotification({
    organization_id: input.organizationId,
    owner_id: input.ownerId,
    tenant_id: input.tenantId,
    notification_type: 'ticket_reply',
    title: `New ticket reply from ${input.tenantName}`,
    message: `${input.subject}: ${input.message}`,
  })

  if (preferences.ticket_reply_email) {
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
  }

  if (preferences.ticket_reply_telegram) {
    try {
      const telegramLink = await getOwnerTelegramChatLink({
        organizationId: input.organizationId,
        ownerId: input.ownerId,
      })

      if (telegramLink) {
        await sendTelegramMessageWithRetry({
          chatId: telegramLink.chat_id,
          text: [
            '📩 New Tenant Reply',
            `🎫 Ticket: #${input.ticketId.slice(0, 8)} (${input.ticketId})`,
            `👤 Tenant: ${input.tenantName} (${input.tenantAccessId})`,
            `🏠 Property: ${formatPropertyLabel(input.propertyName, input.unitNumber)}`,
            `📝 Subject: ${input.subject}`,
            `💬 Reply: ${truncateText(input.message, 450)}`,
            '',
            '↩️ Reply from chat:',
            `/reply ${input.ticketId} <your message>`,
            `🔗 Dashboard: ${buildFrontendUrl('/owner/notifications')}`,
          ].join('\n'),
          logContext: {
            organizationId: input.organizationId,
            ownerId: input.ownerId,
            tenantId: input.tenantId,
            userRole: 'owner',
            eventType: 'ticket_reply',
            metadata: {
              ticket_id: input.ticketId,
            },
          },
        })
      }
    } catch (error) {
      console.error('[notifyOwnerTicketReply] telegram failed', error)
    }
  }
}

export async function notifyOwnerRentPaymentAwaitingApproval(input: {
  approvalId: string
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
  const preferences = await getOwnerNotificationPreferences(input.ownerId, input.organizationId)

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

  if (preferences.rent_payment_awaiting_approval_email) {
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

  if (preferences.rent_payment_awaiting_approval_telegram) {
    try {
      const telegramLink = await getOwnerTelegramChatLink({
        organizationId: input.organizationId,
        ownerId: input.ownerId,
      })

      if (telegramLink) {
        await sendTelegramMessageWithRetry({
          chatId: telegramLink.chat_id,
          text: [
            '💸 Rent Payment Approval Required',
            `🆔 Approval ID: ${input.approvalId}`,
            `👤 Tenant: ${input.tenantName} (${input.tenantAccessId})`,
            `🏠 Property: ${formatPropertyLabel(input.propertyName, input.unitNumber)}`,
            `📅 Due date: ${dueDateLabel}`,
            `💰 Amount: ${amountPaidLabel}`,
            '',
            '⚡ Use buttons below to approve or reject.',
            `🔗 Dashboard: ${buildFrontendUrl('/owner/notifications')}`,
          ].join('\n'),
          replyMarkup: {
            inline_keyboard: [
              [
                { text: 'Approve', callback_data: `ra|approve|${input.approvalId}` },
                { text: 'Reject', callback_data: `ra|reject|${input.approvalId}` },
              ],
              [
                { text: 'Approve With Message', callback_data: `rm|approve|${input.approvalId}` },
                { text: 'Reject With Reason', callback_data: `rm|reject|${input.approvalId}` },
              ],
            ],
          },
          logContext: {
            organizationId: input.organizationId,
            ownerId: input.ownerId,
            tenantId: input.tenantId,
            userRole: 'owner',
            eventType: 'rent_payment_awaiting_approval',
          },
        })
      }
    } catch (error) {
      console.error('[notifyOwnerRentPaymentAwaitingApproval] telegram failed', error)
    }
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
  if (tenantEmail) {
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
  } else {
    console.warn('[notifyTenantTicketReply] email skipped: tenant email missing', {
      tenantId: input.tenantId,
      subject: input.subject,
    })
  }

  try {
    const telegramLink = await getTenantTelegramChatLink({
      organizationId: input.organizationId,
      tenantId: input.tenantId,
    })

    if (telegramLink) {
      await sendTelegramMessageWithRetry({
        chatId: telegramLink.chat_id,
        text: [
          '📬 Support Ticket Update',
          `📝 Subject: ${input.subject}`,
          `👤 From: ${input.senderName} (${input.senderRoleLabel})`,
          `💬 Message: ${truncateText(input.message, 450)}`,
          '',
          `🔗 View: ${buildFrontendUrl('/tenant/support')}`,
        ].join('\n'),
        logContext: {
          organizationId: input.organizationId,
          ownerId: input.ownerId,
          tenantId: input.tenantId,
          userRole: 'tenant',
          eventType: 'tenant_ticket_reply',
        },
      })
    }
  } catch (error) {
    console.error('[notifyTenantTicketReply] telegram failed', {
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
  if (tenantEmail) {
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
  } else {
    console.warn('[notifyTenantTicketClosed] email skipped: tenant email missing', {
      tenantId: input.tenantId,
      subject: input.subject,
    })
  }

  try {
    const telegramLink = await getTenantTelegramChatLink({
      organizationId: input.organizationId,
      tenantId: input.tenantId,
    })

    if (telegramLink) {
      await sendTelegramMessageWithRetry({
        chatId: telegramLink.chat_id,
        text: [
          '✅ Support Ticket Closed',
          `📝 Subject: ${input.subject}`,
          `👤 Closed by: ${input.senderName} (${input.senderRoleLabel})`,
          ...(input.closingMessage?.trim() ? [`🗒️ Note: ${input.closingMessage.trim()}`] : []),
          '',
          'If the issue is still unresolved, create a new support ticket.',
          `🔗 View: ${buildFrontendUrl('/tenant/support')}`,
        ].join('\n'),
        logContext: {
          organizationId: input.organizationId,
          ownerId: input.ownerId,
          tenantId: input.tenantId,
          userRole: 'tenant',
          eventType: 'tenant_ticket_closed',
        },
      })
    }
  } catch (error) {
    console.error('[notifyTenantTicketClosed] telegram failed', {
      tenantId: input.tenantId,
      subject: input.subject,
      error,
    })
  }
}

export async function notifyTenantTicketStatusUpdated(input: {
  organizationId: string
  ownerId: string
  tenantId: string
  tenantEmail: string | null
  tenantName: string
  subject: string
  senderName: string
  senderRoleLabel: string
  status: 'open' | 'in_progress' | 'resolved' | 'closed'
}) {
  const statusLabel = input.status.replaceAll('_', ' ')
  await notifyTenantTicketReply({
    organizationId: input.organizationId,
    ownerId: input.ownerId,
    tenantId: input.tenantId,
    tenantEmail: input.tenantEmail,
    tenantName: input.tenantName,
    subject: input.subject,
    senderName: input.senderName,
    senderRoleLabel: input.senderRoleLabel,
    propertyName: null,
    unitNumber: null,
    message: `Ticket status changed to ${statusLabel}.`,
  })
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
  ownerMessage?: string | null
}) {
  const tenantEmail = input.tenantEmail?.trim().toLowerCase()
  const dueDateLabel = formatDateLabel(input.dueDateIso)
  const amountPaidLabel = formatCurrencyLabel(input.amountPaid, input.currencyCode)

  if (tenantEmail) {
    const owner = await getOwnerById(input.ownerId, input.organizationId)
    if (!owner) {
      console.error('[notifyTenantRentPaymentReviewed] skipped email: owner missing', {
        ownerId: input.ownerId,
        tenantId: input.tenantId,
        status: input.status,
      })
    } else {
      const ownerName = normalizeOwnerName(owner)
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
        } else {
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
        }
      } catch (error) {
        console.error('[notifyTenantRentPaymentReviewed] email failed', {
          tenantId: input.tenantId,
          status: input.status,
          error,
        })
      }
    }
  } else {
    console.warn('[notifyTenantRentPaymentReviewed] email skipped: tenant email missing', {
      tenantId: input.tenantId,
      status: input.status,
    })
  }

  try {
    const telegramLink = await getTenantTelegramChatLink({
      organizationId: input.organizationId,
      tenantId: input.tenantId,
    })

    if (telegramLink) {
      await sendTelegramMessageWithRetry({
        chatId: telegramLink.chat_id,
        text:
          input.status === 'approved'
            ? [
                '✅ Rent Payment Approved',
                `💰 Amount: ${amountPaidLabel}`,
                `📅 Due date: ${dueDateLabel}`,
                `🏠 Property: ${formatPropertyLabel(input.propertyName, input.unitNumber)}`,
                ...(input.ownerMessage?.trim() ? [`🗒️ Owner note: ${truncateText(input.ownerMessage, 400)}`] : []),
                `🔗 View: ${buildFrontendUrl('/tenant/dashboard')}`,
              ].join('\n')
            : [
                '⚠️ Rent Payment Rejected',
                `💰 Amount: ${amountPaidLabel}`,
                `📅 Due date: ${dueDateLabel}`,
                `🏠 Property: ${formatPropertyLabel(input.propertyName, input.unitNumber)}`,
                `❗ Reason: ${input.rejectionReason?.trim() || 'Please contact your property team.'}`,
                ...(input.ownerMessage?.trim() ? [`🗒️ Owner note: ${truncateText(input.ownerMessage, 400)}`] : []),
                `🔗 View: ${buildFrontendUrl('/tenant/support')}`,
              ].join('\n'),
        logContext: {
          organizationId: input.organizationId,
          ownerId: input.ownerId,
          tenantId: input.tenantId,
          userRole: 'tenant',
          eventType: input.status === 'approved' ? 'rent_payment_approved' : 'rent_payment_rejected',
        },
      })
    }
  } catch (error) {
    console.error('[notifyTenantRentPaymentReviewed] telegram failed', {
      tenantId: input.tenantId,
      status: input.status,
      error,
    })
  }
}

export async function notifyTenantMaintenanceScheduled(input: {
  tenantId: string
  tenantEmail: string | null
  tenantName: string
  subject: string
  propertyName: string | null
  unitNumber: string | null
  contractorName: string
  appointmentStartAt: string
  appointmentEndAt?: string | null
  appointmentNotes?: string | null
}) {
  const tenantEmail = input.tenantEmail?.trim().toLowerCase()
  if (!tenantEmail) {
    console.warn('[notifyTenantMaintenanceScheduled] skipped: tenant email missing', {
      tenantId: input.tenantId,
      subject: input.subject,
    })
    return
  }

  try {
    await sendBrandedMessageEmail({
      to: tenantEmail,
      subject: `Contractor Visit Scheduled: ${input.subject}`,
      preheader: 'Your Prophives property team has scheduled a contractor visit.',
      eyebrow: 'Maintenance Booking',
      title: `Contractor visit confirmed for ${input.subject}`,
      intro: ['A contractor booking has been arranged for your reported issue.'],
      details: [
        { label: 'Contractor', value: input.contractorName },
        { label: 'Property', value: input.propertyName?.trim() || 'Property' },
        { label: 'Unit', value: input.unitNumber?.trim() || '-' },
        { label: 'Starts', value: formatDateTimeLabel(input.appointmentStartAt), emphasize: true },
        { label: 'Ends', value: input.appointmentEndAt ? formatDateTimeLabel(input.appointmentEndAt) : 'TBC' },
      ],
      body: [
        'Please make sure access is available for the scheduled time window.',
        input.appointmentNotes?.trim() ? `Appointment notes: ${input.appointmentNotes.trim()}` : '',
      ].filter(Boolean),
      note: {
        title: 'Need a change?',
        body: 'If the appointment time no longer works, reply in your support ticket so the property team can reschedule it.',
        tone: 'info',
      },
    })
  } catch (error) {
    console.error('[notifyTenantMaintenanceScheduled] email failed', {
      tenantId: input.tenantId,
      subject: input.subject,
      error,
    })
  }
}

export async function notifyTenantMaintenanceCompleted(input: {
  tenantId: string
  tenantEmail: string | null
  tenantName: string
  subject: string
  propertyName: string | null
  unitNumber: string | null
  contractorName: string
  completionNotes?: string | null
}) {
  const tenantEmail = input.tenantEmail?.trim().toLowerCase()
  if (!tenantEmail) {
    console.warn('[notifyTenantMaintenanceCompleted] skipped: tenant email missing', {
      tenantId: input.tenantId,
      subject: input.subject,
    })
    return
  }

  try {
    await sendBrandedMessageEmail({
      to: tenantEmail,
      subject: `Please Confirm Maintenance Completion: ${input.subject}`,
      preheader: 'Your Prophives property team marked a contractor job as completed.',
      eyebrow: 'Maintenance Confirmation',
      title: `Please confirm the work on ${input.subject}`,
      intro: [`The property team has marked this job as completed by ${input.contractorName}.`],
      details: [
        { label: 'Contractor', value: input.contractorName },
        { label: 'Property', value: input.propertyName?.trim() || 'Property' },
        { label: 'Unit', value: input.unitNumber?.trim() || '-' },
      ],
      body: [
        input.completionNotes?.trim() ? `Completion notes: ${input.completionNotes.trim()}` : '',
        'Open the ticket in your tenant dashboard to confirm whether the issue is fully resolved or still needs follow-up.',
      ].filter(Boolean),
      note: {
        title: 'Why this matters',
        body: 'Your confirmation helps keep the maintenance record accurate and lets the property team know whether more work is needed.',
        tone: 'info',
      },
    })
  } catch (error) {
    console.error('[notifyTenantMaintenanceCompleted] email failed', {
      tenantId: input.tenantId,
      subject: input.subject,
      error,
    })
  }
}

export async function notifyOwnerMaintenanceResolution(input: {
  organizationId: string
  ownerId: string
  tenantId: string
  tenantName: string
  tenantAccessId: string
  propertyName: string | null
  unitNumber: string | null
  subject: string
  resolved: boolean
  feedbackNote?: string | null
}) {
  const owner = await getOwnerById(input.ownerId, input.organizationId)
  if (!owner) {
    throw new AppError('Owner not found for maintenance resolution notification', 404)
  }

  const title = input.resolved
    ? `Tenant confirmed completion: ${input.subject}`
    : `Maintenance follow-up requested: ${input.subject}`
  const message = input.resolved
    ? `${input.tenantName} confirmed the maintenance work is complete.`
    : `${input.tenantName} reported that the issue is still unresolved.`

  await createOwnerNotification({
    organization_id: input.organizationId,
    owner_id: input.ownerId,
    tenant_id: input.tenantId,
    notification_type: input.resolved ? 'maintenance_confirmed' : 'maintenance_follow_up_required',
    title,
    message,
  })

  const toEmail = listUniqueRecipientEmails(owner).join(', ')
  try {
    await sendBrandedMessageEmail({
      to: toEmail,
      subject: title,
      preheader: 'A tenant responded to a maintenance completion request.',
      eyebrow: 'Maintenance Resolution',
      title,
      intro: [message],
      details: [
        { label: 'Tenant', value: `${input.tenantName} (${input.tenantAccessId})` },
        { label: 'Property', value: input.propertyName?.trim() || 'Property' },
        { label: 'Unit', value: input.unitNumber?.trim() || '-' },
      ],
      body: [
        input.feedbackNote?.trim() ? `Tenant note: ${input.feedbackNote.trim()}` : '',
        input.resolved
          ? 'You can close the ticket or leave it in a resolved state from the owner dashboard.'
          : 'Review the ticket, update the contractor booking, and arrange a follow-up visit if required.',
      ].filter(Boolean),
    })
  } catch (error) {
    console.error('[notifyOwnerMaintenanceResolution] email failed', {
      ownerId: input.ownerId,
      tenantId: input.tenantId,
      subject: input.subject,
      error,
    })
  }
}

export async function notifyTenantLeasePreferenceSubmitted(input: {
  organizationId: string
  ownerId: string
  tenantId: string
  tenantName: string
  tenantAccessId: string
  propertyName: string | null
  unitNumber: string | null
  leaseEndDate: string
  decision: 'yes' | 'no'
  brokerEmail?: string | null
  brokerName?: string | null
}) {
  const owner = await getOwnerById(input.ownerId, input.organizationId)
  if (!owner) {
    throw new AppError('Owner not found for lease preference notification', 404)
  }

  const ownerName = normalizeOwnerName(owner)
  const decisionLabel = input.decision === 'yes' ? 'Wants to continue' : 'Will not continue'
  const title = `Lease preference submitted: ${input.tenantName}`
  const message = `${input.tenantName} selected "${decisionLabel}" for lease ending ${formatDateLabel(input.leaseEndDate)}.`

  await createOwnerNotification({
    organization_id: input.organizationId,
    owner_id: input.ownerId,
    tenant_id: input.tenantId,
    notification_type: 'lease_renewal_preference_submitted',
    title,
    message,
  })

  const recipients = [owner.email, owner.support_email ?? null, input.brokerEmail ?? null]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .filter((value, index, list) => list.indexOf(value) === index)

  if (recipients.length === 0) {
    return
  }

  try {
    await sendBrandedMessageEmail({
      to: recipients.join(', '),
      subject: title,
      preheader: 'Tenant lease continuation preference has been submitted.',
      eyebrow: 'Lease Preference',
      title,
      intro: [`${input.tenantName} has submitted a lease continuation preference from the tenant dashboard.`],
      details: [
        { label: 'Tenant', value: `${input.tenantName} (${input.tenantAccessId})` },
        { label: 'Property', value: input.propertyName?.trim() || 'Property' },
        { label: 'Unit', value: input.unitNumber?.trim() || '-' },
        { label: 'Lease End Date', value: formatDateLabel(input.leaseEndDate), emphasize: true },
        { label: 'Preference', value: decisionLabel, emphasize: true },
      ],
      body: [
        input.decision === 'yes'
          ? 'Tenant is interested in continuing after the current lease period. You can now start renewal coordination.'
          : 'Tenant does not want to continue after the current lease period. You can now start replacement planning.',
      ],
      note: {
        title: 'Recipients',
        body: input.brokerEmail
          ? `This alert was sent to owner and assigned broker (${input.brokerName?.trim() || input.brokerEmail}).`
          : `This alert was sent to owner only (${ownerName}).`,
        tone: 'info',
      },
    })
  } catch (error) {
    console.error('[notifyTenantLeasePreferenceSubmitted] email failed', {
      ownerId: input.ownerId,
      tenantId: input.tenantId,
      decision: input.decision,
      error,
    })
  }
}
