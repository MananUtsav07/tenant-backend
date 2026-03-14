import bcrypt from 'bcryptjs'
import type { Request, Response } from 'express'

import { AppError, asyncHandler } from '../lib/errors.js'
import { requireOrganizationContext } from '../middleware/organizationContext.js'
import { createAuditLog } from '../services/auditLogService.js'
import { getOwnerAutomationSettings, listOwnerAutomationActivity, updateOwnerAutomationSettings } from '../services/ownerAutomationService.js'
import {
  createProperty,
  createTenant,
  deleteProperty,
  deleteTenant,
  getOwnerDashboardSummary,
  getPropertyForOwner,
  getTenantDetailAggregate,
  listOwnerNotifications,
  listOwnerTickets,
  listProperties,
  listTenants,
  markNotificationRead,
  updateOwnerTicket,
  updateProperty,
  updateTenant,
} from '../services/ownerService.js'
import { processOwnerReminders } from '../services/reminderService.js'
import { listOwnerAwaitingRentPaymentApprovals, reviewOwnerRentPaymentApproval } from '../services/rentPaymentService.js'
import { createTenantSchema, createPropertySchema, updatePropertySchema, updateTenantSchema, updateTicketStatusSchema } from '../validations/ownerSchemas.js'
import { ownerReviewRentPaymentSchema } from '../validations/rentPaymentSchemas.js'
import { ownerAutomationActivityQuerySchema, ownerAutomationSettingsUpdateSchema } from '../validations/automationSchemas.js'

function requireOwnerContext(request: Request): { ownerId: string; organizationId: string } {
  const ownerId = request.owner?.ownerId
  const organizationId = request.owner?.organizationId ?? request.auth?.organizationId ?? null
  if (!ownerId) {
    throw new AppError('Owner authentication required', 401)
  }
  if (!organizationId) {
    throw new AppError('Organization context is required', 401)
  }

  return { ownerId, organizationId }
}

function readPathId(request: Request, paramName: string): string {
  const value = request.params[paramName]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(`Invalid route parameter: ${paramName}`, 400)
  }
  return value
}

export const createOwnerProperty = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const parsed = createPropertySchema.parse(request.body)
  const property = await createProperty({
    ownerId,
    organizationId,
    input: parsed,
  })
  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'property.created',
    entity_type: 'property',
    entity_id: property.id,
    metadata: { property_name: property.property_name },
  })
  response.status(201).json({ ok: true, property })
})

export const getOwnerProperties = asyncHandler(async (request: Request, response: Response) => {
  const organizationId = requireOrganizationContext(request)
  const properties = await listProperties(organizationId)
  response.json({ ok: true, properties })
})

export const patchOwnerProperty = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const propertyId = readPathId(request, 'id')
  const parsed = updatePropertySchema.parse(request.body)

  if (Object.keys(parsed).length === 0) {
    throw new AppError('No property fields provided', 400)
  }

  const property = await updateProperty(organizationId, propertyId, parsed)
  if (!property) {
    throw new AppError('Property not found in your organization', 404)
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'property.updated',
    entity_type: 'property',
    entity_id: property.id,
    metadata: parsed,
  })

  response.json({ ok: true, property })
})

export const removeOwnerProperty = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const propertyId = readPathId(request, 'id')
  const deletedCount = await deleteProperty(organizationId, propertyId)

  if (!deletedCount) {
    throw new AppError('Property not found in your organization', 404)
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'property.deleted',
    entity_type: 'property',
    entity_id: propertyId,
  })

  response.json({ ok: true })
})

export const createOwnerTenant = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const parsed = createTenantSchema.parse(request.body)

  const property = await getPropertyForOwner(organizationId, parsed.property_id)
  if (!property) {
    throw new AppError('Property not found in your organization', 404)
  }

  const passwordHash = await bcrypt.hash(parsed.password, 10)

  const tenant = await createTenant({
    ownerId,
    organizationId,
    input: {
      property_id: parsed.property_id,
      full_name: parsed.full_name,
      email: parsed.email,
      phone: parsed.phone,
      password_hash: passwordHash,
      lease_start_date: parsed.lease_start_date,
      lease_end_date: parsed.lease_end_date,
      monthly_rent: parsed.monthly_rent,
      payment_due_day: parsed.payment_due_day,
      payment_status: parsed.payment_status,
      status: parsed.status,
    },
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'tenant.created',
    entity_type: 'tenant',
    entity_id: tenant.id,
    metadata: { full_name: tenant.full_name, property_id: tenant.property_id },
  })

  response.status(201).json({ ok: true, tenant })
})

export const getOwnerTenants = asyncHandler(async (request: Request, response: Response) => {
  const organizationId = requireOrganizationContext(request)
  const tenants = await listTenants(organizationId)
  response.json({ ok: true, tenants })
})

export const getOwnerTenantById = asyncHandler(async (request: Request, response: Response) => {
  const organizationId = requireOrganizationContext(request)
  const tenantId = readPathId(request, 'id')

  const detail = await getTenantDetailAggregate(organizationId, tenantId)
  if (!detail) {
    throw new AppError('Tenant not found in your organization', 404)
  }

  response.json({ ok: true, ...detail })
})

export const patchOwnerTenant = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const tenantId = readPathId(request, 'id')
  const parsed = updateTenantSchema.parse(request.body)

  if (Object.keys(parsed).length === 0) {
    throw new AppError('No tenant fields provided', 400)
  }

  const patch: Record<string, unknown> = { ...parsed }

  if (typeof parsed.password === 'string') {
    patch.password_hash = await bcrypt.hash(parsed.password, 10)
    delete patch.password
  }

  const tenant = await updateTenant(organizationId, tenantId, patch)
  if (!tenant) {
    throw new AppError('Tenant not found in your organization', 404)
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'tenant.updated',
    entity_type: 'tenant',
    entity_id: tenant.id,
    metadata: parsed,
  })

  response.json({ ok: true, tenant })
})

export const removeOwnerTenant = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const tenantId = readPathId(request, 'id')

  const deletedCount = await deleteTenant(organizationId, tenantId)
  if (!deletedCount) {
    throw new AppError('Tenant not found in your organization', 404)
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'tenant.deleted',
    entity_type: 'tenant',
    entity_id: tenantId,
  })

  response.json({ ok: true })
})

export const getOwnerTicketList = asyncHandler(async (request: Request, response: Response) => {
  const organizationId = requireOrganizationContext(request)
  const tickets = await listOwnerTickets(organizationId)
  response.json({ ok: true, tickets })
})

export const patchOwnerTicket = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const ticketId = readPathId(request, 'id')
  const parsed = updateTicketStatusSchema.parse(request.body)

  const ticket = await updateOwnerTicket(organizationId, ticketId, parsed.status)
  if (!ticket) {
    throw new AppError('Ticket not found in your organization', 404)
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'ticket.status_updated',
    entity_type: 'support_ticket',
    entity_id: ticket.id,
    metadata: { status: parsed.status },
  })

  response.json({ ok: true, ticket })
})

export const getOwnerNotificationList = asyncHandler(async (request: Request, response: Response) => {
  const organizationId = requireOrganizationContext(request)
  const notifications = await listOwnerNotifications(organizationId)
  response.json({ ok: true, notifications })
})

export const markOwnerNotificationRead = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const notificationId = readPathId(request, 'id')

  const notification = await markNotificationRead(organizationId, notificationId)
  if (!notification) {
    throw new AppError('Notification not found in your organization', 404)
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'notification.mark_read',
    entity_type: 'owner_notification',
    entity_id: notification.id,
  })

  response.json({ ok: true, notification })
})

export const getOwnerSummary = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const summary = await getOwnerDashboardSummary(organizationId, ownerId)
  response.json({ ok: true, summary })
})

export const getOwnerRentPaymentApprovals = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const approvals = await listOwnerAwaitingRentPaymentApprovals({
    ownerId,
    organizationId,
  })

  response.json({
    ok: true,
    approvals,
  })
})

export const patchOwnerRentPaymentApproval = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const approvalId = readPathId(request, 'id')
  const parsed = ownerReviewRentPaymentSchema.parse(request.body)

  const approval = await reviewOwnerRentPaymentApproval({
    approvalId,
    ownerId,
    organizationId,
    action: parsed.action,
    rejectionReason: parsed.rejection_reason,
  })
  if (!approval) {
    throw new AppError('Failed to review rent payment approval', 500)
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: parsed.action === 'approve' ? 'rent_payment.approved' : 'rent_payment.rejected',
    entity_type: 'rent_payment_approval',
    entity_id: approval.id,
    metadata: {
      status: approval.status,
      tenant_id: approval.tenant_id,
      cycle_year: approval.cycle_year,
      cycle_month: approval.cycle_month,
      rejection_reason: parsed.rejection_reason?.trim() || null,
    },
  })

  response.json({
    ok: true,
    approval,
  })
})

export const processReminders = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const result = await processOwnerReminders({
    ownerId,
    organizationId,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'reminders.processed',
    entity_type: 'rent_reminder',
    metadata: result,
  })

  response.json({ ok: true, result })
})

export const getOwnerAutomationSettingsController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const settings = await getOwnerAutomationSettings(ownerId, organizationId)

  response.json({
    ok: true,
    settings,
  })
})

export const putOwnerAutomationSettingsController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const parsed = ownerAutomationSettingsUpdateSchema.parse(request.body ?? {})

  if (Object.keys(parsed).length === 0) {
    throw new AppError('No automation settings provided', 400)
  }

  const settings = await updateOwnerAutomationSettings(ownerId, organizationId, parsed)
  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'automation.settings_updated',
    entity_type: 'owner_automation_settings',
    entity_id: settings.id,
    metadata: parsed,
  })

  response.json({
    ok: true,
    settings,
  })
})

export const getOwnerAutomationActivityController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const parsed = ownerAutomationActivityQuerySchema.parse(request.query)
  const listed = await listOwnerAutomationActivity({
    ownerId,
    organizationId,
    page: parsed.page,
    page_size: parsed.page_size,
  })

  response.json({
    ok: true,
    items: listed.items,
    pagination: {
      page: parsed.page,
      page_size: parsed.page_size,
      total: listed.total,
      total_pages: Math.max(1, Math.ceil(listed.total / parsed.page_size)),
    },
  })
})
