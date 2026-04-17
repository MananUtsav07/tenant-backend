import { prisma } from '../lib/db.js'
import { Prisma } from '@prisma/client'

export type CreateExpenseInput = {
  organizationId: string
  ownerId: string
  propertyId: string
  category: string
  description: string
  vendorName?: string | null
  invoiceRef?: string | null
  amount: number
  incurredOn: string
}

export type UpdateExpenseInput = {
  propertyId?: string
  category?: string
  description?: string
  vendorName?: string | null
  invoiceRef?: string | null
  amount?: number
  incurredOn?: string
}

export type ExpenseFilters = {
  organizationId: string
  ownerId: string
  propertyId?: string
  category?: string
  year?: number
  month?: number
}

export async function listExpenses(filters: ExpenseFilters) {
  const where: Record<string, unknown> = {
    organization_id: filters.organizationId,
    owner_id: filters.ownerId,
    source_type: 'manual_expense',
  }

  if (filters.propertyId) {
    where.property_id = filters.propertyId
  }

  if (filters.category) {
    where.category = filters.category
  }

  if (filters.year !== undefined) {
    const start = new Date(filters.year, filters.month !== undefined ? filters.month - 1 : 0, 1)
    const end =
      filters.month !== undefined
        ? new Date(filters.year, filters.month, 1)
        : new Date(filters.year + 1, 0, 1)
    where.incurred_on = { gte: start, lt: end }
  }

  const rows = await prisma.maintenance_cost_entries.findMany({
    where,
    include: {
      properties: {
        select: { property_name: true, address: true, unit_number: true },
      },
    },
    orderBy: { incurred_on: 'desc' },
  })

  return rows.map(serializeExpense)
}

export async function createExpense(input: CreateExpenseInput) {
  const row = await prisma.maintenance_cost_entries.create({
    data: {
      organization_id: input.organizationId,
      owner_id: input.ownerId,
      recorded_by_owner_id: input.ownerId,
      property_id: input.propertyId,
      source_type: 'manual_expense',
      recorded_by_role: 'owner',
      category: input.category,
      description: input.description,
      vendor_name: input.vendorName ?? null,
      invoice_ref: input.invoiceRef ?? null,
      amount: new Prisma.Decimal(input.amount),
      incurred_on: new Date(input.incurredOn),
      status: 'recorded',
    },
    include: {
      properties: {
        select: { property_name: true, address: true, unit_number: true },
      },
    },
  })

  return serializeExpense(row)
}

export async function updateExpense(
  organizationId: string,
  ownerId: string,
  expenseId: string,
  input: UpdateExpenseInput,
) {
  const existing = await prisma.maintenance_cost_entries.findFirst({
    where: { id: expenseId, organization_id: organizationId, owner_id: ownerId, source_type: 'manual_expense' },
  })

  if (!existing) return null

  const updateData: Record<string, unknown> = {}
  if (input.propertyId !== undefined) updateData.property_id = input.propertyId
  if (input.category !== undefined) updateData.category = input.category
  if (input.description !== undefined) updateData.description = input.description
  if ('vendorName' in input) updateData.vendor_name = input.vendorName ?? null
  if ('invoiceRef' in input) updateData.invoice_ref = input.invoiceRef ?? null
  if (input.amount !== undefined) updateData.amount = new Prisma.Decimal(input.amount)
  if (input.incurredOn !== undefined) updateData.incurred_on = new Date(input.incurredOn)

  const row = await prisma.maintenance_cost_entries.update({
    where: { id: expenseId },
    data: updateData,
    include: {
      properties: {
        select: { property_name: true, address: true, unit_number: true },
      },
    },
  })

  return serializeExpense(row)
}

export async function deleteExpense(
  organizationId: string,
  ownerId: string,
  expenseId: string,
): Promise<boolean> {
  const existing = await prisma.maintenance_cost_entries.findFirst({
    where: { id: expenseId, organization_id: organizationId, owner_id: ownerId, source_type: 'manual_expense' },
  })

  if (!existing) return false

  await prisma.maintenance_cost_entries.delete({ where: { id: expenseId } })
  return true
}

export async function getExpenseSummary(organizationId: string, ownerId: string) {
  const now = new Date()
  const thisYearStart = new Date(now.getFullYear(), 0, 1)
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const baseWhere = {
    organization_id: organizationId,
    owner_id: ownerId,
    source_type: 'manual_expense',
  }

  const [yearRows, monthRows] = await Promise.all([
    prisma.maintenance_cost_entries.findMany({
      where: { ...baseWhere, incurred_on: { gte: thisYearStart } },
      select: { amount: true, category: true },
    }),
    prisma.maintenance_cost_entries.findMany({
      where: { ...baseWhere, incurred_on: { gte: thisMonthStart, lt: nextMonthStart } },
      select: { amount: true },
    }),
  ])

  const totalThisYear = yearRows.reduce((sum, r) => sum + Number(r.amount), 0)
  const totalThisMonth = monthRows.reduce((sum, r) => sum + Number(r.amount), 0)

  const byCategory: Record<string, number> = {}
  for (const row of yearRows) {
    const cat = row.category ?? 'other'
    byCategory[cat] = (byCategory[cat] ?? 0) + Number(row.amount)
  }

  return { totalThisYear, totalThisMonth, byCategory }
}

type ExpenseRow = Awaited<ReturnType<typeof prisma.maintenance_cost_entries.findFirst>> & {
  properties?: { property_name: string; address: string; unit_number: string | null } | null
}

function serializeExpense(row: NonNullable<ExpenseRow>) {
  return {
    id: row.id,
    organization_id: row.organization_id,
    owner_id: row.owner_id,
    property_id: row.property_id,
    category: row.category ?? 'other',
    description: row.description ?? '',
    vendor_name: row.vendor_name ?? null,
    invoice_ref: row.invoice_ref ?? null,
    amount: Number(row.amount),
    incurred_on: row.incurred_on instanceof Date
      ? row.incurred_on.toISOString().slice(0, 10)
      : String(row.incurred_on),
    property_name: row.properties?.property_name ?? null,
    property_address: row.properties?.address ?? null,
    property_unit: row.properties?.unit_number ?? null,
    created_at: row.created_at.toISOString(),
  }
}
