/**
 * In-memory conversation state manager for multi-step Telegram bot flows.
 * Tracks where each chat is in a wizard (add property, add tenant, etc.)
 * States auto-expire after 10 minutes of inactivity.
 */

const CONVERSATION_TTL_MS = 10 * 60 * 1000 // 10 minutes

// ── Add Property flow steps ──
type AddPropertyState = {
  flow: 'add_property'
  organizationId: string
  ownerId: string
  step: 'property_name' | 'address' | 'unit_number' | 'confirm'
  data: {
    property_name?: string
    address?: string
    unit_number?: string
  }
}

// ── Add Tenant flow steps ──
type AddTenantState = {
  flow: 'add_tenant'
  organizationId: string
  ownerId: string
  step:
    | 'full_name'
    | 'email'
    | 'phone'
    | 'select_property'
    | 'password'
    | 'monthly_rent'
    | 'payment_due_day'
    | 'confirm'
  data: {
    full_name?: string
    email?: string
    phone?: string
    property_id?: string
    property_name?: string
    password?: string
    monthly_rent?: number
    payment_due_day?: number
  }
}

export type ConversationState = AddPropertyState | AddTenantState

type ConversationEntry = {
  state: ConversationState
  updatedAt: number
}

const conversations = new Map<string, ConversationEntry>()

export function getConversation(chatId: string): ConversationState | null {
  const entry = conversations.get(chatId)
  if (!entry) return null

  if (Date.now() - entry.updatedAt > CONVERSATION_TTL_MS) {
    conversations.delete(chatId)
    return null
  }

  return entry.state
}

export function setConversation(chatId: string, state: ConversationState): void {
  conversations.set(chatId, { state, updatedAt: Date.now() })
}

export function clearConversation(chatId: string): void {
  conversations.delete(chatId)
}

// Periodic cleanup of expired conversations (runs every 5 minutes)
setInterval(() => {
  const now = Date.now()
  for (const [chatId, entry] of conversations) {
    if (now - entry.updatedAt > CONVERSATION_TTL_MS) {
      conversations.delete(chatId)
    }
  }
}, 5 * 60 * 1000)
