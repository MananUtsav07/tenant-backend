import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/db.js'

export async function createContactMessage(input: { name: string; email: string; message: string }) {
  const data = await prisma.contact_messages.create({
    data: {
      name: input.name,
      email: input.email,
      message: input.message,
    },
    select: { id: true, created_at: true },
  })

  if (!data) {
    throw new AppError('Failed to create contact message', 500)
  }
  return data
}

function getDueDaysForNextWeek(referenceDate: Date): number[] {
  const uniqueDays = new Set<number>()
  for (let offset = 0; offset < 7; offset += 1) {
    const upcoming = new Date(referenceDate)
    upcoming.setUTCDate(referenceDate.getUTCDate() + offset)
    uniqueDays.add(upcoming.getUTCDate())
  }
  return Array.from(uniqueDays)
}

export async function getPublicOperationsSnapshot() {
  const dueDays = getDueDaysForNextWeek(new Date())

  const [openTicketsCount, activeTenantsCount, dueThisWeekCount] = await Promise.all([
    prisma.support_tickets.count({ where: { status: { in: ['open', 'in_progress'] } } }),
    prisma.tenants.count({ where: { status: 'active' } }),
    prisma.tenants.count({ where: { status: 'active', payment_due_day: { in: dueDays } } }),
  ])

  return {
    open_tickets: openTicketsCount,
    active_tenants: activeTenantsCount,
    due_this_week: dueThisWeekCount,
    generated_at: new Date().toISOString(),
  }
}
