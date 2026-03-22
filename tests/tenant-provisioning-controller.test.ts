import bcrypt from 'bcryptjs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createTenantMock = vi.fn()
const getPropertyForOwnerMock = vi.fn()
const getOwnerByIdMock = vi.fn()
const notifyTenantAccountProvisionedMock = vi.fn(async () => undefined)
const createAuditLogMock = vi.fn(async () => undefined)

vi.mock('../src/services/ownerService.js', () => ({
  createProperty: vi.fn(),
  createTenant: createTenantMock,
  deleteProperty: vi.fn(),
  deleteTenant: vi.fn(),
  getOwnerDashboardSummary: vi.fn(),
  getOwnerById: getOwnerByIdMock,
  getPropertyForOwner: getPropertyForOwnerMock,
  getTenantDetailAggregate: vi.fn(),
  listOwnerNotifications: vi.fn(),
  listOwnerTickets: vi.fn(),
  listProperties: vi.fn(),
  listTenants: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
  updateOwnerTicket: vi.fn(),
  updateProperty: vi.fn(),
  updateTenant: vi.fn(),
}))

vi.mock('../src/services/notificationService.js', () => ({
  notifyTenantAccountProvisioned: notifyTenantAccountProvisionedMock,
}))

vi.mock('../src/services/auditLogService.js', () => ({
  createAuditLog: createAuditLogMock,
}))

vi.mock('../src/services/ownerAutomationService.js', () => ({
  getOwnerAutomationSettings: vi.fn(),
  listOwnerAutomationActivity: vi.fn(),
  updateOwnerAutomationSettings: vi.fn(),
}))

vi.mock('../src/services/reminderService.js', () => ({
  processOwnerReminders: vi.fn(),
}))

vi.mock('../src/services/rentPaymentService.js', () => ({
  listOwnerAwaitingRentPaymentApprovals: vi.fn(),
  reviewOwnerRentPaymentApproval: vi.fn(),
}))

vi.mock('../src/services/telegramOnboardingService.js', () => ({
  createOwnerTelegramConnectUrl: vi.fn(),
  disconnectOwnerTelegram: vi.fn(),
  getOwnerTelegramConnectionState: vi.fn(),
  getTelegramBotUsername: vi.fn(),
}))

function createMockResponse() {
  let statusCode = 200
  let payload: unknown
  let resolveCompleted: (() => void) | null = null
  const completed = new Promise<void>((resolve) => {
    resolveCompleted = resolve
  })

  const response = {
    status: vi.fn((code: number) => {
      statusCode = code
      return response
    }),
    json: vi.fn((value: unknown) => {
      payload = value
      resolveCompleted?.()
      return response
    }),
  }

  return {
    response: response as any,
    get statusCode() {
      return statusCode
    },
    get payload() {
      return payload
    },
    completed,
  }
}

const ownerController = await import('../src/controllers/ownerController.js')

describe('tenant provisioning controller journey', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    getPropertyForOwnerMock.mockResolvedValue({
      id: 'property-1',
      property_name: 'Marina Residence',
      unit_number: '18A',
    })

    getOwnerByIdMock.mockResolvedValue({
      id: 'owner-1',
      email: 'owner@prophives.com',
    })

    createTenantMock.mockResolvedValue({
      id: 'tenant-1',
      full_name: 'Amina Resident',
      email: 'amina@resident.com',
      tenant_access_id: 'PH-TEN-2001',
      property_id: 'property-1',
    })
  })

  it('calls tenant onboarding notifications when an owner creates a tenant', async () => {
    const response = createMockResponse()
    const request = {
      body: {
        property_id: '11111111-1111-4111-8111-111111111111',
        full_name: 'Amina Resident',
        email: 'amina@resident.com',
        phone: '+971500000000',
        password: 'TempPass123',
        monthly_rent: 12000,
        payment_due_day: 5,
      },
      owner: {
        ownerId: 'owner-1',
        email: 'owner@prophives.com',
        organizationId: 'org-1',
      },
      auth: {
        organizationId: 'org-1',
      },
    } as any

    ownerController.createOwnerTenant(request, response.response, vi.fn())
    await response.completed

    expect(response.statusCode).toBe(201)
    expect((response.payload as any).tenant.tenant_access_id).toBe('PH-TEN-2001')
    expect(createAuditLogMock).toHaveBeenCalledTimes(1)
    expect(notifyTenantAccountProvisionedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        ownerId: 'owner-1',
        tenantName: 'Amina Resident',
        tenantEmail: 'amina@resident.com',
        tenantAccessId: 'PH-TEN-2001',
        temporaryPassword: 'TempPass123',
        propertyName: 'Marina Residence',
        unitNumber: '18A',
      }),
    )

    const createTenantArgs = createTenantMock.mock.calls[0][0]
    expect(createTenantArgs.input.password_hash).not.toBe('TempPass123')
    expect(await bcrypt.compare('TempPass123', createTenantArgs.input.password_hash)).toBe(true)
  })
})
