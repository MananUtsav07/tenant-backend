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

type TenantCredentialNotificationPayload = {
  to: string
  tenantName: string
  tenantAccessId: string
  temporaryPassword: string
  loginUrl: string
  propertyName: string | null
  unitNumber: string | null
  ownerName: string
  supportEmail: string | null
}

type TenantPasswordChangeRecommendationPayload = {
  to: string
  tenantName: string
  tenantAccessId: string
  resetRequestUrl: string
}

type OwnerPasswordResetPayload = {
  to: string
  ownerName: string
  resetUrl: string
  expiresInLabel: string
}

type TenantPasswordResetPayload = {
  to: string
  tenantName: string
  tenantAccessId: string
  resetUrl: string
  expiresInLabel: string
}

type TenantRentPaymentApprovedPayload = {
  to: string
  tenantName: string
  propertyName: string | null
  unitNumber: string | null
  dueDateLabel: string
  amountPaidLabel: string
  ownerName: string
}

type TenantRentPaymentRejectedPayload = {
  to: string
  tenantName: string
  propertyName: string | null
  unitNumber: string | null
  dueDateLabel: string
  amountPaidLabel: string
  ownerName: string
  rejectionReason: string
}

type BrandedEmailOptions = {
  eyebrow: string
  title: string
  intro: string[]
  details?: Array<{ label: string; value: string }>
  body?: string[]
  cta?: {
    label: string
    url: string
  }
  footer?: string
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderBrandedEmail(options: BrandedEmailOptions) {
  const text = [
    options.eyebrow.toUpperCase(),
    options.title,
    '',
    ...options.intro,
    ...(options.details && options.details.length > 0
      ? [
          '',
          ...options.details.map((item) => `${item.label}: ${item.value}`),
        ]
      : []),
    ...(options.body && options.body.length > 0 ? ['', ...options.body] : []),
    ...(options.cta ? ['', `${options.cta.label}: ${options.cta.url}`] : []),
    ...(options.footer ? ['', options.footer] : []),
  ].join('\n')

  const html = `
    <div style="margin:0;padding:32px 16px;background:#0f1420;color:#eeeff0;font-family:Manrope,Segoe UI,Arial,sans-serif;">
      <div style="margin:0 auto;max-width:640px;border:1px solid rgba(151,105,34,0.28);border-radius:24px;overflow:hidden;background:linear-gradient(180deg,#162036 0%,#0f1524 100%);box-shadow:0 28px 60px rgba(0,0,0,0.35);">
        <div style="padding:32px 32px 12px;background:radial-gradient(circle at top left, rgba(240,163,35,0.16), transparent 32%);">
          <div style="display:inline-block;padding:8px 12px;border-radius:999px;border:1px solid rgba(240,163,35,0.24);background:rgba(240,163,35,0.08);color:#f4d298;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">
            ${escapeHtml(options.eyebrow)}
          </div>
          <h1 style="margin:20px 0 0;font-size:30px;line-height:1.15;color:#eeeff0;font-family:Sora,Manrope,Segoe UI,Arial,sans-serif;">
            ${escapeHtml(options.title)}
          </h1>
        </div>
        <div style="padding:8px 32px 32px;">
          ${options.intro
            .map(
              (line) =>
                `<p style="margin:0 0 14px;color:#d7dae0;font-size:15px;line-height:1.7;">${escapeHtml(line)}</p>`,
            )
            .join('')}
          ${
            options.details && options.details.length > 0
              ? `
            <div style="margin:22px 0;padding:18px;border:1px solid rgba(83,88,100,0.42);border-radius:18px;background:rgba(255,255,255,0.03);">
              ${options.details
                .map(
                  (item) => `
                    <div style="padding:10px 0;border-bottom:1px solid rgba(83,88,100,0.24);">
                      <div style="margin:0 0 4px;color:#97999e;font-size:11px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;">${escapeHtml(item.label)}</div>
                      <div style="margin:0;color:#eeeff0;font-size:15px;line-height:1.5;">${escapeHtml(item.value)}</div>
                    </div>
                  `,
                )
                .join('')}
            </div>
          `
              : ''
          }
          ${
            options.body && options.body.length > 0
              ? options.body
                  .map(
                    (line) =>
                      `<p style="margin:0 0 12px;color:#c4c8cf;font-size:14px;line-height:1.7;">${escapeHtml(line)}</p>`,
                  )
                  .join('')
              : ''
          }
          ${
            options.cta
              ? `
            <div style="margin:28px 0 18px;">
              <a href="${escapeHtml(options.cta.url)}" style="display:inline-block;padding:13px 20px;border-radius:999px;background:linear-gradient(180deg,#f3ae35 0%,#e39b1d 100%);color:#191108;font-weight:700;text-decoration:none;">
                ${escapeHtml(options.cta.label)}
              </a>
            </div>
            <p style="margin:0;color:#97999e;font-size:12px;line-height:1.6;">If the button does not open, copy this link into your browser:<br />${escapeHtml(options.cta.url)}</p>
          `
              : ''
          }
          ${
            options.footer
              ? `<p style="margin:22px 0 0;color:#97999e;font-size:12px;line-height:1.7;">${escapeHtml(options.footer)}</p>`
              : ''
          }
        </div>
      </div>
    </div>
  `

  return {
    text,
    html,
  }
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

export async function sendTenantCredentialNotification(payload: TenantCredentialNotificationPayload) {
  const propertyLabel = payload.propertyName?.trim() || 'Not provided'
  const unitLabel = payload.unitNumber?.trim() || 'Not provided'
  const supportLabel = payload.supportEmail?.trim() || 'Contact your property team after login'
  const content = renderBrandedEmail({
    eyebrow: 'Prophives Resident Access',
    title: 'Your Prophives login credentials',
    intro: [
      `Hello ${payload.tenantName},`,
      `Your property team created your Prophives resident workspace. The password below is your temporary login password.`,
    ],
    details: [
      { label: 'Tenant Access ID', value: payload.tenantAccessId },
      { label: 'Temporary Password', value: payload.temporaryPassword },
      { label: 'Property', value: propertyLabel },
      { label: 'Unit', value: unitLabel },
      { label: 'Managed By', value: payload.ownerName },
      { label: 'Support Email', value: supportLabel },
    ],
    body: [
      'Please sign in with these credentials and keep them private.',
      'We recommend changing your password after your first login.',
    ],
    cta: {
      label: 'Open Resident Login',
      url: payload.loginUrl,
    },
    footer: 'If you were not expecting this account, please contact the property team listed above.',
  })

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: payload.to,
    subject: 'Your Prophives resident login details',
    text: content.text,
    html: content.html,
  })
}

export async function sendTenantPasswordChangeRecommendationEmail(payload: TenantPasswordChangeRecommendationPayload) {
  const content = renderBrandedEmail({
    eyebrow: 'Password Guidance',
    title: 'Change your temporary password when ready',
    intro: [
      `Hello ${payload.tenantName},`,
      `If you would prefer not to keep the temporary password sent for access ID ${payload.tenantAccessId}, you can start the secure password reset flow below.`,
    ],
    body: [
      'Use the forgot-password flow if you want to replace the temporary password after receiving your credentials.',
      'For security, reset links expire and can only be used once.',
    ],
    cta: {
      label: 'Start Password Reset',
      url: payload.resetRequestUrl,
    },
    footer: 'This link opens the Prophives resident password reset request page.',
  })

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: payload.to,
    subject: 'Change your Prophives password',
    text: content.text,
    html: content.html,
  })
}

export async function sendOwnerPasswordResetEmail(payload: OwnerPasswordResetPayload) {
  const content = renderBrandedEmail({
    eyebrow: 'Owner Password Reset',
    title: 'Reset your owner password',
    intro: [
      `Hello ${payload.ownerName},`,
      'We received a request to reset your Prophives owner password.',
    ],
    body: [
      `This secure link stays active for ${payload.expiresInLabel}.`,
      'If you did not request a password reset, you can ignore this email and your current password will remain unchanged.',
    ],
    cta: {
      label: 'Reset Owner Password',
      url: payload.resetUrl,
    },
    footer: 'For your security, the reset link can only be used once.',
  })

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: payload.to,
    subject: 'Reset your Prophives owner password',
    text: content.text,
    html: content.html,
  })
}

export async function sendTenantPasswordResetEmail(payload: TenantPasswordResetPayload) {
  const content = renderBrandedEmail({
    eyebrow: 'Resident Password Reset',
    title: 'Reset your resident password',
    intro: [
      `Hello ${payload.tenantName},`,
      `We received a password reset request for resident access ID ${payload.tenantAccessId}.`,
    ],
    body: [
      `This secure link stays active for ${payload.expiresInLabel}.`,
      'If you did not request this reset, you can ignore this email and your current password will stay active.',
    ],
    cta: {
      label: 'Reset Resident Password',
      url: payload.resetUrl,
    },
    footer: 'For your security, the reset link can only be used once.',
  })

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: payload.to,
    subject: 'Reset your Prophives resident password',
    text: content.text,
    html: content.html,
  })
}

export async function sendTenantRentPaymentApprovedEmail(payload: TenantRentPaymentApprovedPayload) {
  const propertyLabel = payload.propertyName?.trim() || 'Not provided'
  const unitLabel = payload.unitNumber?.trim() || 'Not provided'
  const content = renderBrandedEmail({
    eyebrow: 'Payment Approved',
    title: 'Your rent payment was approved',
    intro: [
      `Hello ${payload.tenantName},`,
      `${payload.ownerName} approved your submitted rent payment in Prophives.`,
    ],
    details: [
      { label: 'Property', value: propertyLabel },
      { label: 'Unit', value: unitLabel },
      { label: 'Due Date', value: payload.dueDateLabel },
      { label: 'Amount', value: payload.amountPaidLabel },
    ],
    body: ['No further action is needed for this submitted payment.'],
    footer: 'You can log in to your resident workspace at any time to review current rent status.',
  })

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: payload.to,
    subject: 'Your Prophives rent payment was approved',
    text: content.text,
    html: content.html,
  })
}

export async function sendTenantRentPaymentRejectedEmail(payload: TenantRentPaymentRejectedPayload) {
  const propertyLabel = payload.propertyName?.trim() || 'Not provided'
  const unitLabel = payload.unitNumber?.trim() || 'Not provided'
  const content = renderBrandedEmail({
    eyebrow: 'Payment Rejected',
    title: 'Your rent payment needs attention',
    intro: [
      `Hello ${payload.tenantName},`,
      `${payload.ownerName} reviewed your submitted rent payment and marked it as rejected.`,
    ],
    details: [
      { label: 'Property', value: propertyLabel },
      { label: 'Unit', value: unitLabel },
      { label: 'Due Date', value: payload.dueDateLabel },
      { label: 'Amount', value: payload.amountPaidLabel },
      { label: 'Owner Note', value: payload.rejectionReason },
    ],
    body: [
      'Please review the note above and resubmit or contact your property team if you need clarification.',
    ],
    footer: 'You can return to your resident workspace to submit the rent payment again when ready.',
  })

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: payload.to,
    subject: 'Your Prophives rent payment was rejected',
    text: content.text,
    html: content.html,
  })
}
