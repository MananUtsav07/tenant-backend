import type { Request, Response } from 'express'

import { AppError, asyncHandler } from '../lib/errors.js'
import { createAuditLog } from '../services/auditLogService.js'
import { notifyOwnerTicketCreated } from '../services/notificationService.js'
import { getTenantRentPaymentState as loadTenantRentPaymentState, submitTenantRentPayment } from '../services/rentPaymentService.js'
import {
  createTenantTelegramConnectUrl,
  disconnectTenantTelegram,
  getTelegramBotUsername,
  getTenantTelegramConnectionState,
} from '../services/telegramOnboardingService.js'
import { createTenantTicket, getOwnerContactByTenant, getTenantById, getTenantSummary, listTenantTickets } from '../services/tenantService.js'
import { nextDueDateFromDay } from '../utils/date.js'
import { tenantMarkRentPaidSchema } from '../validations/rentPaymentSchemas.js'
import { createTenantTicketSchema } from '../validations/tenantSchemas.js'

function requireTenantIdentity(request: Request) {
  const tenantId = request.tenant?.tenantId
  const ownerId = request.tenant?.ownerId
  const organizationId = request.tenant?.organizationId
  if (!tenantId || !ownerId || !organizationId) {
    throw new AppError('Tenant authentication required', 401)
  }

  return { tenantId, ownerId, organizationId }
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

export const getTenantTickets = asyncHandler(async (request: Request, response: Response) => {
  const { tenantId, organizationId } = requireTenantIdentity(request)
  const tickets = await listTenantTickets(tenantId, organizationId)
  response.json({ ok: true, tickets })
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

  response.status(201).json({ ok: true, ticket })
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
