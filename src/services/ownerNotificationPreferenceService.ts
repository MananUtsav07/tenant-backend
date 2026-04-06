import { prisma } from '../lib/db.js'

export type OwnerNotificationPreferences = {
  id: string
  organization_id: string
  owner_id: string
  ticket_created_email: boolean
  ticket_created_telegram: boolean
  ticket_reply_email: boolean
  ticket_reply_telegram: boolean
  rent_payment_awaiting_approval_email: boolean
  rent_payment_awaiting_approval_telegram: boolean
  created_at: string
  updated_at: string
}

type OwnerNotificationPreferencePatch = Partial<
  Pick<
    OwnerNotificationPreferences,
    | 'ticket_created_email'
    | 'ticket_created_telegram'
    | 'ticket_reply_email'
    | 'ticket_reply_telegram'
    | 'rent_payment_awaiting_approval_email'
    | 'rent_payment_awaiting_approval_telegram'
  >
>

function defaultPreferences(ownerId: string, organizationId: string): OwnerNotificationPreferences {
  const now = new Date().toISOString()

  return {
    id: 'default',
    organization_id: organizationId,
    owner_id: ownerId,
    ticket_created_email: true,
    ticket_created_telegram: true,
    ticket_reply_email: true,
    ticket_reply_telegram: true,
    rent_payment_awaiting_approval_email: true,
    rent_payment_awaiting_approval_telegram: true,
    created_at: now,
    updated_at: now,
  }
}

export async function getOwnerNotificationPreferences(ownerId: string, organizationId: string): Promise<OwnerNotificationPreferences> {
  const data = await prisma.owner_notification_preferences.findFirst({
    where: { owner_id: ownerId, organization_id: organizationId },
  })
  if (!data) return defaultPreferences(ownerId, organizationId)
  return data as unknown as OwnerNotificationPreferences
}

export async function updateOwnerNotificationPreferences(
  ownerId: string,
  organizationId: string,
  patch: OwnerNotificationPreferencePatch,
): Promise<OwnerNotificationPreferences> {
  const data = await prisma.owner_notification_preferences.upsert({
    where: { organization_id_owner_id: { organization_id: organizationId, owner_id: ownerId } },
    create: { owner_id: ownerId, organization_id: organizationId, ...patch },
    update: { ...patch },
  })
  return data as unknown as OwnerNotificationPreferences
}
