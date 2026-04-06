import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/db.js'

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
type TicketMessageType = 'initial_message' | 'reply' | 'closing_note' | 'system'

type NormalizedTicketMessage = {
  id: string
  ticket_id: string
  organization_id: string
  sender_role: 'tenant' | 'owner' | 'admin' | 'system'
  sender_owner_id: string | null
  sender_tenant_id: string | null
  sender_admin_id: string | null
  message: string
  message_type: TicketMessageType
  created_at: string
  sender_display_name: string
}

function normalizeSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function resolveSenderDisplayName(row: Record<string, unknown>) {
  if (row.sender_role === 'tenant') {
    const tenant = normalizeSingleRelation(row.sender_tenant as { full_name?: string | null; tenant_access_id?: string | null } | null)
    return tenant?.full_name?.trim() || tenant?.tenant_access_id?.trim() || 'Tenant'
  }
  if (row.sender_role === 'owner') {
    const owner = normalizeSingleRelation(row.sender_owner as { full_name?: string | null; company_name?: string | null; email?: string | null } | null)
    return owner?.full_name?.trim() || owner?.company_name?.trim() || owner?.email?.trim() || 'Owner'
  }
  if (row.sender_role === 'admin') {
    const admin = normalizeSingleRelation(row.sender_admin as { full_name?: string | null; email?: string | null } | null)
    return admin?.full_name?.trim() || admin?.email?.trim() || 'Admin'
  }
  return 'System'
}

const ticketInclude = {
  tenants: { select: { id: true, full_name: true, tenant_access_id: true, email: true, properties: { select: { id: true, property_name: true, unit_number: true } } } },
  owners: { select: { id: true, full_name: true, company_name: true, email: true, support_email: true } },
  organizations: { select: { id: true, name: true, slug: true } },
}

async function loadTicketRecord(input: { ticketId: string; organizationId?: string; tenantId?: string }) {
  return prisma.support_tickets.findFirst({
    where: {
      id: input.ticketId,
      ...(input.organizationId ? { organization_id: input.organizationId } : {}),
      ...(input.tenantId ? { tenant_id: input.tenantId } : {}),
    },
    include: ticketInclude,
  })
}

async function listTicketMessages(ticketId: string, organizationId: string): Promise<NormalizedTicketMessage[]> {
  const data = await prisma.support_ticket_messages.findMany({
    where: { ticket_id: ticketId, organization_id: organizationId },
    include: {
      owners: { select: { id: true, full_name: true, company_name: true, email: true } },
      tenants: { select: { id: true, full_name: true, tenant_access_id: true } },
      admin_users: { select: { id: true, full_name: true, email: true } },
    },
    orderBy: { created_at: 'asc' },
  })

  return data.map((row) => ({
    id: row.id,
    ticket_id: row.ticket_id,
    organization_id: row.organization_id,
    sender_role: row.sender_role as NormalizedTicketMessage['sender_role'],
    sender_owner_id: row.sender_owner_id,
    sender_tenant_id: row.sender_tenant_id,
    sender_admin_id: row.sender_admin_id,
    message: row.message,
    message_type: row.message_type as TicketMessageType,
    created_at: row.created_at.toISOString(),
    sender_display_name: resolveSenderDisplayName({ ...row, sender_owner: row.owners, sender_tenant: row.tenants, sender_admin: row.admin_users }),
  }))
}

async function touchTicket(ticketId: string, organizationId: string) {
  await prisma.support_tickets.update({ where: { id: ticketId }, data: { updated_at: new Date() } })
}

async function insertTicketMessage(input: {
  ticketId: string
  organizationId: string
  senderRole: 'tenant' | 'owner' | 'admin'
  senderOwnerId?: string
  senderTenantId?: string
  senderAdminId?: string
  message: string
  messageType?: TicketMessageType
}): Promise<NormalizedTicketMessage> {
  const row = await prisma.support_ticket_messages.create({
    data: {
      ticket_id: input.ticketId,
      organization_id: input.organizationId,
      sender_role: input.senderRole,
      sender_owner_id: input.senderOwnerId ?? null,
      sender_tenant_id: input.senderTenantId ?? null,
      sender_admin_id: input.senderAdminId ?? null,
      message: input.message,
      message_type: input.messageType ?? 'reply',
    },
    include: {
      owners: { select: { id: true, full_name: true, company_name: true, email: true } },
      tenants: { select: { id: true, full_name: true, tenant_access_id: true } },
      admin_users: { select: { id: true, full_name: true, email: true } },
    },
  })

  await touchTicket(input.ticketId, input.organizationId)

  return {
    id: row.id,
    ticket_id: row.ticket_id,
    organization_id: row.organization_id,
    sender_role: row.sender_role as NormalizedTicketMessage['sender_role'],
    sender_owner_id: row.sender_owner_id,
    sender_tenant_id: row.sender_tenant_id,
    sender_admin_id: row.sender_admin_id,
    message: row.message,
    message_type: row.message_type as TicketMessageType,
    created_at: row.created_at.toISOString(),
    sender_display_name: resolveSenderDisplayName({ ...row, sender_owner: row.owners, sender_tenant: row.tenants, sender_admin: row.admin_users }),
  }
}

function ensureTicketAcceptsReplies(ticket: { status: string } | null) {
  if (!ticket) throw new AppError('Ticket not found', 404)
  if (ticket.status === 'closed') throw new AppError('Closed tickets cannot receive new replies', 400)
}

async function buildThread(ticket: Awaited<ReturnType<typeof loadTicketRecord>>) {
  if (!ticket) return null
  const messages = await listTicketMessages(ticket.id, ticket.organization_id)
  return { ticket, messages }
}

export async function getOwnerTicketThread(input: { ticketId: string; organizationId: string }) {
  return buildThread(await loadTicketRecord({ ticketId: input.ticketId, organizationId: input.organizationId }))
}

export async function getTenantTicketThread(input: { ticketId: string; tenantId: string; organizationId: string }) {
  return buildThread(await loadTicketRecord({ ticketId: input.ticketId, tenantId: input.tenantId, organizationId: input.organizationId }))
}

export async function getAdminTicketThread(input: { ticketId: string }) {
  return buildThread(await loadTicketRecord({ ticketId: input.ticketId }))
}

export async function replyToTicketAsOwner(input: { ticketId: string; ownerId: string; organizationId: string; message: string }) {
  const ticket = await loadTicketRecord({ ticketId: input.ticketId, organizationId: input.organizationId })
  ensureTicketAcceptsReplies(ticket)
  const message = await insertTicketMessage({ ticketId: input.ticketId, organizationId: input.organizationId, senderRole: 'owner', senderOwnerId: input.ownerId, message: input.message, messageType: 'reply' })
  return { ticket: ticket!, message }
}

export async function replyToTicketAsTenant(input: { ticketId: string; tenantId: string; organizationId: string; message: string }) {
  const ticket = await loadTicketRecord({ ticketId: input.ticketId, tenantId: input.tenantId, organizationId: input.organizationId })
  ensureTicketAcceptsReplies(ticket)
  const message = await insertTicketMessage({ ticketId: input.ticketId, organizationId: input.organizationId, senderRole: 'tenant', senderTenantId: input.tenantId, message: input.message, messageType: 'reply' })
  return { ticket: ticket!, message }
}

export async function replyToTicketAsAdmin(input: { ticketId: string; adminId: string; message: string }) {
  const ticket = await loadTicketRecord({ ticketId: input.ticketId })
  ensureTicketAcceptsReplies(ticket)
  const message = await insertTicketMessage({ ticketId: input.ticketId, organizationId: ticket!.organization_id, senderRole: 'admin', senderAdminId: input.adminId, message: input.message, messageType: 'reply' })
  return { ticket: ticket!, message }
}

async function updateTicketStatus(input: { ticketId: string; organizationId: string; status: TicketStatus }) {
  return prisma.support_tickets.update({ where: { id: input.ticketId }, data: { status: input.status, updated_at: new Date() }, include: ticketInclude })
}

export async function updateTicketStatusAsOwner(input: { ticketId: string; organizationId: string; ownerId: string; status: TicketStatus; closingMessage?: string }) {
  const ticket = await loadTicketRecord({ ticketId: input.ticketId, organizationId: input.organizationId })
  if (!ticket) return null
  const updatedTicket = await updateTicketStatus({ ticketId: input.ticketId, organizationId: input.organizationId, status: input.status })
  if (input.status === 'closed' && input.closingMessage) {
    await insertTicketMessage({ ticketId: input.ticketId, organizationId: input.organizationId, senderRole: 'owner', senderOwnerId: input.ownerId, message: input.closingMessage, messageType: 'closing_note' })
  }
  return updatedTicket
}

export async function updateTicketStatusAsAdmin(input: { ticketId: string; adminId: string; status: TicketStatus; closingMessage?: string }) {
  const ticket = await loadTicketRecord({ ticketId: input.ticketId })
  if (!ticket) return null
  const updatedTicket = await updateTicketStatus({ ticketId: input.ticketId, organizationId: ticket.organization_id, status: input.status })
  if (input.status === 'closed' && input.closingMessage) {
    await insertTicketMessage({ ticketId: input.ticketId, organizationId: ticket.organization_id, senderRole: 'admin', senderAdminId: input.adminId, message: input.closingMessage, messageType: 'closing_note' })
  }
  return updatedTicket
}
