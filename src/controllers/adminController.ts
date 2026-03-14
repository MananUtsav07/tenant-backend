import bcrypt from 'bcryptjs'
import type { Request, Response } from 'express'

import { AppError, asyncHandler } from '../lib/errors.js'
import { signAdminToken } from '../lib/jwt.js'
import { getAdminAiStatusSummary } from '../services/ai/aiConfigService.js'
import { getAutomationHealth, listAutomationErrors, listAutomationRuns } from '../services/automationEngineService.js'
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
import { adminAutomationErrorsQuerySchema, adminAutomationRunsQuerySchema } from '../validations/automationSchemas.js'

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
