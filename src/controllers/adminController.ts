import bcrypt from 'bcryptjs'
import type { Request, Response } from 'express'

import { AppError, asyncHandler } from '../lib/errors.js'
import { signAdminToken } from '../lib/jwt.js'
import { createAuditLog } from '../services/auditLogService.js'
import { getAdminAiStatusSummary } from '../services/ai/aiConfigService.js'
import { getAdminCashFlowOverview } from '../services/automation/cashFlowReportService.js'
import { getAdminComplianceOverview } from '../services/complianceService.js'
import { getAdminConditionReportOverview } from '../services/conditionReportService.js'
import { getAutomationHealth, listAutomationErrors, listAutomationRuns, listQueuedAutomationJobs } from '../services/automationEngineService.js'
import { getAdminPortfolioVisibilityOverview } from '../services/portfolioVisibilityService.js'
import { createScreeningApplicant, getAdminScreeningOverview } from '../services/screeningWorkflowService.js'
import { getAdminVacancyCampaignOverview } from '../services/vacancyWorkflowService.js'
import {
  findAdminByEmail,
  getAdminOrganizationDetail,
  listAdminOrganizations,
  getAdminById,
  getAdminDashboardSummary,
  getSystemHealthMetrics,
  listAdminAnalytics,
  listAdminContactMessages,
  listAdminOwners,
  listAdminProperties,
  listAdminTenants,
  listAdminTickets,
} from '../services/adminService.js'
import { createAnalyticsEvent } from '../services/analyticsService.js'
import { createBlogPost, deleteBlogPost, listBlogPosts, updateBlogPost } from '../services/blogService.js'
import { notifyTenantTicketClosed, notifyTenantTicketReply, notifyTenantTicketStatusUpdated } from '../services/notificationService.js'
import { cleanupTelegramArtifacts } from '../services/telegramService.js'
import { getAdminTicketThread, replyToTicketAsAdmin, updateTicketStatusAsAdmin } from '../services/ticketThreadService.js'
import {
  adminAnalyticsListQuerySchema,
  adminContactMessageListQuerySchema,
  adminLoginSchema,
  adminOwnerListQuerySchema,
  adminPropertyListQuerySchema,
  adminTenantListQuerySchema,
  adminTicketListQuerySchema,
  adminOrganizationListQuerySchema,
} from '../validations/adminSchemas.js'
import { adminBlogListQuerySchema, createBlogPostSchema, updateBlogPostSchema } from '../validations/blogSchemas.js'
import {
  adminAutomationComplianceQuerySchema,
  adminAutomationCashFlowQuerySchema,
  adminAutomationErrorsQuerySchema,
  adminAutomationJobsQuerySchema,
  adminAutomationPortfolioVisibilityQuerySchema,
  adminAutomationRunsQuerySchema,
} from '../validations/automationSchemas.js'
import { adminAutomationConditionReportsQuerySchema } from '../validations/conditionReportSchemas.js'
import { adminCreateScreeningApplicantSchema, adminScreeningListQuerySchema } from '../validations/screeningSchemas.js'
import { adminTelegramMaintenanceSchema } from '../validations/notificationSchemas.js'
import { createTicketReplySchema, updateSupportTicketStatusSchema } from '../validations/ticketSchemas.js'
import { adminAutomationVacancyCampaignQuerySchema } from '../validations/vacancyWorkflowSchemas.js'

function requireAdminId(request: Request): string {
  const adminId = request.admin?.adminId
  if (!adminId) {
    throw new AppError('Admin authentication required', 401)
  }
  return adminId
}

function readPathId(request: Request, paramName: string): string {
  const value = request.params[paramName]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(`Invalid route parameter: ${paramName}`, 400)
  }
  return value
}

function paginationPayload(page: number, pageSize: number, total: number) {
  return {
    page,
    page_size: pageSize,
    total,
    total_pages: Math.max(1, Math.ceil(total / pageSize)),
  }
}

async function trackAdminAnalyticsSafe(input: { event_name: string; metadata: Record<string, unknown> }) {
  try {
    await createAnalyticsEvent({
      event_name: input.event_name,
      user_type: 'admin',
      metadata: input.metadata,
    })
  } catch (error) {
    console.error('[analytics-event-failed]', {
      event_name: input.event_name,
      error,
    })
  }
}

export const loginAdmin = asyncHandler(async (request: Request, response: Response) => {
  const parsed = adminLoginSchema.parse(request.body)

  const admin = await findAdminByEmail(parsed.email)
  if (!admin) {
    throw new AppError('Invalid admin credentials', 401)
  }

  const matches = await bcrypt.compare(parsed.password, admin.password_hash)
  if (!matches) {
    throw new AppError('Invalid admin credentials', 401)
  }

  const token = signAdminToken(admin.id, admin.email)

  await trackAdminAnalyticsSafe({
    event_name: 'admin_login',
    metadata: {
      admin_id: admin.id,
      email: admin.email,
    },
  })

  response.json({
    ok: true,
    token,
    admin: {
      id: admin.id,
      email: admin.email,
      full_name: admin.full_name,
      created_at: admin.created_at,
    },
  })
})

export const adminMe = asyncHandler(async (request: Request, response: Response) => {
  const adminId = requireAdminId(request)
  const admin = await getAdminById(adminId)
  if (!admin) {
    throw new AppError('Admin not found', 404)
  }

  response.json({
    ok: true,
    admin,
  })
})

export const getAdminDashboard = asyncHandler(async (_request: Request, response: Response) => {
  const summary = await getAdminDashboardSummary()
  response.json({ ok: true, summary })
})

export const getAdminOwners = asyncHandler(async (request: Request, response: Response) => {
  const parsed = adminOwnerListQuerySchema.parse(request.query)
  const listed = await listAdminOwners(parsed)
  response.json({
    ok: true,
    items: listed.items,
    pagination: paginationPayload(parsed.page, parsed.page_size, listed.total),
    sort: {
      sort_by: parsed.sort_by,
      sort_order: parsed.sort_order,
    },
    search: parsed.search ?? '',
  })
})

export const getAdminTenants = asyncHandler(async (request: Request, response: Response) => {
  const parsed = adminTenantListQuerySchema.parse(request.query)
  const listed = await listAdminTenants(parsed)
  response.json({
    ok: true,
    items: listed.items,
    pagination: paginationPayload(parsed.page, parsed.page_size, listed.total),
    sort: {
      sort_by: parsed.sort_by,
      sort_order: parsed.sort_order,
    },
    search: parsed.search ?? '',
  })
})

export const getAdminProperties = asyncHandler(async (request: Request, response: Response) => {
  const parsed = adminPropertyListQuerySchema.parse(request.query)
  const listed = await listAdminProperties(parsed)
  response.json({
    ok: true,
    items: listed.items,
    pagination: paginationPayload(parsed.page, parsed.page_size, listed.total),
    sort: {
      sort_by: parsed.sort_by,
      sort_order: parsed.sort_order,
    },
    search: parsed.search ?? '',
  })
})

export const getAdminTickets = asyncHandler(async (request: Request, response: Response) => {
  const parsed = adminTicketListQuerySchema.parse(request.query)
  const listed = await listAdminTickets(parsed)
  response.json({
    ok: true,
    items: listed.items,
    pagination: paginationPayload(parsed.page, parsed.page_size, listed.total),
    sort: {
      sort_by: parsed.sort_by,
      sort_order: parsed.sort_order,
    },
    search: parsed.search ?? '',
  })
})

export const getAdminTicketById = asyncHandler(async (request: Request, response: Response) => {
  const ticketId = readPathId(request, 'id')
  const thread = await getAdminTicketThread({ ticketId })
  if (!thread) {
    throw new AppError('Ticket not found', 404)
  }

  response.json({ ok: true, thread })
})

export const postAdminTicketReply = asyncHandler(async (request: Request, response: Response) => {
  const adminId = requireAdminId(request)
  const ticketId = readPathId(request, 'id')
  const parsed = createTicketReplySchema.parse(request.body)

  const result = await replyToTicketAsAdmin({
    ticketId,
    adminId,
    message: parsed.message,
  })

  const tenant = result.ticket.tenants as
    | {
        id: string
        full_name: string
        email?: string | null
        properties?: { property_name?: string | null; unit_number?: string | null } | null
      }
    | null
  const admin = await getAdminById(adminId)

  await notifyTenantTicketReply({
    organizationId: result.ticket.organization_id,
    ownerId: result.ticket.owner_id,
    tenantId: result.ticket.tenant_id,
    tenantEmail: tenant?.email ?? null,
    tenantName: tenant?.full_name ?? 'Tenant',
    subject: result.ticket.subject,
    senderName: admin?.full_name ?? admin?.email ?? 'Prophives Operations',
    senderRoleLabel: 'Admin',
    propertyName: tenant?.properties?.property_name ?? null,
    unitNumber: tenant?.properties?.unit_number ?? null,
    message: parsed.message,
  })

  await createAuditLog({
    organization_id: result.ticket.organization_id,
    actor_id: adminId,
    actor_role: 'admin',
    action: 'ticket.reply_posted',
    entity_type: 'support_ticket_message',
    entity_id: result.message.id,
    metadata: {
      ticket_id: result.ticket.id,
      message_type: result.message.message_type,
    },
  })

  response.status(201).json({ ok: true, message: result.message })
})

export const patchAdminTicket = asyncHandler(async (request: Request, response: Response) => {
  const adminId = requireAdminId(request)
  const ticketId = readPathId(request, 'id')
  const parsed = updateSupportTicketStatusSchema.parse(request.body)

  const ticket = await updateTicketStatusAsAdmin({
    ticketId,
    adminId,
    status: parsed.status,
    closingMessage: parsed.closing_message,
  })

  if (!ticket) {
    throw new AppError('Ticket not found', 404)
  }

  const tenant = ticket.tenants as
    | {
        id: string
        full_name: string
        email?: string | null
        properties?: { property_name?: string | null; unit_number?: string | null } | null
      }
    | null
  const admin = await getAdminById(adminId)

  if (parsed.status === 'closed') {
    await notifyTenantTicketClosed({
      organizationId: ticket.organization_id,
      ownerId: ticket.owner_id,
      tenantId: ticket.tenant_id,
      tenantEmail: tenant?.email ?? null,
      tenantName: tenant?.full_name ?? 'Tenant',
      subject: ticket.subject,
      senderName: admin?.full_name ?? admin?.email ?? 'Prophives Operations',
      senderRoleLabel: 'Admin',
      propertyName: tenant?.properties?.property_name ?? null,
      unitNumber: tenant?.properties?.unit_number ?? null,
      closingMessage: parsed.closing_message ?? null,
    })
  } else {
    await notifyTenantTicketStatusUpdated({
      organizationId: ticket.organization_id,
      ownerId: ticket.owner_id,
      tenantId: ticket.tenant_id,
      tenantEmail: tenant?.email ?? null,
      tenantName: tenant?.full_name ?? 'Tenant',
      subject: ticket.subject,
      senderName: admin?.full_name ?? admin?.email ?? 'Prophives Operations',
      senderRoleLabel: 'Admin',
      status: parsed.status,
    })
  }

  await createAuditLog({
    organization_id: ticket.organization_id,
    actor_id: adminId,
    actor_role: 'admin',
    action: 'ticket.status_updated',
    entity_type: 'support_ticket',
    entity_id: ticket.id,
    metadata: {
      status: parsed.status,
      closing_message_present: Boolean(parsed.closing_message),
    },
  })

  response.json({ ok: true, ticket })
})

export const postAdminTelegramMaintenanceCleanup = asyncHandler(async (request: Request, response: Response) => {
  const adminId = requireAdminId(request)
  const parsed = adminTelegramMaintenanceSchema.parse(request.body ?? {})
  const result = await cleanupTelegramArtifacts({
    onboardingCodeMaxAgeHours: parsed.onboarding_code_max_age_hours,
    deliveryLogMaxAgeDays: parsed.delivery_log_max_age_days,
  })

  await createAuditLog({
    actor_id: adminId,
    actor_role: 'admin',
    action: 'telegram.maintenance_cleanup',
    entity_type: 'telegram_artifact',
    metadata: result,
  })

  response.json({
    ok: true,
    result,
  })
})

export const getAdminContactMessages = asyncHandler(async (request: Request, response: Response) => {
  const parsed = adminContactMessageListQuerySchema.parse(request.query)
  const listed = await listAdminContactMessages(parsed)
  response.json({
    ok: true,
    items: listed.items,
    pagination: paginationPayload(parsed.page, parsed.page_size, listed.total),
    sort: {
      sort_by: parsed.sort_by,
      sort_order: parsed.sort_order,
    },
    search: parsed.search ?? '',
  })
})

export const getAdminAnalytics = asyncHandler(async (request: Request, response: Response) => {
  const parsed = adminAnalyticsListQuerySchema.parse(request.query)
  const listed = await listAdminAnalytics(parsed)
  response.json({
    ok: true,
    items: listed.items,
    summary: listed.summary,
    pagination: paginationPayload(parsed.page, parsed.page_size, listed.total),
    sort: {
      sort_by: parsed.sort_by,
      sort_order: parsed.sort_order,
    },
    search: parsed.search ?? '',
    days: parsed.days,
  })
})

export const getAdminSystemHealth = asyncHandler(async (_request: Request, response: Response) => {
  const health = await getSystemHealthMetrics()
  response.json({
    ok: true,
    health,
  })
})

export const getAdminAiStatus = asyncHandler(async (_request: Request, response: Response) => {
  const status = await getAdminAiStatusSummary()
  response.json({
    ok: true,
    status,
  })
})

export const getAdminAutomationHealth = asyncHandler(async (_request: Request, response: Response) => {
  const health = await getAutomationHealth()
  response.json({
    ok: true,
    health,
  })
})

export const getAdminAutomationRuns = asyncHandler(async (request: Request, response: Response) => {
  const parsed = adminAutomationRunsQuerySchema.parse(request.query)
  const listed = await listAutomationRuns(parsed)

  response.json({
    ok: true,
    items: listed.items,
    pagination: paginationPayload(parsed.page, parsed.page_size, listed.total),
    filters: {
      flow_name: parsed.flow_name ?? null,
      status: parsed.status ?? null,
      organization_id: parsed.organization_id ?? null,
    },
  })
})

export const getAdminAutomationJobs = asyncHandler(async (request: Request, response: Response) => {
  const parsed = adminAutomationJobsQuerySchema.parse(request.query)
  const listed = await listQueuedAutomationJobs(parsed)

  response.json({
    ok: true,
    items: listed.items,
    pagination: paginationPayload(parsed.page, parsed.page_size, listed.total),
    filters: {
      job_type: parsed.job_type ?? null,
      lifecycle_status: parsed.lifecycle_status ?? null,
      organization_id: parsed.organization_id ?? null,
    },
  })
})

export const getAdminAutomationErrors = asyncHandler(async (request: Request, response: Response) => {
  const parsed = adminAutomationErrorsQuerySchema.parse(request.query)
  const listed = await listAutomationErrors(parsed)

  response.json({
    ok: true,
    items: listed.items,
    pagination: paginationPayload(parsed.page, parsed.page_size, listed.total),
    filters: {
      flow_name: parsed.flow_name ?? null,
      organization_id: parsed.organization_id ?? null,
    },
  })
})

export const getAdminAutomationCompliance = asyncHandler(async (request: Request, response: Response) => {
  const parsed = adminAutomationComplianceQuerySchema.parse(request.query)

  const compliance = await getAdminComplianceOverview({
    organizationId: parsed.organization_id,
  })

  response.json({
    ok: true,
    compliance,
  })
})

export const getAdminAutomationPortfolioVisibility = asyncHandler(async (request: Request, response: Response) => {
  const parsed = adminAutomationPortfolioVisibilityQuerySchema.parse(request.query)
  const portfolioVisibility = await getAdminPortfolioVisibilityOverview({
    organizationId: parsed.organization_id,
  })

  response.json({
    ok: true,
    portfolio_visibility: portfolioVisibility,
  })
})

export const getAdminAutomationCashFlow = asyncHandler(async (request: Request, response: Response) => {
  const parsed = adminAutomationCashFlowQuerySchema.parse(request.query)
  const cashFlow = await getAdminCashFlowOverview({
    organizationId: parsed.organization_id,
  })

  response.json({
    ok: true,
    cash_flow: cashFlow,
  })
})

export const getAdminAutomationVacancyCampaigns = asyncHandler(async (request: Request, response: Response) => {
  const parsed = adminAutomationVacancyCampaignQuerySchema.parse(request.query)
  const vacancy = await getAdminVacancyCampaignOverview({
    organizationId: parsed.organization_id,
  })

  response.json({
    ok: true,
    vacancy,
  })
})

export const getAdminAutomationScreening = asyncHandler(async (request: Request, response: Response) => {
  const parsed = adminScreeningListQuerySchema.parse(request.query)
  const screening = await getAdminScreeningOverview({
    organizationId: parsed.organization_id,
    page: parsed.page,
    pageSize: parsed.page_size,
    recommendationCategory: parsed.recommendation_category,
    finalDisposition: parsed.final_disposition,
  })

  response.json({
    ok: true,
    screening,
  })
})

export const getAdminAutomationConditionReports = asyncHandler(async (request: Request, response: Response) => {
  const parsed = adminAutomationConditionReportsQuerySchema.parse(request.query)
  const condition_reports = await getAdminConditionReportOverview({
    organizationId: parsed.organization_id,
    page: parsed.page,
    pageSize: parsed.page_size,
    reportType: parsed.report_type,
  })

  response.json({
    ok: true,
    condition_reports,
  })
})

export const postAdminScreeningApplicant = asyncHandler(async (request: Request, response: Response) => {
  const adminId = requireAdminId(request)
  const parsed = adminCreateScreeningApplicantSchema.parse(request.body ?? {})
  const applicant = await createScreeningApplicant({
    organizationId: parsed.organization_id,
    ownerId: parsed.owner_id ?? undefined,
    actorRole: 'admin',
    actorAdminId: adminId,
    payload: {
      property_id: parsed.property_id,
      vacancy_campaign_id: parsed.vacancy_campaign_id,
      vacancy_application_id: parsed.vacancy_application_id,
      enquiry_source: parsed.enquiry_source,
      source_reference: parsed.source_reference,
      applicant_name: parsed.applicant_name,
      email: parsed.email,
      phone: parsed.phone,
      employer: parsed.employer,
      monthly_salary: parsed.monthly_salary,
      current_residence: parsed.current_residence,
      reason_for_moving: parsed.reason_for_moving,
      number_of_occupants: parsed.number_of_occupants,
      desired_move_in_date: parsed.desired_move_in_date,
      target_rent_amount: parsed.target_rent_amount,
      identification_status: parsed.identification_status,
      employment_verification_status: parsed.employment_verification_status,
    },
  })

  await createAuditLog({
    organization_id: parsed.organization_id,
    actor_id: adminId,
    actor_role: 'admin',
    action: 'screening.applicant_created_admin',
    entity_type: 'screening_applicant',
    entity_id: applicant.id,
    metadata: {
      applicant_name: applicant.applicant_name,
      owner_id: applicant.owner_id,
      recommendation_category: applicant.recommendation_category,
    },
  })

  response.status(201).json({
    ok: true,
    applicant,
  })
})

export const getAdminOrganizations = asyncHandler(async (request: Request, response: Response) => {
  const parsed = adminOrganizationListQuerySchema.parse(request.query)
  const listed = await listAdminOrganizations(parsed)
  response.json({
    ok: true,
    items: listed.items,
    pagination: paginationPayload(parsed.page, parsed.page_size, listed.total),
    sort: {
      sort_by: parsed.sort_by,
      sort_order: parsed.sort_order,
    },
    search: parsed.search ?? '',
  })
})

export const getAdminOrganizationById = asyncHandler(async (request: Request, response: Response) => {
  const organizationId = readPathId(request, 'id')
  const detail = await getAdminOrganizationDetail(organizationId)
  if (!detail) {
    throw new AppError('Organization not found', 404)
  }

  response.json({
    ok: true,
    detail,
  })
})

export const getAdminBlogPosts = asyncHandler(async (request: Request, response: Response) => {
  const parsed = adminBlogListQuerySchema.parse(request.query)
  const listed = await listBlogPosts({
    ...parsed,
    include_unpublished: true,
  })

  response.json({
    ok: true,
    items: listed.items,
    pagination: paginationPayload(parsed.page, parsed.page_size, listed.total),
    sort: {
      sort_by: parsed.sort_by,
      sort_order: parsed.sort_order,
    },
    search: parsed.search ?? '',
  })
})

export const postAdminBlogPost = asyncHandler(async (request: Request, response: Response) => {
  const adminId = requireAdminId(request)
  const parsed = createBlogPostSchema.parse(request.body)

  const post = await createBlogPost(parsed)

  await trackAdminAnalyticsSafe({
    event_name: 'admin_blog_post_created',
    metadata: {
      admin_id: adminId,
      blog_post_id: post.id,
      slug: post.slug,
    },
  })

  response.status(201).json({
    ok: true,
    post,
  })
})

export const putAdminBlogPost = asyncHandler(async (request: Request, response: Response) => {
  const adminId = requireAdminId(request)
  const postId = readPathId(request, 'id')
  const parsed = updateBlogPostSchema.parse(request.body)

  if (Object.keys(parsed).length === 0) {
    throw new AppError('No blog post fields provided', 400)
  }

  const post = await updateBlogPost(postId, parsed)
  if (!post) {
    throw new AppError('Blog post not found', 404)
  }

  await trackAdminAnalyticsSafe({
    event_name: 'admin_blog_post_updated',
    metadata: {
      admin_id: adminId,
      blog_post_id: post.id,
      slug: post.slug,
    },
  })

  response.json({
    ok: true,
    post,
  })
})

export const deleteAdminBlogPostById = asyncHandler(async (request: Request, response: Response) => {
  const adminId = requireAdminId(request)
  const postId = readPathId(request, 'id')
  const deletedCount = await deleteBlogPost(postId)

  if (!deletedCount) {
    throw new AppError('Blog post not found', 404)
  }

  await trackAdminAnalyticsSafe({
    event_name: 'admin_blog_post_deleted',
    metadata: {
      admin_id: adminId,
      blog_post_id: postId,
    },
  })

  response.json({
    ok: true,
  })
})
