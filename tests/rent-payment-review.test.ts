import { beforeEach, describe, expect, it, vi } from 'vitest'

type ApprovalRecord = {
  id: string
  organization_id: string
  owner_id: string
  tenant_id: string
  property_id: string
  cycle_year: number
  cycle_month: number
  due_date: string
  amount_paid: number
  status: 'awaiting_owner_approval' | 'approved' | 'rejected'
  rejection_reason: string | null
  reviewed_by_owner_id: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
}

let approvalRecord: ApprovalRecord
const notifyTenantRentPaymentReviewedMock = vi.fn(async () => undefined)
const getTenantByIdMock = vi.fn()

function matchesFilters(row: Record<string, unknown>, filters: Record<string, unknown>) {
  return Object.entries(filters).every(([key, value]) => row[key] === value)
}

vi.mock('../src/services/notificationService.js', () => ({
  notifyOwnerRentPaymentAwaitingApproval: vi.fn(),
  notifyTenantRentPaymentReviewed: notifyTenantRentPaymentReviewedMock,
}))

vi.mock('../src/services/tenantService.js', () => ({
  getTenantById: getTenantByIdMock,
}))

vi.mock('../src/lib/supabase.js', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      if (table !== 'rent_payment_approvals') {
        throw new Error(`Unexpected table in test: ${table}`)
      }

      return {
        select: () => {
          const filters: Record<string, unknown> = {}
          const request = {
            eq(column: string, value: unknown) {
              filters[column] = value
              return request
            },
            maybeSingle: async () => ({
              data: matchesFilters(approvalRecord, filters) ? { ...approvalRecord } : null,
              error: null,
            }),
          }
          return request
        },
        update: (patch: Partial<ApprovalRecord>) => {
          const filters: Record<string, unknown> = {}
          const request = {
            eq(column: string, value: unknown) {
              filters[column] = value
              return request
            },
            select() {
              return request
            },
            single: async () => {
              if (!matchesFilters(approvalRecord, filters)) {
                return { data: null, error: null }
              }

              approvalRecord = {
                ...approvalRecord,
                ...patch,
              }

              return {
                data: {
                  ...approvalRecord,
                  tenants: {
                    full_name: 'Amina Resident',
                    tenant_access_id: 'PH-TEN-2001',
                    email: 'amina@resident.com',
                  },
                  properties: {
                    property_name: 'Marina Residence',
                    unit_number: '18A',
                  },
                },
                error: null,
              }
            },
          }
          return request
        },
      }
    }),
  },
}))

const rentPaymentService = await import('../src/services/rentPaymentService.js')

describe('rent payment review journey', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    approvalRecord = {
      id: 'approval-1',
      organization_id: 'org-1',
      owner_id: 'owner-1',
      tenant_id: 'tenant-1',
      property_id: 'property-1',
      cycle_year: 2026,
      cycle_month: 3,
      due_date: '2026-03-05',
      amount_paid: 12000,
      status: 'awaiting_owner_approval',
      rejection_reason: null,
      reviewed_by_owner_id: null,
      reviewed_at: null,
      created_at: '2026-03-01T10:00:00.000Z',
      updated_at: '2026-03-01T10:00:00.000Z',
    }

    getTenantByIdMock.mockResolvedValue({
      id: 'tenant-1',
      email: 'amina@resident.com',
      full_name: 'Amina Resident',
      properties: {
        property_name: 'Marina Residence',
        unit_number: '18A',
      },
      organizations: {
        currency_code: 'AED',
      },
    })
  })

  it('hooks the approval path into the tenant approval email flow', async () => {
    const approval = await rentPaymentService.reviewOwnerRentPaymentApproval({
      approvalId: 'approval-1',
      ownerId: 'owner-1',
      organizationId: 'org-1',
      action: 'approve',
    })

    expect(approval.status).toBe('approved')
    expect(notifyTenantRentPaymentReviewedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        status: 'approved',
        currencyCode: 'AED',
      }),
    )
  })

  it('hooks rejection with an owner message into the tenant rejection email flow', async () => {
    const approval = await rentPaymentService.reviewOwnerRentPaymentApproval({
      approvalId: 'approval-1',
      ownerId: 'owner-1',
      organizationId: 'org-1',
      action: 'reject',
      rejectionReason: 'Please attach a clearer transfer reference.',
    })

    expect(approval.status).toBe('rejected')
    expect(notifyTenantRentPaymentReviewedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        status: 'rejected',
        rejectionReason: 'Please attach a clearer transfer reference.',
      }),
    )
  })

  it('passes a null reason so the tenant email service can apply default rejection wording', async () => {
    const approval = await rentPaymentService.reviewOwnerRentPaymentApproval({
      approvalId: 'approval-1',
      ownerId: 'owner-1',
      organizationId: 'org-1',
      action: 'reject',
    })

    expect(approval.status).toBe('rejected')
    expect(notifyTenantRentPaymentReviewedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        status: 'rejected',
        rejectionReason: null,
      }),
    )
  })
})
