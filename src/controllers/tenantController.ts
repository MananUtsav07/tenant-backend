import type { Request, Response } from 'express'

import { AppError, asyncHandler } from '../lib/errors.js'
import { createAuditLog } from '../services/auditLogService.js'
import { enqueueVacancyCampaignRefreshJob } from '../services/automationEngineService.js'
import {
  addConditionReportMediaReference,
  confirmConditionReportAsTenant,
  getTenantConditionReportDetail,
  getTenantConditionReports,
} from '../services/conditionReportService.js'
import {
  notifyOwnerMaintenanceResolution,
  notifyOwnerTicketCreated,
  notifyOwnerTicketReply,
  notifyTenantLeasePreferenceSubmitted,
} from '../services/notificationService.js'
import { getTenantLeaseRenewalIntentState, submitTenantLeaseRenewalIntent } from '../services/leaseRenewalIntentService.js'
import {
  confirmTenantMaintenanceCompletion,
  getTenantMaintenanceWorkflowOverview,
  maybeInitializeMaintenanceWorkflowForTicket,
} from '../services/maintenanceWorkflowService.js'
import { getTenantRentPaymentState as loadTenantRentPaymentState, submitTenantRentPayment } from '../services/rentPaymentService.js'
import { getTenantTicketThread, replyToTicketAsTenant } from '../services/ticketThreadService.js'
import {
  createTenantTelegramConnectUrl,
  disconnectTenantTelegram,
  getTelegramBotUsername,
  getTenantTelegramConnectionState,
} from '../services/telegramOnboardingService.js'
import { createTenantTicket, getOwnerContactByTenant, getTenantById, getTenantSummary, listTenantTickets } from '../services/tenantService.js'
import { detectVacancyIntentFromTicket } from '../services/vacancyWorkflowService.js'
import { nextDueDateFromDay } from '../utils/date.js'
import { tenantMaintenanceCompletionSchema } from '../validations/maintenanceWorkflowSchemas.js'
import { addConditionReportMediaSchema, confirmConditionReportSchema } from '../validations/conditionReportSchemas.js'
import { tenantMarkRentPaidSchema } from '../validations/rentPaymentSchemas.js'
import { createTenantTicketSchema, tenantLeaseRenewalIntentSchema } from '../validations/tenantSchemas.js'
import { createTicketReplySchema } from '../validations/ticketSchemas.js'

function requireTenantIdentity(request: Request) {
  const tenantId = request.tenant?.tenantId
  const ownerId = request.tenant?.ownerId
  const organizationId = request.tenant?.organizationId
  if (!tenantId || !ownerId || !organizationId) {
    throw new AppError('Tenant authentication required', 401)
  }

  return { tenantId, ownerId, organizationId }
}

function readPathId(request: Request, paramName: string): string {
  const value = request.params[paramName]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(`Invalid route parameter: ${paramName}`, 400)
  }

  return value
}

export const getTenantDashboardSummary = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, organizationId } = requireTenantIdentity(request)

  const tenant = await getTenantById(tenantId, organizationId)
  if (!tenant) {
    throw new AppError('Tenant not found', 404)
  }

  const stats = await getTenantSummary(tenantId, organizationId)

  response.json({
    ok: true,
    summary: {
      ...stats,
      payment_status: tenant.payment_status,
      monthly_rent: tenant.monthly_rent,
      payment_due_day: tenant.payment_due_day,
      lease_start_date: tenant.lease_start_date,
      lease_end_date: tenant.lease_end_date,
      next_due_date: nextDueDateFromDay(tenant.payment_due_day).toISOString(),
    },
  })
})

export const getTenantLeaseRenewalIntentStateController = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, organizationId } = requireTenantIdentity(request)
  const state = await getTenantLeaseRenewalIntentState({
    tenantId,
    organizationId,
  })

  response.json({
    ok: true,
    state,
  })
})

export const getTenantProperty = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, organizationId } = requireTenantIdentity(request)

  const tenant = await getTenantById(tenantId, organizationId)
  if (!tenant) {
    throw new AppError('Tenant not found', 404)
  }

  response.json({
    ok: true,
    property: tenant.properties,
    tenant: {
      id: tenant.id,
      full_name: tenant.full_name,
      monthly_rent: tenant.monthly_rent,
      payment_due_day: tenant.payment_due_day,
      payment_status: tenant.payment_status,
      lease_start_date: tenant.lease_start_date,
      lease_end_date: tenant.lease_end_date,
    },
  })
})

export const getTenantConditionReportsController = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, organizationId } = requireTenantIdentity(request)
  const condition_reports = await getTenantConditionReports({
    organizationId,
    tenantId,
  })

  response.json({ ok: true, condition_reports })
})

export const getTenantConditionReportDetailController = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, organizationId } = requireTenantIdentity(request)
  const reportId = readPathId(request, 'reportId')

  const report = await getTenantConditionReportDetail({
    organizationId,
    tenantId,
    reportId,
  })

  if (!report) {
    throw new AppError('Condition report not found', 404)
  }

  response.json({ ok: true, report })
})

export const postTenantConditionReportMediaController = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, organizationId } = requireTenantIdentity(request)
  const reportId = readPathId(request, 'reportId')
  const parsed = addConditionReportMediaSchema.parse(request.body)

  const report = await addConditionReportMediaReference({
    organizationId,
    reportId,
    roomEntryId: parsed.room_entry_id,
    actorRole: 'tenant',
    actorTenantId: tenantId,
    payload: parsed,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: tenantId,
    actor_role: 'tenant',
    action: 'condition_report.media_added',
    entity_type: 'condition_report_media',
    entity_id: reportId,
    metadata: {
      room_entry_id: parsed.room_entry_id,
      media_kind: parsed.media_kind,
    },
  })

  response.status(201).json({ ok: true, report })
})

export const postTenantConditionReportConfirmController = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, organizationId } = requireTenantIdentity(request)
  const reportId = readPathId(request, 'reportId')
  const parsed = confirmConditionReportSchema.parse(request.body)

  const report = await confirmConditionReportAsTenant({
    organizationId,
    tenantId,
    reportId,
    status: parsed.status,
    note: parsed.note ?? null,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: tenantId,
    actor_role: 'tenant',
    action: 'condition_report.confirmed',
    entity_type: 'condition_report',
    entity_id: reportId,
    metadata: {
      confirmation_status: parsed.status,
    },
  })

  response.json({ ok: true, report })
})

export const getTenantTickets = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, organizationId } = requireTenantIdentity(request)
  const tickets = await listTenantTickets(tenantId, organizationId)
  response.json({ ok: true, tickets })
})

export const getTenantTicketById = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, organizationId } = requireTenantIdentity(request)
  const ticketId = readPathId(request, 'id')

  const thread = await getTenantTicketThread({
    ticketId,
    tenantId,
    organizationId,
  })

  if (!thread) {
    throw new AppError('Ticket not found', 404)
  }

  response.json({ ok: true, thread })
})

export const getTenantRentPaymentState = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, organizationId } = requireTenantIdentity(request)
  const state = await loadTenantRentPaymentState({
    tenantId,
    organizationId,
  })

  response.json({
    ok: true,
    state,
  })
})

export const postTenantRentPaymentMarkPaid = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, ownerId, organizationId } = requireTenantIdentity(request)
  tenantMarkRentPaidSchema.parse(request.body ?? {})

  const result = await submitTenantRentPayment({
    tenantId,
    organizationId,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: tenantId,
    actor_role: 'tenant',
    action: 'rent_payment.marked_paid',
    entity_type: 'rent_payment_approval',
    entity_id: result.approval.id,
    metadata: {
      owner_id: ownerId,
      cycle_year: result.approval.cycle_year,
      cycle_month: result.approval.cycle_month,
      due_date: result.approval.due_date,
      amount_paid: result.approval.amount_paid,
      status: result.approval.status,
    },
  })

  response.status(201).json({
    ok: true,
    approval: result.approval,
    state: result.state,
  })
})

export const postTenantTicket = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, ownerId, organizationId } = requireTenantIdentity(request)
  const parsed = createTenantTicketSchema.parse(request.body)

  const tenant = await getTenantById(tenantId, organizationId)
  if (!tenant) {
    throw new AppError('Tenant not found', 404)
  }

  const ticket = await createTenantTicket({
    organization_id: organizationId,
    tenant_id: tenantId,
    owner_id: ownerId,
    subject: parsed.subject,
    message: parsed.message,
  })

  await notifyOwnerTicketCreated({
    ticketId: ticket.id,
    organizationId,
    ownerId,
    tenantId,
    tenantName: tenant.full_name,
    tenantAccessId: tenant.tenant_access_id,
    propertyName: tenant.properties?.property_name ?? null,
    unitNumber: tenant.properties?.unit_number ?? null,
    subject: parsed.subject,
    message: parsed.message,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: tenantId,
    actor_role: 'tenant',
    action: 'ticket.created',
    entity_type: 'support_ticket',
    entity_id: ticket.id,
    metadata: {
      subject: parsed.subject,
      owner_id: ownerId,
    },
  })

  await maybeInitializeMaintenanceWorkflowForTicket({
    ticketId: ticket.id,
    organizationId,
  })

  const vacancySignal = detectVacancyIntentFromTicket({
    subject: parsed.subject,
    message: parsed.message,
    tenantLeaseEndDate: tenant.lease_end_date,
  })

  if (vacancySignal.isVacancyNotice && tenant.property_id) {
    void enqueueVacancyCampaignRefreshJob({
      organizationId,
      ownerId,
      propertyId: tenant.property_id,
      tenantId,
      sourceType: 'tenant_notice',
      expectedVacancyDate: vacancySignal.suggestedExpectedVacancyDate ?? tenant.lease_end_date ?? new Date().toISOString().slice(0, 10),
      triggerReference: `ticket:${ticket.id}`,
      triggerNotes: `${vacancySignal.reason} Ticket subject: ${parsed.subject}`,
      vacancyState: tenant.lease_end_date && tenant.lease_end_date <= new Date().toISOString().slice(0, 10) ? 'vacant' : 'pre_vacant',
    }).catch((error) => {
      console.error('[postTenantTicket] vacancy campaign enqueue failed', {
        ticketId: ticket.id,
        tenantId,
        error,
      })
    })
  }

  response.status(201).json({ ok: true, ticket })
})

export const postTenantLeaseRenewalIntentController = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, organizationId, ownerId } = requireTenantIdentity(request)
  const parsed = tenantLeaseRenewalIntentSchema.parse(request.body ?? {})

  const result = await submitTenantLeaseRenewalIntent({
    tenantId,
    organizationId,
    decision: parsed.decision,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: tenantId,
    actor_role: 'tenant',
    action: 'tenant.lease_renewal_preference_submitted',
    entity_type: 'lease_renewal_intent',
    entity_id: result.intent.id,
    metadata: {
      decision: parsed.decision,
      lease_end_date: result.intent.lease_end_date,
      days_remaining: result.days_remaining,
    },
  })

  await notifyTenantLeasePreferenceSubmitted({
    organizationId,
    ownerId,
    tenantId,
    tenantName: result.context.full_name,
    tenantAccessId: result.context.tenant_access_id,
    propertyName: result.context.properties?.property_name ?? null,
    unitNumber: result.context.properties?.unit_number ?? null,
    leaseEndDate: result.intent.lease_end_date,
    decision: parsed.decision,
    brokerEmail: result.context.brokers?.email ?? null,
    brokerName: result.context.brokers?.full_name ?? null,
  })

  response.status(201).json({
    ok: true,
    intent: {
      id: result.intent.id,
      decision: result.intent.response,
      lease_end_date: result.intent.lease_end_date,
      responded_at: result.intent.responded_at,
    },
  })
})

export const postTenantTicketReply = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, ownerId, organizationId } = requireTenantIdentity(request)
  const ticketId = readPathId(request, 'id')

  const parsed = createTicketReplySchema.parse(request.body)

  const tenant = await getTenantById(tenantId, organizationId)
  if (!tenant) {
    throw new AppError('Tenant not found', 404)
  }

  const result = await replyToTicketAsTenant({
    ticketId,
    tenantId,
    organizationId,
    message: parsed.message,
  })

  await notifyOwnerTicketReply({
    ticketId,
    organizationId,
    ownerId,
    tenantId,
    tenantName: tenant.full_name,
    tenantAccessId: tenant.tenant_access_id,
    propertyName: tenant.properties?.property_name ?? null,
    unitNumber: tenant.properties?.unit_number ?? null,
    subject: result.ticket.subject,
    message: parsed.message,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: tenantId,
    actor_role: 'tenant',
    action: 'ticket.reply_posted',
    entity_type: 'support_ticket_message',
    entity_id: result.message.id,
    metadata: {
      ticket_id: result.ticket.id,
      message_type: result.message.message_type,
    },
  })

  response.status(201).json({ ok: true, message: result.message })
})

export const getTenantTicketMaintenanceWorkflow = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, organizationId } = requireTenantIdentity(request)
  const ticketId = readPathId(request, 'id')

  const workflow = await getTenantMaintenanceWorkflowOverview({
    ticketId,
    tenantId,
    organizationId,
  })

  if (!workflow) {
    throw new AppError('Ticket not found', 404)
  }

  response.json({
    ok: true,
    maintenance: workflow,
  })
})

export const postTenantMaintenanceCompletion = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, ownerId, organizationId } = requireTenantIdentity(request)
  const ticketId = readPathId(request, 'id')
  const parsed = tenantMaintenanceCompletionSchema.parse(request.body ?? {})

  const tenant = await getTenantById(tenantId, organizationId)
  if (!tenant) {
    throw new AppError('Tenant not found', 404)
  }

  const workflow = await confirmTenantMaintenanceCompletion({
    ticketId,
    tenantId,
    organizationId,
    resolved: parsed.resolved,
    feedbackRating: parsed.feedback_rating,
    feedbackNote: parsed.feedback_note,
  })

  if (!workflow?.workflow) {
    throw new AppError('Maintenance workflow not found', 404)
  }

  await notifyOwnerMaintenanceResolution({
    organizationId,
    ownerId,
    tenantId,
    tenantName: tenant.full_name,
    tenantAccessId: tenant.tenant_access_id,
    propertyName: tenant.properties?.property_name ?? null,
    unitNumber: tenant.properties?.unit_number ?? null,
    subject: workflow.ticket.subject,
    resolved: parsed.resolved,
    feedbackNote: parsed.feedback_note ?? null,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: tenantId,
    actor_role: 'tenant',
    action: parsed.resolved ? 'maintenance.confirmed' : 'maintenance.follow_up_requested',
    entity_type: 'maintenance_assignment',
    entity_id: workflow.workflow.assignment?.id ?? workflow.workflow.id,
    metadata: {
      ticket_id: workflow.ticket.id,
      resolved: parsed.resolved,
      feedback_rating: parsed.feedback_rating ?? null,
      feedback_note_present: Boolean(parsed.feedback_note),
    },
  })

  response.status(201).json({
    ok: true,
    maintenance: workflow,
  })
})

export const getTenantOwnerContact = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, organizationId } = requireTenantIdentity(request)
  const ownerContact = await getOwnerContactByTenant(tenantId, organizationId)
  response.json({ ok: true, owner: ownerContact })
})

export const getTenantTelegramOnboarding = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, organizationId } = requireTenantIdentity(request)
  const state = await getTenantTelegramConnectionState({
    tenantId,
    organizationId,
  })
  const botUsername = getTelegramBotUsername()
  const connectUrl = botUsername
    ? await createTenantTelegramConnectUrl({
        tenantId,
        organizationId,
      })
    : null

  response.json({
    ok: true,
    onboarding: {
      connected: state.connected,
      bot_username: botUsername,
      connect_url: connectUrl,
      linked_chat: state.linked_chat,
    },
  })
})

export const postTenantTelegramDisconnect = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, organizationId } = requireTenantIdentity(request)
  const disconnected = await disconnectTenantTelegram({
    tenantId,
    organizationId,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: tenantId,
    actor_role: 'tenant',
    action: 'telegram.disconnected',
    entity_type: 'telegram_chat_link',
    metadata: { disconnected },
  })

  response.json({
    ok: true,
    disconnected,
  })
})
