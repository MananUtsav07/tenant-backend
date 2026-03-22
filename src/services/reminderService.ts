import { addDays, nextDueDateFromDay } from '../utils/date.js'
import { isReminderGenerationEnabled } from './ai/featureFlags.js'
import { createOwnerNotification } from './ownerService.js'
import { createRentReminders, listAllTenantsForOrganization, listOrganizationReminders, markReminderAsSent } from './tenantService.js'

const reminderOffsets = [
  { type: '7_days_before', offset: -7 },
  { type: '1_day_before', offset: -1 },
  { type: 'due_today', offset: 0 },
  { type: '3_days_late', offset: 3 },
  { type: '7_days_late', offset: 7 },
] as const

type ReminderType = (typeof reminderOffsets)[number]['type']

const reminderLabel: Record<ReminderType, string> = {
  '7_days_before': 'Rent due in 7 days',
  '1_day_before': 'Rent due tomorrow',
  due_today: 'Rent is due today',
  '3_days_late': 'Rent is 3 days overdue',
  '7_days_late': 'Rent is 7 days overdue',
}

function shouldNotifyForReminder(reminderType: ReminderType): boolean {
  return reminderType === '1_day_before' || reminderType === 'due_today' || reminderType === '3_days_late' || reminderType === '7_days_late'
}

export async function generateRemindersForTenant(args: {
  tenantId: string
  organizationId: string
  ownerId: string
  paymentDueDay: number
  baseDate?: Date
}) {
  const dueDate = nextDueDateFromDay(args.paymentDueDay, args.baseDate ?? new Date())
  const created: Array<{ reminder_type: string; scheduled_for: string }> = []

  for (const reminder of reminderOffsets) {
    const scheduledFor = addDays(dueDate, reminder.offset)
    const scheduledIso = scheduledFor.toISOString()

    await createRentReminders({
      organization_id: args.organizationId,
      tenant_id: args.tenantId,
      owner_id: args.ownerId,
      reminder_type: reminder.type,
      scheduled_for: scheduledIso,
    })

    created.push({
      reminder_type: reminder.type,
      scheduled_for: scheduledIso,
    })
  }

  return created
}

export async function processOwnerReminders(input: { ownerId: string; organizationId: string }) {
  const now = new Date()
  const aiReminderGenerationEnabled = await isReminderGenerationEnabled(input.organizationId)
  const tenants = await listAllTenantsForOrganization(input.organizationId)
  const activeTenants = tenants.filter((tenant) => tenant.status === 'active')

  let generated = 0
  for (const tenant of activeTenants) {
    await generateRemindersForTenant({
      tenantId: tenant.id,
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      paymentDueDay: tenant.payment_due_day,
      baseDate: now,
    })
    generated += reminderOffsets.length
  }

  const reminders = await listOrganizationReminders(input.organizationId)
  const tenantById = new Map(activeTenants.map((tenant) => [tenant.id, tenant]))

  let notificationsCreated = 0
  for (const reminder of reminders) {
    if (reminder.status !== 'pending') {
      continue
    }

    const scheduledFor = new Date(reminder.scheduled_for)
    if (Number.isNaN(scheduledFor.getTime()) || scheduledFor > now) {
      continue
    }

    const tenant = tenantById.get(reminder.tenant_id)
    if (!tenant) {
      continue
    }

    const reminderType = reminder.reminder_type as ReminderType
    if (shouldNotifyForReminder(reminderType)) {
      if (aiReminderGenerationEnabled) {
        // Infrastructure-only hook:
        // AI reminder generation is intentionally not active yet.
        // Future rollout will inject generated reminder copy here.
      }

      await createOwnerNotification({
        organization_id: input.organizationId,
        owner_id: input.ownerId,
        tenant_id: reminder.tenant_id,
        notification_type: `rent_reminder_${reminderType}`,
        title: reminderLabel[reminderType],
        message: `Tenant ${tenant.full_name} (${tenant.tenant_access_id}) has a reminder: ${reminderLabel[reminderType]}.`,
      })
      notificationsCreated += 1
    }

    await markReminderAsSent(reminder.id, input.organizationId)
  }

  const refreshedReminders = await listOrganizationReminders(input.organizationId)

  return {
    tenants_scanned: activeTenants.length,
    reminders_generated_attempted: generated,
    reminders_total: refreshedReminders.length,
    notifications_created: notificationsCreated,
  }
}
