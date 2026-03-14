import nodemailer from 'nodemailer'

import { env } from '../config/env.js'

const transporter = env.SMTP_HOST
  ? nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: {
        user: env.EMAIL_USER,
        pass: env.EMAIL_PASS,
      },
    })
  : nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: env.EMAIL_USER,
        pass: env.EMAIL_PASS,
      },
    })

type TicketNotificationPayload = {
  to: string
  ownerName: string
  tenantName: string
  tenantAccessId: string
  propertyName: string | null
  unitNumber: string | null
  subject: string
  message: string
}

type RentPaymentApprovalNotificationPayload = {
  to: string
  ownerName: string
  tenantName: string
  tenantAccessId: string
  propertyName: string | null
  unitNumber: string | null
  dueDateLabel: string
  amountPaidLabel: string
}

type PublicContactNotificationPayload = {
  to: string
  name: string
  email: string
  message: string
  createdAt: string
}

type OwnerComplianceAlertNotificationPayload = {
  to: string
  ownerName: string
  propertyName: string | null
  unitNumber: string | null
  tenantName: string | null
  tenantAccessId: string | null
  daysRemaining: number
  threshold: number
  ejariExpiryLabel: string
  contractEndLabel: string
}

type OwnerPortfolioSummaryNotificationPayload = {
  to: string
  ownerName: string
  summary: {
    active_tenants: number
    open_tickets: number
    overdue_rent: number
    reminders_pending: number
    unread_notifications: number
    awaiting_approvals: number
  }
  generatedAtLabel: string
}

export async function sendOwnerTicketNotification(payload: TicketNotificationPayload) {
  const propertyLabel = payload.propertyName?.trim() || 'Not provided'
  const unitLabel = payload.unitNumber?.trim() || 'Not provided'

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: payload.to,
    subject: `Tenant Ticket: ${payload.subject}`,
    text: [
      `Hello ${payload.ownerName},`,
      '',
      'A tenant raised a support ticket.',
      `Tenant: ${payload.tenantName} (${payload.tenantAccessId})`,
      `Property: ${propertyLabel}`,
      `Unit: ${unitLabel}`,
      `Subject: ${payload.subject}`,
      `Message: ${payload.message}`,
      '',
      'Please log in to your owner dashboard to respond.',
    ].join('\n'),
  })
}

export async function sendOwnerRentPaymentApprovalNotification(payload: RentPaymentApprovalNotificationPayload) {
  const propertyLabel = payload.propertyName?.trim() || 'Not provided'
  const unitLabel = payload.unitNumber?.trim() || 'Not provided'

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: payload.to,
    subject: `Rent Payment Awaiting Approval: ${payload.tenantName}`,
    text: [
      `Hello ${payload.ownerName},`,
      '',
      'A tenant marked their monthly rent as paid and is waiting for your approval.',
      `Tenant: ${payload.tenantName} (${payload.tenantAccessId})`,
      `Property: ${propertyLabel}`,
      `Unit: ${unitLabel}`,
      `Due Date: ${payload.dueDateLabel}`,
      `Amount Paid: ${payload.amountPaidLabel}`,
      '',
      'Please log in to your owner dashboard and review this payment request.',
    ].join('\n'),
  })
}

export async function sendPublicContactNotification(payload: PublicContactNotificationPayload) {
  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: payload.to,
    subject: `New public contact message from ${payload.name}`,
    text: [
      'A new contact request was submitted from the website.',
      '',
      `Name: ${payload.name}`,
      `Email: ${payload.email}`,
      `Submitted At: ${payload.createdAt}`,
      '',
      'Message:',
      payload.message,
    ].join('\n'),
  })
}

export async function sendOwnerComplianceAlertNotification(payload: OwnerComplianceAlertNotificationPayload) {
  const propertyLabel = payload.propertyName?.trim() || 'Not provided'
  const unitLabel = payload.unitNumber?.trim() || 'Not provided'
  const tenantLabel = payload.tenantName?.trim() || 'Not provided'
  const tenantAccessLabel = payload.tenantAccessId?.trim() || 'Not provided'

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: payload.to,
    subject: `Compliance Alert: Action required in ${payload.daysRemaining} days`,
    text: [
      `Hello ${payload.ownerName},`,
      '',
      `A legal/compliance milestone is within ${payload.threshold} days.`,
      `Days Remaining: ${payload.daysRemaining}`,
      `Property: ${propertyLabel}`,
      `Unit: ${unitLabel}`,
      `Tenant: ${tenantLabel} (${tenantAccessLabel})`,
      `Ejari Expiry: ${payload.ejariExpiryLabel}`,
      `Contract End: ${payload.contractEndLabel}`,
      '',
      'Please review renewal or legal notice actions in your owner dashboard.',
    ].join('\n'),
  })
}

export async function sendOwnerPortfolioSummaryNotification(payload: OwnerPortfolioSummaryNotificationPayload) {
  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: payload.to,
    subject: 'Daily Portfolio Brief',
    text: [
      `Hello ${payload.ownerName},`,
      '',
      'Here is your latest operations snapshot:',
      `Active Tenants: ${payload.summary.active_tenants}`,
      `Open Tickets: ${payload.summary.open_tickets}`,
      `Overdue Rent: ${payload.summary.overdue_rent}`,
      `Reminders Pending: ${payload.summary.reminders_pending}`,
      `Unread Notifications: ${payload.summary.unread_notifications}`,
      `Awaiting Approvals: ${payload.summary.awaiting_approvals}`,
      '',
      `Generated At: ${payload.generatedAtLabel}`,
      '',
      'Log in to your owner dashboard for details.',
    ].join('\n'),
  })
}
