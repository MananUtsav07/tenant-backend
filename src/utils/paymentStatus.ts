import { addDays, toUtcDateWithDay } from './date.js'

export type TenantPaymentStatus = 'pending' | 'paid' | 'overdue' | 'partial'

export function getCurrentCycleDueDate(paymentDueDay: number, now = new Date()): Date {
  return toUtcDateWithDay(now, paymentDueDay)
}

export function getCurrentCycleYearMonth(now = new Date()): { cycleYear: number; cycleMonth: number } {
  return {
    cycleYear: now.getUTCFullYear(),
    cycleMonth: now.getUTCMonth() + 1,
  }
}

export function resolveTenantPaymentStatus(input: {
  paymentStatus: TenantPaymentStatus
  paymentDueDay: number
  isCurrentCycleApproved?: boolean
  now?: Date
}): TenantPaymentStatus {
  const now = input.now ?? new Date()
  const dueDate = getCurrentCycleDueDate(input.paymentDueDay, now)
  const pendingWindowStartsAt = addDays(dueDate, -7)

  if (input.isCurrentCycleApproved) {
    return 'paid'
  }

  if (now > dueDate) {
    return 'overdue'
  }

  if (now >= pendingWindowStartsAt) {
    return 'pending'
  }

  return input.paymentStatus === 'partial' ? 'partial' : 'paid'
}
