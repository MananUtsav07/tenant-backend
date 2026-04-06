import { prisma } from '../lib/db.js'

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

export async function listBrokers(organizationId: string) {
  const data = await prisma.brokers.findMany({
    where: { organization_id: organizationId },
    orderBy: { created_at: 'desc' },
  })

  return data as unknown as BrokerRow[]
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
  const data = await prisma.brokers.create({
    data: {
      organization_id: input.organizationId,
      owner_id: input.ownerId,
      full_name: input.full_name,
      email: input.email,
      phone: input.phone ?? null,
      agency_name: input.agency_name ?? null,
      notes: input.notes ?? null,
      is_active: input.is_active ?? true,
    },
  })

  return data as unknown as BrokerRow
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
  const data = await prisma.brokers.findFirst({
    where: { id: input.brokerId, organization_id: input.organizationId },
  })

  if (!data) return null

  const updated = await prisma.brokers.update({
    where: { id: input.brokerId },
    data: input.patch,
  })

  return (updated as unknown as BrokerRow | null) ?? null
}

export async function deleteBroker(input: { organizationId: string; brokerId: string }) {
  const existing = await prisma.brokers.findFirst({
    where: { id: input.brokerId, organization_id: input.organizationId },
    select: { id: true },
  })

  if (!existing) return 0

  await prisma.brokers.delete({ where: { id: input.brokerId } })
  return 1
}

export async function getBrokerById(input: { organizationId: string; brokerId: string }) {
  const data = await prisma.brokers.findFirst({
    where: { id: input.brokerId, organization_id: input.organizationId },
  })

  return (data as BrokerRow | null) ?? null
}
