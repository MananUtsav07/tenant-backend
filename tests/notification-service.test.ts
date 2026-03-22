import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendTenantCredentialNotificationMock = vi.fn(async () => undefined)
const sendTenantPasswordChangeRecommendationEmailMock = vi.fn(async () => undefined)
const sendTenantRentPaymentApprovedEmailMock = vi.fn(async () => undefined)
const sendTenantRentPaymentRejectedEmailMock = vi.fn(async () => undefined)
const getOwnerByIdMock = vi.fn()

vi.mock('../src/config/env.js', () => ({
  env: {
    FRONTEND_URL: 'https://app.prophives.com',
  },
}))

vi.mock('../src/lib/mailer.js', () => ({
  sendOwnerRentPaymentApprovalNotification: vi.fn(),
  sendOwnerTicketNotification: vi.fn(),
  sendTenantCredentialNotification: sendTenantCredentialNotificationMock,
  sendTenantPasswordChangeRecommendationEmail: sendTenantPasswordChangeRecommendationEmailMock,
  sendTenantRentPaymentApprovedEmail: sendTenantRentPaymentApprovedEmailMock,
  sendTenantRentPaymentRejectedEmail: sendTenantRentPaymentRejectedEmailMock,
}))

vi.mock('../src/services/ownerService.js', () => ({
  createOwnerNotification: vi.fn(),
  getOwnerById: getOwnerByIdMock,
}))

vi.mock('../src/services/telegramService.js', () => ({
  getOwnerTelegramChatLink: vi.fn(),
  sendTelegramMessage: vi.fn(),
}))

const notificationService = await import('../src/services/notificationService.js')

describe('tenant-facing email notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    getOwnerByIdMock.mockResolvedValue({
      id: 'owner-1',
      email: 'owner@prophives.com',
      full_name: 'Nadia Owner',
      company_name: 'Prophives Estates',
      support_email: 'support@prophives.com',
    })
  })

  it('sends both tenant onboarding emails with branded destinations', async () => {
    await notificationService.notifyTenantAccountProvisioned({
      organizationId: 'org-1',
      ownerId: 'owner-1',
      tenantId: 'tenant-1',
      tenantName: 'Amina Resident',
      tenantEmail: 'amina@resident.com',
      tenantAccessId: 'PH-TEN-2001',
      temporaryPassword: 'TempPass123',
      propertyName: 'Marina Residence',
      unitNumber: '18A',
    })

    expect(sendTenantCredentialNotificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'amina@resident.com',
        tenantAccessId: 'PH-TEN-2001',
        temporaryPassword: 'TempPass123',
        loginUrl: 'https://app.prophives.com/login-tenant',
      }),
    )

    expect(sendTenantPasswordChangeRecommendationEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'amina@resident.com',
        tenantAccessId: 'PH-TEN-2001',
        resetRequestUrl: 'https://app.prophives.com/tenant/forgot-password',
      }),
    )
  })

  it('sends an approval email when the owner approves the payment', async () => {
    await notificationService.notifyTenantRentPaymentReviewed({
      organizationId: 'org-1',
      ownerId: 'owner-1',
      tenantId: 'tenant-1',
      tenantEmail: 'amina@resident.com',
      tenantName: 'Amina Resident',
      propertyName: 'Marina Residence',
      unitNumber: '18A',
      dueDateIso: '2026-03-05T00:00:00.000Z',
      amountPaid: 12000,
      currencyCode: 'AED',
      status: 'approved',
    })

    expect(sendTenantRentPaymentApprovedEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'amina@resident.com',
        tenantName: 'Amina Resident',
        ownerName: 'Nadia Owner',
      }),
    )
  })

  it('sends a rejection email with the owner message when provided', async () => {
    await notificationService.notifyTenantRentPaymentReviewed({
      organizationId: 'org-1',
      ownerId: 'owner-1',
      tenantId: 'tenant-1',
      tenantEmail: 'amina@resident.com',
      tenantName: 'Amina Resident',
      propertyName: 'Marina Residence',
      unitNumber: '18A',
      dueDateIso: '2026-03-05T00:00:00.000Z',
      amountPaid: 12000,
      currencyCode: 'AED',
      status: 'rejected',
      rejectionReason: 'Please attach a clearer bank transfer reference.',
    })

    expect(sendTenantRentPaymentRejectedEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'amina@resident.com',
        rejectionReason: 'Please attach a clearer bank transfer reference.',
      }),
    )
  })

  it('uses premium default wording when a rejection message is not provided', async () => {
    await notificationService.notifyTenantRentPaymentReviewed({
      organizationId: 'org-1',
      ownerId: 'owner-1',
      tenantId: 'tenant-1',
      tenantEmail: 'amina@resident.com',
      tenantName: 'Amina Resident',
      propertyName: 'Marina Residence',
      unitNumber: '18A',
      dueDateIso: '2026-03-05T00:00:00.000Z',
      amountPaid: 12000,
      currencyCode: 'AED',
      status: 'rejected',
      rejectionReason: null,
    })

    expect(sendTenantRentPaymentRejectedEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'amina@resident.com',
        rejectionReason: expect.stringContaining('could not be approved yet'),
      }),
    )
  })
})
