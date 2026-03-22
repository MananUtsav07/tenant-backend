import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'

type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'closed'
type TicketMessageType = 'initial_message' | 'reply' | 'closing_note' | 'system'

type SupportTicketRecord = {
  id: string
  organization_id: string
  owner_id: string
  tenant_id: string
  subject: string
  message: string
  status: TicketStatus
  created_at: string
  updated_at: string
  tenants?: unknown
  owners?: unknown
  organizations?: unknown
}

type SupportTicketMessageRecord = {
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
  sender_owner?: unknown
  sender_tenant?: unknown
  sender_admin?: unknown
}

type NormalizedTicketMessage = {
  id: string
  ticket_id: string
  organization_id: string
  sender_role: SupportTicketMessageRecord['sender_role']
  sender_owner_id: string | null
  sender_tenant_id: string | null
  sender_admin_id: string | null
  message: string
  message_type: TicketMessageType
  created_at: string
  sender_display_name: string
}

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

function normalizeSingleRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }
  return value ?? null
}

function normalizeTicketRecord(record: SupportTicketRecord | null) {
  if (!record) {
    return null
  }

  return {
    ...record,
    tenants: normalizeSingleRelation(record.tenants),
    owners: normalizeSingleRelation(record.owners),
    organizations: normalizeSingleRelation(record.organizations),
  }
}

function resolveSenderDisplayName(row: Record<string, unknown>) {
  if (row.sender_role === 'tenant') {
    const tenant = normalizeSingleRelation(
      row.sender_tenant as
        | { full_name?: string | null; tenant_access_id?: string | null }
        | Array<{ full_name?: string | null; tenant_access_id?: string | null }>
        | null
        | undefined,
    )
    return tenant?.full_name?.trim() || tenant?.tenant_access_id?.trim() || 'Tenant'
  }

  if (row.sender_role === 'owner') {
    const owner = normalizeSingleRelation(
      row.sender_owner as
        | { full_name?: string | null; company_name?: string | null; email?: string | null }
        | Array<{ full_name?: string | null; company_name?: string | null; email?: string | null }>
        | null
        | undefined,
    )
    return owner?.full_name?.trim() || owner?.company_name?.trim() || owner?.email?.trim() || 'Owner'
  }

  if (row.sender_role === 'admin') {
    const admin = normalizeSingleRelation(
      row.sender_admin as
        | { full_name?: string | null; email?: string | null }
        | Array<{ full_name?: string | null; email?: string | null }>
        | null
        | undefined,
    )
    return admin?.full_name?.trim() || admin?.email?.trim() || 'Admin'
  }

  return 'System'
}

function normalizeTicketMessageRow(row: SupportTicketMessageRecord): NormalizedTicketMessage {
  return {
    id: row.id,
    ticket_id: row.ticket_id,
    organization_id: row.organization_id,
    sender_role: row.sender_role,
    sender_owner_id: row.sender_owner_id,
    sender_tenant_id: row.sender_tenant_id,
    sender_admin_id: row.sender_admin_id,
    message: row.message,
    message_type: row.message_type,
    created_at: row.created_at,
    sender_display_name: resolveSenderDisplayName(row),
  }
}

function ticketSelect() {
  return `
    id,
    organization_id,
    owner_id,
    tenant_id,
    subject,
    message,
    status,
    created_at,
    updated_at,
    tenants(
      id,
      full_name,
      tenant_access_id,
      email,
      properties(id, property_name, unit_number)
    ),
    owners(id, full_name, company_name, email, support_email),
    organizations(id, name, slug)
  `
}

function ticketMessageSelect() {
  return `
    id,
    ticket_id,
    organization_id,
    sender_role,
    sender_owner_id,
    sender_tenant_id,
    sender_admin_id,
    message,
    message_type,
    created_at,
    sender_owner:owners!support_ticket_messages_sender_owner_id_fkey(id, full_name, company_name, email),
    sender_tenant:tenants!support_ticket_messages_sender_tenant_id_fkey(id, full_name, tenant_access_id),
    sender_admin:admin_users!support_ticket_messages_sender_admin_id_fkey(id, full_name, email)
  `
}

async function loadTicketRecord(input: {
  ticketId: string
  organizationId?: string
  tenantId?: string
}): Promise<ReturnType<typeof normalizeTicketRecord>> {
  let request = supabaseAdmin.from('support_tickets').select(ticketSelect()).eq('id', input.ticketId)

  if (input.organizationId) {
    request = request.eq('organization_id', input.organizationId)
  }

  if (input.tenantId) {
    request = request.eq('tenant_id', input.tenantId)
  }

  const { data, error } = await request.maybeSingle()
  throwIfError(error, 'Failed to load support ticket')
  return normalizeTicketRecord(data as SupportTicketRecord | null)
}

async function listTicketMessages(ticketId: string, organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('support_ticket_messages')
    .select(ticketMessageSelect())
    .eq('ticket_id', ticketId)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: true })

  throwIfError(error, 'Failed to load ticket conversation')
  return (data ?? []).map((row) => normalizeTicketMessageRow(row as unknown as SupportTicketMessageRecord))
}

async function touchTicket(ticketId: string, organizationId: string) {
  const { error } = await supabaseAdmin
    .from('support_tickets')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', ticketId)
    .eq('organization_id', organizationId)

  throwIfError(error, 'Failed to update support ticket timestamp')
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
}) {
  const { data, error } = await supabaseAdmin
    .from('support_ticket_messages')
    .insert({
      ticket_id: input.ticketId,
      organization_id: input.organizationId,
      sender_role: input.senderRole,
      sender_owner_id: input.senderOwnerId ?? null,
      sender_tenant_id: input.senderTenantId ?? null,
      sender_admin_id: input.senderAdminId ?? null,
      message: input.message,
      message_type: input.messageType ?? 'reply',
    })
    .select(ticketMessageSelect())
    .single()

  throwIfError(error, 'Failed to store ticket message')
  await touchTicket(input.ticketId, input.organizationId)
  return normalizeTicketMessageRow(data as unknown as SupportTicketMessageRecord)
}

function ensureTicketAcceptsReplies(ticket: { status: TicketStatus } | null) {
  if (!ticket) {
    throw new AppError('Ticket not found', 404)
  }

  if (ticket.status === 'closed') {
    throw new AppError('Closed tickets cannot receive new replies', 400)
  }
}

async function buildThread(ticket: ReturnType<typeof normalizeTicketRecord>) {
  if (!ticket) {
    return null
  }

  const messages = await listTicketMessages(ticket.id, ticket.organization_id)
  return {
    ticket,
    messages,
  }
}

export async function getOwnerTicketThread(input: { ticketId: string; organizationId: string }) {
  const ticket = await loadTicketRecord({
    ticketId: input.ticketId,
    organizationId: input.organizationId,
  })
  return buildThread(ticket)
}

export async function getTenantTicketThread(input: { ticketId: string; tenantId: string; organizationId: string }) {
  const ticket = await loadTicketRecord({
    ticketId: input.ticketId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  })
  return buildThread(ticket)
}

export async function getAdminTicketThread(input: { ticketId: string }) {
  const ticket = await loadTicketRecord({
    ticketId: input.ticketId,
  })
  return buildThread(ticket)
}

export async function replyToTicketAsOwner(input: {
  ticketId: string
  ownerId: string
  organizationId: string
  message: string
}) {
  const ticket = await loadTicketRecord({
    ticketId: input.ticketId,
    organizationId: input.organizationId,
  })
  ensureTicketAcceptsReplies(ticket)

  const message = await insertTicketMessage({
    ticketId: input.ticketId,
    organizationId: input.organizationId,
    senderRole: 'owner',
    senderOwnerId: input.ownerId,
    message: input.message,
    messageType: 'reply',
  })

  return {
    ticket: ticket!,
    message,
  }
}

export async function replyToTicketAsTenant(input: {
  ticketId: string
  tenantId: string
  organizationId: string
  message: string
}) {
  const ticket = await loadTicketRecord({
    ticketId: input.ticketId,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
  })
  ensureTicketAcceptsReplies(ticket)

  const message = await insertTicketMessage({
    ticketId: input.ticketId,
    organizationId: input.organizationId,
    senderRole: 'tenant',
    senderTenantId: input.tenantId,
    message: input.message,
    messageType: 'reply',
  })

  return {
    ticket: ticket!,
    message,
  }
}

export async function replyToTicketAsAdmin(input: {
  ticketId: string
  adminId: string
  message: string
}) {
  const ticket = await loadTicketRecord({
    ticketId: input.ticketId,
  })
  ensureTicketAcceptsReplies(ticket)

  const message = await insertTicketMessage({
    ticketId: input.ticketId,
    organizationId: ticket!.organization_id,
    senderRole: 'admin',
    senderAdminId: input.adminId,
    message: input.message,
    messageType: 'reply',
  })

  return {
    ticket: ticket!,
    message,
  }
}

async function updateTicketStatus(input: {
  ticketId: string
  organizationId: string
  status: TicketStatus
}) {
  const { data, error } = await supabaseAdmin
    .from('support_tickets')
    .update({
      status: input.status,
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.ticketId)
    .eq('organization_id', input.organizationId)
    .select(ticketSelect())
    .maybeSingle()

  throwIfError(error, 'Failed to update ticket status')
  return normalizeTicketRecord(data as SupportTicketRecord | null)
}

export async function updateTicketStatusAsOwner(input: {
  ticketId: string
  organizationId: string
  ownerId: string
  status: TicketStatus
  closingMessage?: string
}) {
  const ticket = await loadTicketRecord({
    ticketId: input.ticketId,
    organizationId: input.organizationId,
  })

  if (!ticket) {
    return null
  }

  const updatedTicket = await updateTicketStatus({
    ticketId: input.ticketId,
    organizationId: input.organizationId,
    status: input.status,
  })

  if (input.status === 'closed' && input.closingMessage) {
    await insertTicketMessage({
      ticketId: input.ticketId,
      organizationId: input.organizationId,
      senderRole: 'owner',
      senderOwnerId: input.ownerId,
      message: input.closingMessage,
      messageType: 'closing_note',
    })
  }

  return updatedTicket
}

export async function updateTicketStatusAsAdmin(input: {
  ticketId: string
  adminId: string
  status: TicketStatus
  closingMessage?: string
}) {
  const ticket = await loadTicketRecord({
    ticketId: input.ticketId,
  })

  if (!ticket) {
    return null
  }

  const updatedTicket = await updateTicketStatus({
    ticketId: input.ticketId,
    organizationId: ticket.organization_id,
    status: input.status,
  })

  if (input.status === 'closed' && input.closingMessage) {
    await insertTicketMessage({
      ticketId: input.ticketId,
      organizationId: ticket.organization_id,
      senderRole: 'admin',
      senderAdminId: input.adminId,
      message: input.closingMessage,
      messageType: 'closing_note',
    })
  }

  return updatedTicket
}
