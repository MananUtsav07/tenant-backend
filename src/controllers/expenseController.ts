import type { Request, Response } from 'express'
import { AppError, asyncHandler } from '../lib/errors.js'
import { createAuditLog } from '../services/auditLogService.js'
import {
  createExpense,
  deleteExpense,
  getExpenseSummary,
  listExpenses,
  updateExpense,
} from '../services/expenseService.js'
import {
  createExpenseSchema,
  listExpensesQuerySchema,
  updateExpenseSchema,
} from '../validations/expenseSchemas.js'

function requireOwnerContext(request: Request): { ownerId: string; organizationId: string } {
  const ownerId = request.owner?.ownerId
  const organizationId = request.owner?.organizationId ?? request.auth?.organizationId ?? null
  if (!ownerId) throw new AppError('Owner authentication required', 401)
  if (!organizationId) throw new AppError('Organization context is required', 401)
  return { ownerId, organizationId }
}

function readPathId(request: Request, paramName: string): string {
  const value = request.params[paramName]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(`Invalid route parameter: ${paramName}`, 400)
  }
  return value
}

export const getOwnerExpensesController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const query = listExpensesQuerySchema.parse(request.query)

  const expenses = await listExpenses({
    organizationId,
    ownerId,
    propertyId: query.property_id,
    category: query.category,
    year: query.year,
    month: query.month,
  })

  response.json({ ok: true, expenses })
})

export const getOwnerExpenseSummaryController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const summary = await getExpenseSummary(organizationId, ownerId)
  response.json({ ok: true, summary })
})

export const createOwnerExpenseController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const parsed = createExpenseSchema.parse(request.body)

  const expense = await createExpense({
    organizationId,
    ownerId,
    propertyId: parsed.property_id,
    category: parsed.category,
    description: parsed.description,
    vendorName: parsed.vendor_name,
    invoiceRef: parsed.invoice_ref,
    amount: parsed.amount,
    incurredOn: parsed.incurred_on,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'expense.created',
    entity_type: 'expense',
    entity_id: expense.id,
    metadata: { category: expense.category, amount: expense.amount },
  })

  response.status(201).json({ ok: true, expense })
})

export const updateOwnerExpenseController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const expenseId = readPathId(request, 'id')
  const parsed = updateExpenseSchema.parse(request.body)

  if (Object.keys(parsed).length === 0) {
    throw new AppError('No fields provided', 400)
  }

  const expense = await updateExpense(organizationId, ownerId, expenseId, {
    propertyId: parsed.property_id,
    category: parsed.category,
    description: parsed.description,
    vendorName: parsed.vendor_name,
    invoiceRef: parsed.invoice_ref,
    amount: parsed.amount,
    incurredOn: parsed.incurred_on,
  })

  if (!expense) throw new AppError('Expense not found', 404)

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'expense.updated',
    entity_type: 'expense',
    entity_id: expense.id,
    metadata: parsed,
  })

  response.json({ ok: true, expense })
})

export const deleteOwnerExpenseController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const expenseId = readPathId(request, 'id')

  const deleted = await deleteExpense(organizationId, ownerId, expenseId)
  if (!deleted) throw new AppError('Expense not found', 404)

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'expense.deleted',
    entity_type: 'expense',
    entity_id: expenseId,
    metadata: {},
  })

  response.json({ ok: true })
})
