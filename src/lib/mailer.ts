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
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
      logger: env.NODE_ENV === 'development',
      debug: env.NODE_ENV === 'development',
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

type OwnerTicketReplyNotificationPayload = {
  to: string
  ownerName: string
  tenantName: string
  tenantAccessId: string
  propertyName: string | null
  unitNumber: string | null
  subject: string
  message: string
}

type TenantTicketReplyNotificationPayload = {
  to: string
  tenantName: string
  subject: string
  senderName: string
  senderRoleLabel: string
  propertyName: string | null
  unitNumber: string | null
  message: string
}

type TenantTicketClosedNotificationPayload = {
  to: string
  tenantName: string
  subject: string
  senderName: string
  senderRoleLabel: string
  propertyName: string | null
  unitNumber: string | null
  closingMessage?: string | null
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

export type BrandedEmailOptions = {
  preheader?: string
  eyebrow: string
  title: string
  intro: string[]
  details?: Array<{
    label: string
    value: string
    emphasize?: boolean
    monospace?: boolean
    tone?: 'default' | 'accent' | 'security'
  }>
  body?: string[]
  note?: {
    title: string
    body: string
    tone?: 'info' | 'warning' | 'success'
  }
  cta?: {
    label: string
    url: string
  }
  footer?: string | string[]
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
  const footerLines = Array.isArray(options.footer) ? options.footer : options.footer ? [options.footer] : []
  const preheader = options.preheader ?? `${options.title} from Prophives`
  const text = [
    options.eyebrow.toUpperCase(),
    options.title,
    '',
    preheader,
    '',
    ...options.intro,
    ...(options.details && options.details.length > 0
      ? [
          '',
          ...options.details.map((item) => `${item.label}: ${item.value}`),
        ]
      : []),
    ...(options.body && options.body.length > 0 ? ['', ...options.body] : []),
    ...(options.note ? ['', `${options.note.title}: ${options.note.body}`] : []),
    ...(options.cta ? ['', `${options.cta.label}: ${options.cta.url}`] : []),
    ...(footerLines.length > 0 ? ['', ...footerLines] : []),
  ].join('\n')

  // Note tone palette — light theme
  const noteTone =
    options.note?.tone === 'success'
      ? { border: '#BBF7D0', background: '#F0FDF4', title: '#15803D', text: '#166534' }
      : options.note?.tone === 'warning'
        ? { border: '#FDE68A', background: '#FFFBEB', title: '#B45309', text: '#92400E' }
        : { border: '#BFDBFE', background: '#EFF6FF', title: '#1D4ED8', text: '#1E40AF' }

  const html = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="x-apple-disable-message-reformatting" />
    <style>
      body, table, td, a { -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
      table, td { mso-table-lspace:0pt; mso-table-rspace:0pt; }
      table { border-collapse:collapse; }
      img { border:0; outline:none; text-decoration:none; }
      @media only screen and (max-width:620px) {
        .ph-shell { width:100% !important; }
        .ph-pad { padding:24px 20px !important; }
        .ph-title { font-size:22px !important; }
        .ph-cta td { display:block !important; width:100% !important; }
        .ph-cta a { display:block !important; width:100% !important; box-sizing:border-box !important; text-align:center !important; }
      }
    </style>
    <title>${escapeHtml(options.title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#F3F4F8;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;mso-hide:all;">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F3F4F8;">
      <tr>
        <td align="center" style="padding:32px 16px 40px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="ph-shell" style="max-width:600px;width:100%;">

            <!-- Logo bar -->
            <tr>
              <td align="center" style="padding:0 0 24px 0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="vertical-align:middle;padding-right:9px;">
                      <div style="width:30px;height:30px;background-color:#2251E3;border-radius:7px;text-align:center;line-height:30px;font-size:16px;font-weight:900;color:#ffffff;font-family:'Helvetica Neue',Arial,sans-serif;">P</div>
                    </td>
                    <td style="vertical-align:middle;">
                      <span style="font-family:'Helvetica Neue',Arial,sans-serif;font-size:19px;font-weight:800;letter-spacing:-0.02em;color:#0F1117;">Prophives</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Main card -->
            <tr>
              <td style="background-color:#ffffff;border-radius:16px;border:1px solid #E2E4EC;overflow:hidden;padding:0;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">

                  <!-- Blue accent bar -->
                  <tr>
                    <td style="padding:0;height:4px;background-color:#2251E3;border-radius:16px 16px 0 0;font-size:0;line-height:0;">&nbsp;</td>
                  </tr>

                  <!-- Header -->
                  <tr>
                    <td class="ph-pad" style="padding:28px 36px 20px;border-bottom:1px solid #F1F2F6;">
                      <div style="margin:0 0 14px;">
                        <span style="display:inline-block;background-color:#EEF2FF;border:1px solid #C7D2FE;border-radius:999px;padding:4px 13px;color:#2251E3;font-family:'Helvetica Neue',Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">
                          ${escapeHtml(options.eyebrow)}
                        </span>
                      </div>
                      <h1 class="ph-title" style="margin:0;color:#0F1117;font-family:'Helvetica Neue',Arial,sans-serif;font-size:24px;line-height:1.25;font-weight:800;letter-spacing:-0.02em;">
                        ${escapeHtml(options.title)}
                      </h1>
                    </td>
                  </tr>

                  <!-- Body -->
                  <tr>
                    <td class="ph-pad" style="padding:24px 36px 32px;">

                      ${options.intro
                        .map(
                          (line) => `
                            <p style="margin:0 0 10px;color:#374151;font-family:'Helvetica Neue',Arial,sans-serif;font-size:15px;line-height:1.7;">
                              ${escapeHtml(line)}
                            </p>
                          `,
                        )
                        .join('')}

                      ${
                        options.details && options.details.length > 0
                          ? `
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0 0;border:1px solid #E2E4EC;border-radius:12px;overflow:hidden;background-color:#F8F9FB;">
                              <tr>
                                <td style="padding:4px 20px 8px;">
                                  ${options.details
                                    .map((item, index) => {
                                      const isAccent = item.tone === 'accent'
                                      const isSecurity = item.tone === 'security'
                                      const valueColor = isAccent ? '#2251E3' : isSecurity ? '#0F1117' : '#374151'
                                      const valueBg = isAccent || isSecurity ? '#EEF2FF' : '#ffffff'
                                      const valueBorder = isAccent || isSecurity ? '#C7D2FE' : '#E2E4EC'

                                      return `
                                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                                          <tr>
                                            <td style="padding:${index === 0 ? '16px 0 12px' : '12px 0'};${index < options.details!.length - 1 ? 'border-bottom:1px solid #EAECF1;' : ''}">
                                              <div style="margin:0 0 5px;color:#6B7280;font-family:'Helvetica Neue',Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">
                                                ${escapeHtml(item.label)}
                                              </div>
                                              <div style="border:1px solid ${valueBorder};background-color:${valueBg};border-radius:8px;padding:${item.emphasize ? '11px 14px' : '9px 14px'};color:${valueColor};font-family:${item.monospace ? `'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace` : `'Helvetica Neue',Arial,sans-serif`};font-size:${item.emphasize ? '16px' : '14px'};line-height:1.5;font-weight:${item.emphasize ? '700' : '500'};word-break:break-word;">
                                                ${escapeHtml(item.value)}
                                              </div>
                                            </td>
                                          </tr>
                                        </table>
                                      `
                                    })
                                    .join('')}
                                </td>
                              </tr>
                            </table>
                          `
                          : ''
                      }

                      ${
                        options.body && options.body.length > 0
                          ? options.body
                              .map(
                                (line) => `
                                  <p style="margin:12px 0 0;color:#6B7280;font-family:'Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.7;">
                                    ${escapeHtml(line)}
                                  </p>
                                `,
                              )
                              .join('')
                          : ''
                      }

                      ${
                        options.note
                          ? `
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:18px 0 0;border:1px solid ${noteTone.border};border-radius:10px;background-color:${noteTone.background};">
                              <tr>
                                <td style="padding:13px 16px;">
                                  <div style="margin:0 0 5px;color:${noteTone.title};font-family:'Helvetica Neue',Arial,sans-serif;font-size:10px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">
                                    ${escapeHtml(options.note.title)}
                                  </div>
                                  <div style="margin:0;color:${noteTone.text};font-family:'Helvetica Neue',Arial,sans-serif;font-size:13px;line-height:1.65;">
                                    ${escapeHtml(options.note.body)}
                                  </div>
                                </td>
                              </tr>
                            </table>
                          `
                          : ''
                      }

                      ${
                        options.cta
                          ? `
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" class="ph-cta" style="margin:26px 0 0;">
                              <tr>
                                <td style="border-radius:8px;background-color:#2251E3;">
                                  <a href="${escapeHtml(options.cta.url)}" style="display:inline-block;padding:13px 30px;border-radius:8px;background-color:#2251E3;color:#ffffff;font-family:'Helvetica Neue',Arial,sans-serif;font-size:14px;font-weight:700;letter-spacing:0.02em;text-decoration:none;">
                                    ${escapeHtml(options.cta.label)}
                                  </a>
                                </td>
                              </tr>
                            </table>
                            <p style="margin:10px 0 0;color:#9CA3AF;font-family:'Helvetica Neue',Arial,sans-serif;font-size:11px;line-height:1.6;">
                              Button not working? <a href="${escapeHtml(options.cta.url)}" style="color:#2251E3;text-decoration:underline;">Open link directly</a>
                            </p>
                          `
                          : ''
                      }

                      ${
                        footerLines.length > 0
                          ? `
                            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:22px 0 0;border-top:1px solid #F1F2F6;">
                              <tr>
                                <td style="padding-top:16px;">
                                  ${footerLines
                                    .map(
                                      (line) => `
                                        <p style="margin:0 0 5px;color:#9CA3AF;font-family:'Helvetica Neue',Arial,sans-serif;font-size:12px;line-height:1.65;">
                                          ${escapeHtml(line)}
                                        </p>
                                      `,
                                    )
                                    .join('')}
                                </td>
                              </tr>
                            </table>
                          `
                          : ''
                      }

                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Bottom wordmark -->
            <tr>
              <td align="center" style="padding:20px 0 0;">
                <p style="margin:0;color:#9CA3AF;font-family:'Helvetica Neue',Arial,sans-serif;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">
                  Prophives &mdash; Property Management Platform
                </p>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
  `

  return {
    text,
    html,
  }
}

export async function sendBrandedMessageEmail(
  payload: {
    to: string
    subject: string
  } & BrandedEmailOptions,
) {
  const content = renderBrandedEmail(payload)

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: payload.to,
    subject: payload.subject,
    text: content.text,
    html: content.html,
  })
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

export async function sendOwnerTicketReplyNotification(payload: OwnerTicketReplyNotificationPayload) {
  const propertyLabel = payload.propertyName?.trim() || 'Not provided'
  const unitLabel = payload.unitNumber?.trim() || 'Not provided'

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: payload.to,
    subject: `New Tenant Reply: ${payload.subject}`,
    text: [
      `Hello ${payload.ownerName},`,
      '',
      'A tenant replied to an existing support ticket.',
      `Tenant: ${payload.tenantName} (${payload.tenantAccessId})`,
      `Property: ${propertyLabel}`,
      `Unit: ${unitLabel}`,
      `Subject: ${payload.subject}`,
      `Reply: ${payload.message}`,
      '',
      'Please log in to your owner dashboard to continue the conversation.',
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
  const supportFooter = payload.supportEmail?.trim()
    ? `Need help? Contact ${payload.supportEmail.trim()}.`
    : 'Need help? Contact your property team after you sign in.'
  const content = renderBrandedEmail({
    preheader: `Resident access ${payload.tenantAccessId} is ready. Sign in with your temporary password and update it after your first login.`,
    eyebrow: 'Resident Access',
    title: 'Your resident sign-in credentials',
    intro: [
      `Hello ${payload.tenantName},`,
      'Your Prophives resident workspace is ready.',
      'Use the credentials below to sign in. The password in this email is temporary and should be replaced after your first successful login.',
    ],
    details: [
      { label: 'Tenant Access ID', value: payload.tenantAccessId, emphasize: true, monospace: true, tone: 'accent' },
      { label: 'Temporary Password', value: payload.temporaryPassword, emphasize: true, monospace: true, tone: 'security' },
      { label: 'Property', value: propertyLabel },
      { label: 'Unit', value: unitLabel },
      { label: 'Managed By', value: payload.ownerName },
      { label: 'Support Email', value: supportLabel },
    ],
    body: [
      'Keep these credentials private. Your Tenant Access ID stays the same, but the password should be changed to one only you know.',
      'If the support details above are not correct, please raise it with your property team after you sign in.',
    ],
    note: {
      title: 'Security recommendation',
      body: 'Change your temporary password as soon as you complete your first login.',
      tone: 'warning',
    },
    cta: {
      label: 'Open resident login',
      url: payload.loginUrl,
    },
    footer: [
      supportFooter,
      'If you were not expecting this resident account, contact your property team before using these credentials.',
    ],
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
    preheader: `Replace the temporary password for resident access ${payload.tenantAccessId} with a private password of your own.`,
    eyebrow: 'Security Update',
    title: 'Replace your temporary password',
    intro: [
      `Hello ${payload.tenantName},`,
      `Your Prophives account for resident access ID ${payload.tenantAccessId} was created with a temporary password.`,
      'Use the secure reset flow below to set a private password that only you know.',
    ],
    details: [
      { label: 'Tenant Access ID', value: payload.tenantAccessId, emphasize: true, monospace: true, tone: 'accent' },
    ],
    body: [
      'This is the recommended next step after receiving your resident login credentials.',
      'For security, reset links expire automatically and can only be used once.',
    ],
    note: {
      title: 'Why this matters',
      body: 'Temporary passwords are meant for first access only and should not remain your long-term sign-in password.',
      tone: 'info',
    },
    cta: {
      label: 'Change password',
      url: payload.resetRequestUrl,
    },
    footer: [
      'This button opens the secure Prophives resident password reset request page.',
      'If you did not expect this email, you can ignore it and no changes will be made automatically.',
    ],
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
    preheader: `Reset your Prophives owner password. This secure link expires in ${payload.expiresInLabel}.`,
    eyebrow: 'Owner Password Reset',
    title: 'Reset your owner password',
    intro: [
      `Hello ${payload.ownerName},`,
      'We received a request to reset your Prophives owner password.',
    ],
    details: [{ label: 'Link availability', value: payload.expiresInLabel, emphasize: true, tone: 'accent' }],
    body: [
      'Use the secure button below to choose a new password and return to your owner dashboard.',
      'If you did not request this reset, you can ignore this email and your current password will remain unchanged.',
    ],
    note: {
      title: 'Security note',
      body: 'This reset link is one-time use only and will stop working automatically after the expiry window shown above.',
      tone: 'info',
    },
    cta: {
      label: 'Reset owner password',
      url: payload.resetUrl,
    },
    footer: ['For your security, this email was sent because a password reset request was submitted for your owner account.'],
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
    preheader: `Reset your Prophives resident password for access ID ${payload.tenantAccessId}. This secure link expires in ${payload.expiresInLabel}.`,
    eyebrow: 'Resident Password Reset',
    title: 'Reset your resident password',
    intro: [
      `Hello ${payload.tenantName},`,
      `We received a password reset request for resident access ID ${payload.tenantAccessId}.`,
      'If this was you, use the secure button below to set a new password.',
    ],
    details: [
      { label: 'Tenant Access ID', value: payload.tenantAccessId, emphasize: true, monospace: true, tone: 'accent' },
      { label: 'Link availability', value: payload.expiresInLabel, emphasize: true, tone: 'security' },
    ],
    body: [
      'The link in this email opens the secure Prophives password reset screen.',
      'If you did not request this reset, you can ignore this email and your current password will remain active.',
    ],
    note: {
      title: 'Security note',
      body: 'This reset link is time-limited and one-time use only. Once used or expired, a new request is required.',
      tone: 'info',
    },
    cta: {
      label: 'Reset resident password',
      url: payload.resetUrl,
    },
    footer: ['If you need more help with access, contact your property team or request a new reset link when needed.'],
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

export async function sendTenantTicketReplyEmail(payload: TenantTicketReplyNotificationPayload) {
  const propertyLabel = payload.propertyName?.trim() || 'Not provided'
  const unitLabel = payload.unitNumber?.trim() || 'Not provided'
  const content = renderBrandedEmail({
    eyebrow: 'Support Update',
    title: 'There is a new reply on your support ticket',
    intro: [
      `Hello ${payload.tenantName},`,
      `${payload.senderName} (${payload.senderRoleLabel}) posted a new reply on your Prophives support ticket.`,
    ],
    details: [
      { label: 'Subject', value: payload.subject },
      { label: 'Property', value: propertyLabel },
      { label: 'Unit', value: unitLabel },
      { label: 'Reply From', value: `${payload.senderName} (${payload.senderRoleLabel})` },
    ],
    body: [payload.message],
    footer: 'Log in to your resident workspace to view the full ticket conversation and respond if needed.',
  })

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: payload.to,
    subject: `Ticket Update: ${payload.subject}`,
    text: content.text,
    html: content.html,
  })
}

export async function sendTenantTicketClosedEmail(payload: TenantTicketClosedNotificationPayload) {
  const propertyLabel = payload.propertyName?.trim() || 'Not provided'
  const unitLabel = payload.unitNumber?.trim() || 'Not provided'
  const body = payload.closingMessage?.trim()
    ? [payload.closingMessage.trim()]
    : ['This ticket has been closed. No additional closing note was included.']

  const content = renderBrandedEmail({
    eyebrow: 'Ticket Closed',
    title: 'Your support ticket was closed',
    intro: [
      `Hello ${payload.tenantName},`,
      `${payload.senderName} (${payload.senderRoleLabel}) closed your Prophives support ticket.`,
    ],
    details: [
      { label: 'Subject', value: payload.subject },
      { label: 'Property', value: propertyLabel },
      { label: 'Unit', value: unitLabel },
      { label: 'Closed By', value: `${payload.senderName} (${payload.senderRoleLabel})` },
    ],
    body,
    footer: 'You can log in to your resident workspace to review the full support thread at any time.',
  })

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: payload.to,
    subject: `Ticket Closed: ${payload.subject}`,
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

type TenantRentReminderPayload = {
  to: string
  tenantName: string
  reminderType: '1_day_before' | 'due_today' | '3_days_late' | '7_days_late'
  dueDateLabel: string
  amountLabel: string
}

export async function sendTenantRentReminderEmail(payload: TenantRentReminderPayload) {
  const isOverdue = payload.reminderType === '3_days_late' || payload.reminderType === '7_days_late'

  const titleMap: Record<TenantRentReminderPayload['reminderType'], string> = {
    '1_day_before': 'Your rent is due tomorrow',
    due_today: 'Your rent is due today',
    '3_days_late': 'Your rent is overdue',
    '7_days_late': 'Your rent is overdue',
  }

  const introBodyMap: Record<TenantRentReminderPayload['reminderType'], string> = {
    '1_day_before': 'This is a reminder that your rent payment is due tomorrow.',
    due_today: 'This is a reminder that your rent payment is due today.',
    '3_days_late': 'Your rent payment was due 3 days ago and has not yet been received.',
    '7_days_late': 'Your rent payment is now 7 days overdue. Please settle the outstanding amount as soon as possible.',
  }

  const content = renderBrandedEmail({
    eyebrow: isOverdue ? 'Rent Overdue' : 'Rent Reminder',
    title: titleMap[payload.reminderType],
    intro: [
      `Hello ${payload.tenantName},`,
      introBodyMap[payload.reminderType],
    ],
    details: [
      { label: 'Due Date', value: payload.dueDateLabel },
      { label: 'Amount Due', value: payload.amountLabel, emphasize: true },
    ],
    note: isOverdue
      ? { title: 'Action required', body: 'Please log in to your resident workspace to submit your payment or contact your property manager.', tone: 'warning' }
      : { title: 'How to pay', body: 'Log in to your resident workspace and navigate to the Rent section to submit your payment.', tone: 'info' },
    footer: 'If you have already made a payment, please allow time for it to be confirmed by your property manager.',
  })

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: payload.to,
    subject: titleMap[payload.reminderType],
    text: content.text,
    html: content.html,
  })
}

export async function sendOwnerEmailVerificationEmail(payload: {
  to: string
  ownerName: string
  verifyUrl: string
}) {
  const content = renderBrandedEmail({
    preheader: 'Verify your Prophives owner account email address to activate your workspace.',
    eyebrow: 'Email Verification',
    title: 'Confirm your email address',
    intro: [
      `Hello ${payload.ownerName},`,
      'Thank you for creating a Prophives account. To activate your owner workspace, please verify your email address.',
    ],
    body: [
      'This verification link expires in 24 hours.',
      'If you did not create this account, you can safely ignore this email.',
    ],
    note: {
      title: 'Why verify?',
      body: 'Verification ensures you receive rent alerts, support ticket updates, and important compliance notifications.',
      tone: 'info',
    },
    cta: {
      label: 'Verify email address',
      url: payload.verifyUrl,
    },
    footer: ['This email was sent because an owner account was registered on Prophives with this email address.'],
  })

  await transporter.sendMail({
    from: env.EMAIL_FROM,
    to: payload.to,
    subject: 'Verify your Prophives owner account',
    text: content.text,
    html: content.html,
  })
}
