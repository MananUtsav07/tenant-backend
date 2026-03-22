import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'

type BrokerRow = {
  id: string
  organization_id: string
  owner_id: string | null
  full_name: string
  email: string
  phone: string | null
  agency_name: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

export async function listBrokers(organizationId: string) {
  const { data, error } = await supabaseAdmin
    .from('brokers')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })

  throwIfError(error, 'Failed to load brokers')
  return (data ?? []) as BrokerRow[]
}

export async function createBroker(input: {
  organizationId: string
  ownerId: string
  full_name: string
  email: string
  phone?: string | null
  agency_name?: string | null
  notes?: string | null
  is_active?: boolean
}) {
  const { data, error } = await supabaseAdmin
    .from('brokers')
    .insert({
      organization_id: input.organizationId,
      owner_id: input.ownerId,
      full_name: input.full_name,
      email: input.email,
      phone: input.phone ?? null,
      agency_name: input.agency_name ?? null,
      notes: input.notes ?? null,
      is_active: input.is_active ?? true,
    })
    .select('*')
    .single()

  throwIfError(error, 'Failed to create broker')
  return data as BrokerRow
}

export async function updateBroker(input: {
  organizationId: string
  brokerId: string
  patch: Partial<{
    full_name: string
    email: string
    phone: string | null
    agency_name: string | null
    notes: string | null
    is_active: boolean
  }>
}) {
  const { data, error } = await supabaseAdmin
    .from('brokers')
    .update(input.patch)
    .eq('id', input.brokerId)
    .eq('organization_id', input.organizationId)
    .select('*')
    .maybeSingle()

  throwIfError(error, 'Failed to update broker')
  return (data as BrokerRow | null) ?? null
}

export async function deleteBroker(input: { organizationId: string; brokerId: string }) {
  const { count, error } = await supabaseAdmin
    .from('brokers')
    .delete({ count: 'exact' })
    .eq('id', input.brokerId)
    .eq('organization_id', input.organizationId)

  throwIfError(error, 'Failed to delete broker')
  return count ?? 0
}

export async function getBrokerById(input: { organizationId: string; brokerId: string }) {
  const { data, error } = await supabaseAdmin
    .from('brokers')
    .select('*')
    .eq('id', input.brokerId)
    .eq('organization_id', input.organizationId)
    .maybeSingle()

  throwIfError(error, 'Failed to load broker')
  return (data as BrokerRow | null) ?? null
}
