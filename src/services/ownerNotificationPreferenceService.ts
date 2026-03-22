import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'

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

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

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
  const { data, error } = await supabaseAdmin
    .from('owner_notification_preferences')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  throwIfError(error, 'Failed to load owner notification preferences')
  if (!data) {
    return defaultPreferences(ownerId, organizationId)
  }

  return data as OwnerNotificationPreferences
}

export async function updateOwnerNotificationPreferences(
  ownerId: string,
  organizationId: string,
  patch: OwnerNotificationPreferencePatch,
): Promise<OwnerNotificationPreferences> {
  const { data, error } = await supabaseAdmin
    .from('owner_notification_preferences')
    .upsert(
      {
        owner_id: ownerId,
        organization_id: organizationId,
        ...patch,
      },
      { onConflict: 'organization_id,owner_id' },
    )
    .select('*')
    .single()

  throwIfError(error, 'Failed to update owner notification preferences')
  return data as OwnerNotificationPreferences
}
