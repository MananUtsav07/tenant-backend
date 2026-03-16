import bcrypt from 'bcryptjs'
import type { Request, Response } from 'express'

import { AppError, asyncHandler } from '../lib/errors.js'
import { requireOrganizationContext } from '../middleware/organizationContext.js'
import { createAuditLog } from '../services/auditLogService.js'
import { createBroker, deleteBroker, getBrokerById, listBrokers, updateBroker } from '../services/brokerService.js'
import {
  notifyTenantAccountProvisioned,
  notifyTenantMaintenanceCompleted,
  notifyTenantMaintenanceScheduled,
  notifyTenantTicketClosed,
  notifyTenantTicketReply,
  notifyTenantTicketStatusUpdated,
} from '../services/notificationService.js'
import { getOwnerNotificationPreferences, updateOwnerNotificationPreferences } from '../services/ownerNotificationPreferenceService.js'
import { createMaintenanceCostEntry, getOwnerCashFlowOverview, runCashFlowRefresh } from '../services/automation/cashFlowReportService.js'
import { enqueueCashFlowRefreshJob, enqueueMaintenanceFollowUpJob } from '../services/automationEngineService.js'
import { getOwnerComplianceOverview } from '../services/complianceService.js'
import {
  approveContractorQuote,
  createContractorDirectoryEntry,
  getOwnerMaintenanceWorkflowOverview,
  initializeMaintenanceWorkflow,
  listContractorDirectory,
  recordContractorQuote,
  requestMaintenanceQuotes,
  updateContractorDirectoryEntry,
  updateMaintenanceAssignment,
} from '../services/maintenanceWorkflowService.js'
import { getOwnerAutomationSettings, listOwnerAutomationActivity, updateOwnerAutomationSettings } from '../services/ownerAutomationService.js'
import { getOwnerPortfolioVisibilityOverview } from '../services/portfolioVisibilityService.js'
import {
  createProperty,
  createTenant,
  deleteProperty,
  deleteTenant,
  getOwnerDashboardSummary,
  getOwnerById,
  getPropertyForOwner,
  getTenantDetailAggregate,
  getTenantForOwner,
  listOwnerNotifications,
  listOwnerTickets,
  listProperties,
  listTenants,
  markAllNotificationsRead,
  markNotificationRead,
  updateProperty,
  updateTenant,
} from '../services/ownerService.js'
import { processOwnerReminders } from '../services/reminderService.js'
import { listOwnerAwaitingRentPaymentApprovals, reviewOwnerRentPaymentApproval } from '../services/rentPaymentService.js'
import { getOwnerTicketThread, replyToTicketAsOwner, updateTicketStatusAsOwner } from '../services/ticketThreadService.js'
import {
  addVacancyApplication,
  addVacancyLead,
  addVacancyViewing,
  approveVacancyCampaign,
  createOrRefreshVacancyCampaign,
  getOwnerVacancyCampaignDetail,
  getOwnerVacancyCampaignOverview,
  updateVacancyCampaignDraft,
} from '../services/vacancyWorkflowService.js'
import {
  addScreeningDocument,
  createScreeningApplicant,
  getOwnerScreeningOverview,
  getScreeningApplicantDetail,
  refreshScreeningRecommendation,
  updateScreeningApplicant,
  updateScreeningDecision,
} from '../services/screeningWorkflowService.js'
import {
  addConditionReportMediaReference,
  confirmConditionReportAsOwner,
  createOwnerConditionReport,
  ensureMoveInConditionReport,
  getOwnerConditionReportDetail,
  getOwnerTenantConditionReports,
  updateConditionReportRoomEntry,
} from '../services/conditionReportService.js'
import {
  createOwnerTelegramConnectUrl,
  disconnectOwnerTelegram,
  getOwnerTelegramConnectionState,
  getTelegramBotUsername,
} from '../services/telegramOnboardingService.js'
import { listOwnerTelegramDeliveryLogs } from '../services/telegramService.js'
import { createTenantSchema, createPropertySchema, updatePropertySchema, updateTenantSchema } from '../validations/ownerSchemas.js'
import { ownerNotificationPreferencesUpdateSchema, ownerTelegramDeliveryLogsQuerySchema } from '../validations/notificationSchemas.js'
import { ownerReviewRentPaymentSchema } from '../validations/rentPaymentSchemas.js'
import {
  ownerAutomationActivityQuerySchema,
  ownerAutomationCashFlowGenerateSchema,
  ownerAutomationMaintenanceCostCreateSchema,
  ownerAutomationSettingsUpdateSchema,
} from '../validations/automationSchemas.js'
import {
  approveContractorQuoteSchema,
  createContractorSchema,
  recordContractorQuoteSchema,
  requestMaintenanceQuotesSchema,
  triageMaintenanceWorkflowSchema,
  updateContractorSchema,
  updateMaintenanceAssignmentSchema,
} from '../validations/maintenanceWorkflowSchemas.js'
import { createTicketReplySchema, updateSupportTicketStatusSchema } from '../validations/ticketSchemas.js'
import {
  approveVacancyCampaignSchema,
  createVacancyApplicationSchema,
  createVacancyLeadSchema,
  createVacancyViewingSchema,
  updateVacancyCampaignDraftSchema,
  upsertVacancyCampaignSchema,
} from '../validations/vacancyWorkflowSchemas.js'
import {
  addScreeningDocumentSchema,
  createScreeningApplicantSchema,
  screeningListQuerySchema,
  updateScreeningApplicantSchema,
  updateScreeningDecisionSchema,
} from '../validations/screeningSchemas.js'
import {
  addConditionReportMediaSchema,
  confirmConditionReportSchema,
  ownerCreateConditionReportSchema,
  updateConditionReportRoomSchema,
} from '../validations/conditionReportSchemas.js'
import { createBrokerSchema, updateBrokerSchema } from '../validations/brokerSchemas.js'

function requireOwnerContext(request: Request): { ownerId: string; organizationId: string } {
  const ownerId = request.owner?.ownerId
  const organizationId = request.owner?.organizationId ?? request.auth?.organizationId ?? null
  if (!ownerId) {
    throw new AppError('Owner authentication required', 401)
  }
  if (!organizationId) {
    throw new AppError('Organization context is required', 401)
  }

  return { ownerId, organizationId }
}

function readPathId(request: Request, paramName: string): string {
  const value = request.params[paramName]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(`Invalid route parameter: ${paramName}`, 400)
  }
  return value
}

export const createOwnerProperty = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const parsed = createPropertySchema.parse(request.body)
  const property = await createProperty({
    ownerId,
    organizationId,
    input: parsed,
  })
  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'property.created',
    entity_type: 'property',
    entity_id: property.id,
    metadata: { property_name: property.property_name },
  })
  response.status(201).json({ ok: true, property })
})

export const getOwnerProperties = asyncHandler(async (request: Request, response: Response) => {
  const organizationId = requireOrganizationContext(request)
  const properties = await listProperties(organizationId)
  response.json({ ok: true, properties })
})

export const patchOwnerProperty = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const propertyId = readPathId(request, 'id')
  const parsed = updatePropertySchema.parse(request.body)

  if (Object.keys(parsed).length === 0) {
    throw new AppError('No property fields provided', 400)
  }

  const property = await updateProperty(organizationId, propertyId, parsed)
  if (!property) {
    throw new AppError('Property not found in your organization', 404)
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'property.updated',
    entity_type: 'property',
    entity_id: property.id,
    metadata: parsed,
  })

  response.json({ ok: true, property })
})

export const removeOwnerProperty = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const propertyId = readPathId(request, 'id')
  const deletedCount = await deleteProperty(organizationId, propertyId)

  if (!deletedCount) {
    throw new AppError('Property not found in your organization', 404)
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'property.deleted',
    entity_type: 'property',
    entity_id: propertyId,
  })

  response.json({ ok: true })
})

export const postOwnerPropertyVacancyCampaignController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const propertyId = readPathId(request, 'id')
  const parsed = upsertVacancyCampaignSchema.parse(request.body ?? {})

  const property = await getPropertyForOwner(organizationId, propertyId)
  if (!property) {
    throw new AppError('Property not found in your organization', 404)
  }

  const result = await createOrRefreshVacancyCampaign({
    organizationId,
    ownerId,
    propertyId,
    sourceType: parsed.source_type,
    expectedVacancyDate: parsed.expected_vacancy_date,
    vacancyState: parsed.vacancy_state,
    triggerReference: `owner_property:${propertyId}`,
    triggerNotes: parsed.trigger_notes ?? null,
    sendOwnerMessage: false,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: result.created ? 'vacancy_campaign.created' : 'vacancy_campaign.refreshed',
    entity_type: 'vacancy_campaign',
    entity_id: result.overview.id,
    metadata: {
      property_id: propertyId,
      expected_vacancy_date: parsed.expected_vacancy_date,
      source_type: parsed.source_type,
      vacancy_state: parsed.vacancy_state ?? null,
    },
  })

  response.status(result.created ? 201 : 200).json({
    ok: true,
    campaign: result.overview,
    created: result.created,
  })
})

export const getOwnerVacancyCampaignListController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const vacancy = await getOwnerVacancyCampaignOverview(ownerId, organizationId)

  response.json({
    ok: true,
    vacancy,
  })
})

export const getOwnerVacancyCampaignDetailController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const campaignId = readPathId(request, 'campaignId')
  const campaign = await getOwnerVacancyCampaignDetail(ownerId, organizationId, campaignId)

  if (!campaign) {
    throw new AppError('Vacancy campaign not found in your organization', 404)
  }

  response.json({
    ok: true,
    campaign,
  })
})

export const patchOwnerVacancyCampaignDraftController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const campaignId = readPathId(request, 'campaignId')
  const parsed = updateVacancyCampaignDraftSchema.parse(request.body ?? {})

  if (Object.keys(parsed).length === 0) {
    throw new AppError('No vacancy campaign draft fields provided', 400)
  }

  const campaign = await updateVacancyCampaignDraft({
    organizationId,
    ownerId,
    campaignId,
    patch: parsed,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'vacancy_campaign.updated',
    entity_type: 'vacancy_campaign',
    entity_id: campaign.id,
    metadata: parsed,
  })

  response.json({
    ok: true,
    campaign,
  })
})

export const postOwnerVacancyCampaignApproveController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const campaignId = readPathId(request, 'campaignId')
  const parsed = approveVacancyCampaignSchema.parse(request.body ?? {})
  const campaign = await approveVacancyCampaign({
    organizationId,
    ownerId,
    campaignId,
    patch: parsed,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'vacancy_campaign.approved',
    entity_type: 'vacancy_campaign',
    entity_id: campaign.id,
    metadata: {
      listing_sync_status: campaign.listing_sync_status,
      listing_provider: campaign.listing_provider,
      listing_url: campaign.listing_url,
    },
  })

  response.status(201).json({
    ok: true,
    campaign,
  })
})

export const postOwnerVacancyCampaignLeadController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const campaignId = readPathId(request, 'campaignId')
  const parsed = createVacancyLeadSchema.parse(request.body ?? {})
  const campaign = await addVacancyLead({
    organizationId,
    ownerId,
    campaignId,
    payload: parsed,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'vacancy_campaign.lead_recorded',
    entity_type: 'vacancy_campaign',
    entity_id: campaign.id,
    metadata: {
      lead_name: parsed.full_name,
      source: parsed.source,
      status: parsed.status,
    },
  })

  response.status(201).json({
    ok: true,
    campaign,
  })
})

export const postOwnerVacancyCampaignViewingController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const campaignId = readPathId(request, 'campaignId')
  const parsed = createVacancyViewingSchema.parse(request.body ?? {})
  const campaign = await addVacancyViewing({
    organizationId,
    ownerId,
    campaignId,
    payload: parsed,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'vacancy_campaign.viewing_recorded',
    entity_type: 'vacancy_campaign',
    entity_id: campaign.id,
    metadata: {
      scheduled_start_at: parsed.scheduled_start_at,
      booking_status: parsed.booking_status,
      lead_id: parsed.lead_id ?? null,
    },
  })

  response.status(201).json({
    ok: true,
    campaign,
  })
})

export const postOwnerVacancyCampaignApplicationController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const campaignId = readPathId(request, 'campaignId')
  const parsed = createVacancyApplicationSchema.parse(request.body ?? {})
  const campaign = await addVacancyApplication({
    organizationId,
    ownerId,
    campaignId,
    payload: parsed,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'vacancy_campaign.application_recorded',
    entity_type: 'vacancy_campaign',
    entity_id: campaign.id,
    metadata: {
      applicant_name: parsed.applicant_name,
      status: parsed.status,
      lead_id: parsed.lead_id ?? null,
    },
  })

  response.status(201).json({
    ok: true,
    campaign,
  })
})

export const getOwnerScreeningOverviewController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const parsed = screeningListQuerySchema.parse(request.query ?? {})
  const screening = await getOwnerScreeningOverview({
    ownerId,
    organizationId,
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

export const getOwnerScreeningApplicantDetailController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const applicantId = readPathId(request, 'applicantId')
  const applicant = await getScreeningApplicantDetail({
    applicantId,
    organizationId,
    ownerId,
  })

  if (!applicant) {
    throw new AppError('Screening applicant not found in your organization', 404)
  }

  response.json({
    ok: true,
    applicant,
  })
})

export const postOwnerScreeningApplicantController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const parsed = createScreeningApplicantSchema.parse(request.body ?? {})
  const applicant = await createScreeningApplicant({
    organizationId,
    ownerId,
    actorRole: 'owner',
    actorOwnerId: ownerId,
    payload: parsed,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'screening.applicant_created',
    entity_type: 'screening_applicant',
    entity_id: applicant.id,
    metadata: {
      applicant_name: applicant.applicant_name,
      property_id: applicant.property_id,
      enquiry_source: applicant.enquiry_source,
      recommendation_category: applicant.recommendation_category,
    },
  })

  response.status(201).json({
    ok: true,
    applicant,
  })
})

export const patchOwnerScreeningApplicantController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const applicantId = readPathId(request, 'applicantId')
  const parsed = updateScreeningApplicantSchema.parse(request.body ?? {})

  if (Object.keys(parsed).length === 0) {
    throw new AppError('No applicant fields provided', 400)
  }

  const applicant = await updateScreeningApplicant({
    organizationId,
    ownerId,
    applicantId,
    patch: parsed,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'screening.applicant_updated',
    entity_type: 'screening_applicant',
    entity_id: applicant.id,
    metadata: parsed,
  })

  response.json({
    ok: true,
    applicant,
  })
})

export const postOwnerScreeningApplicantDocumentController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const applicantId = readPathId(request, 'applicantId')
  const parsed = addScreeningDocumentSchema.parse(request.body ?? {})
  const applicant = await addScreeningDocument({
    organizationId,
    ownerId,
    applicantId,
    payload: parsed,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'screening.document_added',
    entity_type: 'screening_applicant',
    entity_id: applicant.id,
    metadata: {
      document_type: parsed.document_type,
      file_name: parsed.file_name,
      verification_status: parsed.verification_status ?? 'submitted',
    },
  })

  response.status(201).json({
    ok: true,
    applicant,
  })
})

export const patchOwnerScreeningApplicantDecisionController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const applicantId = readPathId(request, 'applicantId')
  const parsed = updateScreeningDecisionSchema.parse(request.body ?? {})

  if (Object.keys(parsed).length === 0) {
    throw new AppError('No screening decision fields provided', 400)
  }

  const applicant = await updateScreeningDecision({
    organizationId,
    ownerId,
    applicantId,
    patch: parsed,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'screening.decision_updated',
    entity_type: 'screening_applicant',
    entity_id: applicant.id,
    metadata: parsed,
  })

  response.json({
    ok: true,
    applicant,
  })
})

export const postOwnerScreeningApplicantRefreshController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const applicantId = readPathId(request, 'applicantId')
  const applicant = await refreshScreeningRecommendation({
    applicantId,
    organizationId,
    ownerId,
    actorRole: 'owner',
    actorOwnerId: ownerId,
  })

  if (!applicant) {
    throw new AppError('Screening applicant not found in your organization', 404)
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'screening.recommendation_refreshed',
    entity_type: 'screening_applicant',
    entity_id: applicant.id,
    metadata: {
      recommendation_category: applicant.recommendation_category,
      affordability_ratio: applicant.affordability_ratio,
    },
  })

  response.json({
    ok: true,
    applicant,
  })
})

export const createOwnerTenant = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const parsed = createTenantSchema.parse(request.body)

  const property = await getPropertyForOwner(organizationId, parsed.property_id)
  if (!property) {
    throw new AppError('Property not found in your organization', 404)
  }
  if (parsed.broker_id) {
    const broker = await getBrokerById({
      organizationId,
      brokerId: parsed.broker_id,
    })
    if (!broker) {
      throw new AppError('Broker not found in your organization', 404)
    }
  }

  const passwordHash = await bcrypt.hash(parsed.password, 10)
  const owner = await getOwnerById(ownerId, organizationId)

  const tenant = await createTenant({
    ownerId,
    organizationId,
    input: {
      property_id: parsed.property_id,
      broker_id: parsed.broker_id ?? null,
      full_name: parsed.full_name,
      email: parsed.email,
      phone: parsed.phone,
      password_hash: passwordHash,
      lease_start_date: parsed.lease_start_date,
      lease_end_date: parsed.lease_end_date,
      monthly_rent: parsed.monthly_rent,
      payment_due_day: parsed.payment_due_day,
      payment_status: parsed.payment_status,
      status: parsed.status,
    },
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'tenant.created',
    entity_type: 'tenant',
    entity_id: tenant.id,
    metadata: { full_name: tenant.full_name, property_id: tenant.property_id },
  })

  void notifyTenantAccountProvisioned({
    organizationId,
    ownerId,
    tenantId: tenant.id,
    tenantName: tenant.full_name,
    tenantEmail: tenant.email ?? null,
    tenantAccessId: tenant.tenant_access_id,
    temporaryPassword: parsed.password,
    propertyName: property.property_name ?? null,
    unitNumber: property.unit_number ?? null,
  }).catch((error) => {
    console.error('[createOwnerTenant] tenant onboarding email failed', {
      tenantId: tenant.id,
      tenantAccessId: tenant.tenant_access_id,
      ownerEmail: owner?.email ?? request.owner?.email ?? null,
      error,
    })
  })

  if (tenant.status === 'active' || Boolean(tenant.lease_start_date)) {
    void ensureMoveInConditionReport({
      organizationId,
      ownerId,
      propertyId: tenant.property_id,
      tenantId: tenant.id,
      triggerSource: 'tenant_created',
      triggerReference: `tenant:${tenant.id}`,
      actorRole: 'owner',
      actorOwnerId: ownerId,
    }).catch((error) => {
      console.error('[createOwnerTenant] move-in condition report initialization failed', {
        tenantId: tenant.id,
        organizationId,
        error,
      })
    })
  }

  response.status(201).json({ ok: true, tenant })
})

export const getOwnerTenants = asyncHandler(async (request: Request, response: Response) => {
  const organizationId = requireOrganizationContext(request)
  const tenants = await listTenants(organizationId)
  response.json({ ok: true, tenants })
})

export const getOwnerBrokerList = asyncHandler(async (request: Request, response: Response) => {
  const organizationId = requireOrganizationContext(request)
  const brokers = await listBrokers(organizationId)
  response.json({ ok: true, brokers })
})

export const postOwnerBroker = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const parsed = createBrokerSchema.parse(request.body)
  const broker = await createBroker({
    organizationId,
    ownerId,
    ...parsed,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'broker.created',
    entity_type: 'broker',
    entity_id: broker.id,
    metadata: {
      full_name: broker.full_name,
      email: broker.email,
      is_active: broker.is_active,
    },
  })

  response.status(201).json({ ok: true, broker })
})

export const patchOwnerBroker = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const brokerId = readPathId(request, 'brokerId')
  const parsed = updateBrokerSchema.parse(request.body ?? {})
  if (Object.keys(parsed).length === 0) {
    throw new AppError('No broker fields provided', 400)
  }

  const broker = await updateBroker({
    organizationId,
    brokerId,
    patch: parsed,
  })
  if (!broker) {
    throw new AppError('Broker not found in your organization', 404)
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'broker.updated',
    entity_type: 'broker',
    entity_id: broker.id,
    metadata: parsed,
  })

  response.json({ ok: true, broker })
})

export const removeOwnerBroker = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const brokerId = readPathId(request, 'brokerId')
  const deletedCount = await deleteBroker({
    organizationId,
    brokerId,
  })
  if (!deletedCount) {
    throw new AppError('Broker not found in your organization', 404)
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'broker.deleted',
    entity_type: 'broker',
    entity_id: brokerId,
  })

  response.json({ ok: true })
})

export const getOwnerTenantById = asyncHandler(async (request: Request, response: Response) => {
  const organizationId = requireOrganizationContext(request)
  const tenantId = readPathId(request, 'id')

  const detail = await getTenantDetailAggregate(organizationId, tenantId)
  if (!detail) {
    throw new AppError('Tenant not found in your organization', 404)
  }

  response.json({ ok: true, ...detail })
})

export const getOwnerTenantConditionReportsController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const tenantId = readPathId(request, 'id')

  const condition_reports = await getOwnerTenantConditionReports({
    organizationId,
    ownerId,
    tenantId,
  })

  response.json({ ok: true, condition_reports })
})

export const postOwnerTenantConditionReportController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const tenantId = readPathId(request, 'id')
  const parsed = ownerCreateConditionReportSchema.parse(request.body)

  const report = await createOwnerConditionReport({
    organizationId,
    ownerId,
    tenantId,
    reportType: parsed.report_type,
    vacancyCampaignId: parsed.vacancy_campaign_id ?? null,
    triggerReference: parsed.trigger_reference ?? null,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'condition_report.created',
    entity_type: 'condition_report',
    entity_id: report?.id ?? tenantId,
    metadata: {
      tenant_id: tenantId,
      report_type: parsed.report_type,
      vacancy_campaign_id: parsed.vacancy_campaign_id ?? null,
    },
  })

  response.status(201).json({ ok: true, report })
})

export const getOwnerConditionReportDetailController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const reportId = readPathId(request, 'reportId')

  const report = await getOwnerConditionReportDetail({
    organizationId,
    ownerId,
    reportId,
  })

  if (!report) {
    throw new AppError('Condition report not found in your organization', 404)
  }

  response.json({ ok: true, report })
})

export const patchOwnerConditionReportRoomController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const reportId = readPathId(request, 'reportId')
  const roomEntryId = readPathId(request, 'roomEntryId')
  const parsed = updateConditionReportRoomSchema.parse(request.body)

  const report = await updateConditionReportRoomEntry({
    organizationId,
    ownerId,
    reportId,
    roomEntryId,
    patch: parsed,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'condition_report.room_updated',
    entity_type: 'condition_report_room_entry',
    entity_id: roomEntryId,
    metadata: {
      condition_report_id: reportId,
      condition_rating: parsed.condition_rating,
    },
  })

  response.json({ ok: true, report })
})

export const postOwnerConditionReportMediaController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const reportId = readPathId(request, 'reportId')
  const parsed = addConditionReportMediaSchema.parse(request.body)

  const report = await addConditionReportMediaReference({
    organizationId,
    reportId,
    roomEntryId: parsed.room_entry_id,
    actorRole: 'owner',
    actorOwnerId: ownerId,
    payload: parsed,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'condition_report.media_added',
    entity_type: 'condition_report_media',
    entity_id: reportId,
    metadata: {
      room_entry_id: parsed.room_entry_id,
      media_kind: parsed.media_kind,
    },
  })

  response.status(201).json({ ok: true, report })
})

export const postOwnerConditionReportConfirmController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const reportId = readPathId(request, 'reportId')
  const parsed = confirmConditionReportSchema.parse(request.body)

  const report = await confirmConditionReportAsOwner({
    organizationId,
    ownerId,
    reportId,
    status: parsed.status,
    note: parsed.note ?? null,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'condition_report.confirmed',
    entity_type: 'condition_report',
    entity_id: reportId,
    metadata: {
      confirmation_status: parsed.status,
    },
  })

  response.json({ ok: true, report })
})

export const patchOwnerTenant = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const tenantId = readPathId(request, 'id')
  const parsed = updateTenantSchema.parse(request.body)

  if (Object.keys(parsed).length === 0) {
    throw new AppError('No tenant fields provided', 400)
  }
  if (parsed.broker_id) {
    const broker = await getBrokerById({
      organizationId,
      brokerId: parsed.broker_id,
    })
    if (!broker) {
      throw new AppError('Broker not found in your organization', 404)
    }
  }

  const previousTenant = await getTenantForOwner(organizationId, tenantId)
  const previousTenantState = previousTenant as
    | {
        status?: string
        lease_start_date?: string | null
        property_id?: string | null
      }
    | null
  const patch: Record<string, unknown> = { ...parsed }

  if (typeof parsed.password === 'string') {
    patch.password_hash = await bcrypt.hash(parsed.password, 10)
    delete patch.password
  }

  const tenant = await updateTenant(organizationId, tenantId, patch)
  if (!tenant) {
    throw new AppError('Tenant not found in your organization', 404)
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'tenant.updated',
    entity_type: 'tenant',
    entity_id: tenant.id,
    metadata: parsed,
  })

  const shouldOpenMoveInReport =
    !!tenant.property_id &&
    (tenant.status === 'active' || Boolean(tenant.lease_start_date)) &&
    (!previousTenantState ||
      previousTenantState.status !== tenant.status ||
      previousTenantState.lease_start_date !== tenant.lease_start_date ||
      previousTenantState.property_id !== tenant.property_id)

  if (shouldOpenMoveInReport && tenant.property_id) {
    void ensureMoveInConditionReport({
      organizationId,
      ownerId,
      propertyId: tenant.property_id,
      tenantId: tenant.id,
      triggerSource: 'tenant_activated',
      triggerReference: `tenant:${tenant.id}`,
      actorRole: 'owner',
      actorOwnerId: ownerId,
    }).catch((error) => {
      console.error('[patchOwnerTenant] move-in condition report initialization failed', {
        tenantId: tenant.id,
        organizationId,
        error,
      })
    })
  }

  response.json({ ok: true, tenant })
})

export const removeOwnerTenant = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const tenantId = readPathId(request, 'id')

  const deletedCount = await deleteTenant(organizationId, tenantId)
  if (!deletedCount) {
    throw new AppError('Tenant not found in your organization', 404)
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'tenant.deleted',
    entity_type: 'tenant',
    entity_id: tenantId,
  })

  response.json({ ok: true })
})

export const getOwnerTicketList = asyncHandler(async (request: Request, response: Response) => {
  const organizationId = requireOrganizationContext(request)
  const tickets = await listOwnerTickets(organizationId)
  response.json({ ok: true, tickets })
})

export const getOwnerTicketById = asyncHandler(async (request: Request, response: Response) => {
  const { organizationId } = requireOwnerContext(request)
  const ticketId = readPathId(request, 'id')
  const thread = await getOwnerTicketThread({
    ticketId,
    organizationId,
  })

  if (!thread) {
    throw new AppError('Ticket not found in your organization', 404)
  }

  response.json({ ok: true, thread })
})

export const postOwnerTicketReply = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const ticketId = readPathId(request, 'id')
  const parsed = createTicketReplySchema.parse(request.body)

  const result = await replyToTicketAsOwner({
    ticketId,
    ownerId,
    organizationId,
    message: parsed.message,
  })

  const tenant = result.ticket.tenants as
    | {
        id: string
        full_name: string
        tenant_access_id: string
        email?: string | null
        properties?: { property_name?: string | null; unit_number?: string | null } | null
      }
    | null
  const ownerContact = result.ticket.owners as
    | {
        full_name?: string | null
        company_name?: string | null
        email?: string | null
      }
    | null
  const senderName =
    ownerContact?.full_name?.trim() || ownerContact?.company_name?.trim() || ownerContact?.email?.trim() || 'Property Team'

  await notifyTenantTicketReply({
    organizationId,
    ownerId,
    tenantId: result.ticket.tenant_id,
    tenantEmail: tenant?.email ?? null,
    tenantName: tenant?.full_name ?? 'Tenant',
    subject: result.ticket.subject,
    senderName,
    senderRoleLabel: 'Owner',
    propertyName: tenant?.properties?.property_name ?? null,
    unitNumber: tenant?.properties?.unit_number ?? null,
    message: parsed.message,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
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

export const patchOwnerTicket = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const ticketId = readPathId(request, 'id')
  const parsed = updateSupportTicketStatusSchema.parse(request.body)

  const ticket = await updateTicketStatusAsOwner({
    organizationId,
    ownerId,
    ticketId,
    status: parsed.status,
    closingMessage: parsed.closing_message,
  })
  if (!ticket) {
    throw new AppError('Ticket not found in your organization', 404)
  }

  const tenant = ticket.tenants as
    | {
        id: string
        full_name: string
        tenant_access_id: string
        email?: string | null
        properties?: { property_name?: string | null; unit_number?: string | null } | null
      }
    | null
  const ownerContact = ticket.owners as
    | {
        full_name?: string | null
        company_name?: string | null
        email?: string | null
      }
    | null
  const senderName =
    ownerContact?.full_name?.trim() || ownerContact?.company_name?.trim() || ownerContact?.email?.trim() || 'Property Team'

  if (parsed.status === 'closed') {
    await notifyTenantTicketClosed({
      organizationId,
      ownerId,
      tenantId: ticket.tenant_id,
      tenantEmail: tenant?.email ?? null,
      tenantName: tenant?.full_name ?? 'Tenant',
      subject: ticket.subject,
      senderName,
      senderRoleLabel: 'Owner',
      propertyName: tenant?.properties?.property_name ?? null,
      unitNumber: tenant?.properties?.unit_number ?? null,
      closingMessage: parsed.closing_message ?? null,
    })
  } else {
    await notifyTenantTicketStatusUpdated({
      organizationId,
      ownerId,
      tenantId: ticket.tenant_id,
      tenantEmail: tenant?.email ?? null,
      tenantName: tenant?.full_name ?? 'Tenant',
      subject: ticket.subject,
      senderName,
      senderRoleLabel: 'Owner',
      status: parsed.status,
    })
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
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

export const getOwnerNotificationPreferencesController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const preferences = await getOwnerNotificationPreferences(ownerId, organizationId)

  response.json({
    ok: true,
    preferences,
  })
})

export const putOwnerNotificationPreferencesController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const parsed = ownerNotificationPreferencesUpdateSchema.parse(request.body ?? {})
  if (Object.keys(parsed).length === 0) {
    throw new AppError('No notification preference fields provided', 400)
  }

  const preferences = await updateOwnerNotificationPreferences(ownerId, organizationId, parsed)

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'notification.preferences_updated',
    entity_type: 'owner_notification_preferences',
    entity_id: preferences.id,
    metadata: parsed,
  })

  response.json({
    ok: true,
    preferences,
  })
})

export const getOwnerContractorDirectoryController = asyncHandler(async (request: Request, response: Response) => {
  const { organizationId } = requireOwnerContext(request)
  const contractors = await listContractorDirectory({ organizationId })

  response.json({
    ok: true,
    contractors,
  })
})

export const postOwnerContractorDirectoryController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const parsed = createContractorSchema.parse(request.body ?? {})

  const contractor = await createContractorDirectoryEntry({
    organizationId,
    ownerId,
    companyName: parsed.company_name,
    contactName: parsed.contact_name ?? null,
    email: parsed.email ?? null,
    phone: parsed.phone ?? null,
    whatsapp: parsed.whatsapp ?? null,
    notes: parsed.notes ?? null,
    specialties: parsed.specialties,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'maintenance.contractor_created',
    entity_type: 'contractor_directory',
    entity_id: contractor.id,
    metadata: {
      specialties: contractor.specialties,
      company_name: contractor.company_name,
    },
  })

  response.status(201).json({
    ok: true,
    contractor,
  })
})

export const patchOwnerContractorDirectoryController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const contractorId = readPathId(request, 'contractorId')
  const parsed = updateContractorSchema.parse(request.body ?? {})

  const contractor = await updateContractorDirectoryEntry({
    organizationId,
    contractorId,
    patch: parsed,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'maintenance.contractor_updated',
    entity_type: 'contractor_directory',
    entity_id: contractor.id,
    metadata: parsed,
  })

  response.json({
    ok: true,
    contractor,
  })
})

export const getOwnerTelegramDeliveryLogsController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const parsed = ownerTelegramDeliveryLogsQuerySchema.parse(request.query)
  const listed = await listOwnerTelegramDeliveryLogs({
    organizationId,
    ownerId,
    page: parsed.page,
    pageSize: parsed.page_size,
  })

  response.json({
    ok: true,
    items: listed.items,
    pagination: {
      page: parsed.page,
      page_size: parsed.page_size,
      total: listed.total,
      total_pages: Math.max(1, Math.ceil(listed.total / parsed.page_size)),
    },
  })
})

export const getOwnerTicketMaintenanceWorkflowController = asyncHandler(async (request: Request, response: Response) => {
  const { organizationId } = requireOwnerContext(request)
  const ticketId = readPathId(request, 'id')
  const maintenance = await getOwnerMaintenanceWorkflowOverview({
    ticketId,
    organizationId,
  })

  if (!maintenance) {
    throw new AppError('Ticket not found in your organization', 404)
  }

  response.json({
    ok: true,
    maintenance,
  })
})

export const postOwnerTicketMaintenanceTriageController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const ticketId = readPathId(request, 'id')
  const parsed = triageMaintenanceWorkflowSchema.parse(request.body ?? {})

  const maintenance = await initializeMaintenanceWorkflow({
    ticketId,
    organizationId,
    ownerId,
    category: parsed.category,
    urgency: parsed.urgency,
    classificationNotes: parsed.classification_notes ?? null,
    manual: true,
  })

  if (!maintenance) {
    throw new AppError('Unable to start maintenance workflow for this ticket', 400)
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'maintenance.triaged',
    entity_type: 'maintenance_workflow',
    entity_id: maintenance.workflow?.id ?? ticketId,
    metadata: {
      ticket_id: ticketId,
      category: maintenance.workflow?.category ?? parsed.category ?? null,
      urgency: maintenance.workflow?.urgency ?? parsed.urgency ?? null,
    },
  })

  response.status(201).json({
    ok: true,
    maintenance,
  })
})

export const postOwnerTicketMaintenanceQuoteRequestsController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const ticketId = readPathId(request, 'id')
  const parsed = requestMaintenanceQuotesSchema.parse(request.body ?? {})

  const maintenance = await requestMaintenanceQuotes({
    ticketId,
    organizationId,
    ownerId,
    contractorIds: parsed.contractor_ids,
    requestMessage: parsed.request_message ?? null,
    expiresAt: parsed.expires_at ?? null,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'maintenance.quote_requests_sent',
    entity_type: 'maintenance_workflow',
    entity_id: maintenance?.workflow?.id ?? ticketId,
    metadata: {
      ticket_id: ticketId,
      contractor_ids: parsed.contractor_ids ?? null,
      requested_count: maintenance?.workflow?.quote_requests.length ?? 0,
    },
  })

  response.status(201).json({
    ok: true,
    maintenance,
  })
})

export const postOwnerTicketMaintenanceQuoteController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const ticketId = readPathId(request, 'id')
  const parsed = recordContractorQuoteSchema.parse(request.body ?? {})

  const maintenance = await recordContractorQuote({
    ticketId,
    organizationId,
    ownerId,
    contractorId: parsed.contractor_id,
    quoteRequestId: parsed.quote_request_id ?? null,
    amount: parsed.amount,
    currencyCode: parsed.currency_code ?? null,
    scopeOfWork: parsed.scope_of_work,
    availabilityNote: parsed.availability_note ?? null,
    estimatedStartAt: parsed.estimated_start_at ?? null,
    estimatedCompletionAt: parsed.estimated_completion_at ?? null,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'maintenance.quote_recorded',
    entity_type: 'contractor_quote',
    entity_id: maintenance?.workflow?.quotes[0]?.id ?? ticketId,
    metadata: {
      ticket_id: ticketId,
      contractor_id: parsed.contractor_id,
      amount: parsed.amount,
    },
  })

  response.status(201).json({
    ok: true,
    maintenance,
  })
})

export const postOwnerTicketMaintenanceQuoteApprovalController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const ticketId = readPathId(request, 'id')
  const quoteId = readPathId(request, 'quoteId')
  const parsed = approveContractorQuoteSchema.parse(request.body ?? {})

  const maintenance = await approveContractorQuote({
    ticketId,
    organizationId,
    ownerId,
    quoteId,
    appointmentStartAt: parsed.appointment_start_at ?? null,
    appointmentEndAt: parsed.appointment_end_at ?? null,
    appointmentNotes: parsed.appointment_notes ?? null,
  })

  if (!maintenance?.workflow?.assignment) {
    throw new AppError('Failed to create maintenance assignment', 500)
  }

  if (maintenance.workflow.assignment.booking_status === 'scheduled') {
    await notifyTenantMaintenanceScheduled({
      tenantId: maintenance.ticket.tenant_id,
      tenantEmail: maintenance.ticket.tenants?.email ?? null,
      tenantName: maintenance.ticket.tenants?.full_name ?? 'Tenant',
      subject: maintenance.ticket.subject,
      propertyName: maintenance.ticket.tenants?.properties?.property_name ?? null,
      unitNumber: maintenance.ticket.tenants?.properties?.unit_number ?? null,
      contractorName: maintenance.workflow.assignment.contractor?.company_name ?? 'Assigned contractor',
      appointmentStartAt: maintenance.workflow.assignment.appointment_start_at ?? '',
      appointmentEndAt: maintenance.workflow.assignment.appointment_end_at ?? null,
      appointmentNotes: maintenance.workflow.assignment.appointment_notes ?? null,
    })
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'maintenance.quote_approved',
    entity_type: 'maintenance_assignment',
    entity_id: maintenance.workflow.assignment.id,
    metadata: {
      ticket_id: ticketId,
      quote_id: quoteId,
      booking_status: maintenance.workflow.assignment.booking_status,
    },
  })

  response.status(201).json({
    ok: true,
    maintenance,
  })
})

export const patchOwnerTicketMaintenanceAssignmentController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const ticketId = readPathId(request, 'id')
  const parsed = updateMaintenanceAssignmentSchema.parse(request.body ?? {})

  const result = await updateMaintenanceAssignment({
    ticketId,
    organizationId,
    ownerId,
    bookingStatus: parsed.booking_status,
    appointmentStartAt: parsed.appointment_start_at ?? null,
    appointmentEndAt: parsed.appointment_end_at ?? null,
    appointmentNotes: parsed.appointment_notes ?? null,
    completionNotes: parsed.completion_notes ?? null,
  })

  if (!result.overview?.workflow?.assignment) {
    throw new AppError('Maintenance assignment not found after update', 404)
  }

  if (parsed.booking_status === 'scheduled' && result.overview.workflow.assignment.appointment_start_at) {
    await notifyTenantMaintenanceScheduled({
      tenantId: result.overview.ticket.tenant_id,
      tenantEmail: result.overview.ticket.tenants?.email ?? null,
      tenantName: result.overview.ticket.tenants?.full_name ?? 'Tenant',
      subject: result.overview.ticket.subject,
      propertyName: result.overview.ticket.tenants?.properties?.property_name ?? null,
      unitNumber: result.overview.ticket.tenants?.properties?.unit_number ?? null,
      contractorName: result.overview.workflow.assignment.contractor?.company_name ?? 'Assigned contractor',
      appointmentStartAt: result.overview.workflow.assignment.appointment_start_at,
      appointmentEndAt: result.overview.workflow.assignment.appointment_end_at ?? null,
      appointmentNotes: result.overview.workflow.assignment.appointment_notes ?? null,
    })
  }

  if (parsed.booking_status === 'completed') {
    await notifyTenantMaintenanceCompleted({
      tenantId: result.overview.ticket.tenant_id,
      tenantEmail: result.overview.ticket.tenants?.email ?? null,
      tenantName: result.overview.ticket.tenants?.full_name ?? 'Tenant',
      subject: result.overview.ticket.subject,
      propertyName: result.overview.ticket.tenants?.properties?.property_name ?? null,
      unitNumber: result.overview.ticket.tenants?.properties?.unit_number ?? null,
      contractorName: result.overview.workflow.assignment.contractor?.company_name ?? 'Assigned contractor',
      completionNotes: result.overview.workflow.assignment.completion_notes ?? null,
    })

    if (result.shouldEnqueueFollowUp && result.followUpDueAt) {
      await enqueueMaintenanceFollowUpJob({
        organizationId,
        ownerId,
        workflowId: result.overview.workflow.id,
        ticketId: result.overview.ticket.id,
        runAt: result.followUpDueAt,
      })
    }
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'maintenance.assignment_updated',
    entity_type: 'maintenance_assignment',
    entity_id: result.overview.workflow.assignment.id,
    metadata: {
      ticket_id: ticketId,
      booking_status: parsed.booking_status,
    },
  })

  response.json({
    ok: true,
    maintenance: result.overview,
  })
})

export const getOwnerNotificationList = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const notifications = await listOwnerNotifications(organizationId, ownerId)
  response.json({ ok: true, notifications })
})

export const markOwnerNotificationRead = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const notificationId = readPathId(request, 'id')

  const notification = await markNotificationRead(organizationId, ownerId, notificationId)
  if (!notification) {
    throw new AppError('Notification not found in your organization', 404)
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'notification.mark_read',
    entity_type: 'owner_notification',
    entity_id: notification.id,
  })

  response.json({ ok: true, notification })
})

export const markAllOwnerNotificationsRead = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const updatedCount = await markAllNotificationsRead(organizationId, ownerId)

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'notification.mark_all_read',
    entity_type: 'owner_notification',
    metadata: { updated_count: updatedCount },
  })

  response.json({ ok: true, updated_count: updatedCount })
})

export const getOwnerSummary = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const summary = await getOwnerDashboardSummary(organizationId, ownerId)
  response.json({ ok: true, summary })
})

export const getOwnerRentPaymentApprovals = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const approvals = await listOwnerAwaitingRentPaymentApprovals({
    ownerId,
    organizationId,
  })

  response.json({
    ok: true,
    approvals,
  })
})

export const patchOwnerRentPaymentApproval = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const approvalId = readPathId(request, 'id')
  const parsed = ownerReviewRentPaymentSchema.parse(request.body)

  const approval = await reviewOwnerRentPaymentApproval({
    approvalId,
    ownerId,
    organizationId,
    action: parsed.action,
    rejectionReason: parsed.rejection_reason,
  })
  if (!approval) {
    throw new AppError('Failed to review rent payment approval', 500)
  }

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: parsed.action === 'approve' ? 'rent_payment.approved' : 'rent_payment.rejected',
    entity_type: 'rent_payment_approval',
    entity_id: approval.id,
    metadata: {
      status: approval.status,
      tenant_id: approval.tenant_id,
      cycle_year: approval.cycle_year,
      cycle_month: approval.cycle_month,
      rejection_reason: parsed.rejection_reason?.trim() || null,
    },
  })

  response.json({
    ok: true,
    approval,
  })
})

export const processReminders = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const result = await processOwnerReminders({
    ownerId,
    organizationId,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'reminders.processed',
    entity_type: 'rent_reminder',
    metadata: result,
  })

  response.json({ ok: true, result })
})

export const getOwnerTelegramOnboarding = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const state = await getOwnerTelegramConnectionState({
    ownerId,
    organizationId,
  })
  const botUsername = getTelegramBotUsername()
  const connectUrl = botUsername
    ? await createOwnerTelegramConnectUrl({
        ownerId,
        organizationId,
      })
    : null

  response.json({
    ok: true,
    onboarding: {
      connected: state.connected,
      bot_username: botUsername,
      connect_url: connectUrl,
      linked_chat: state.linked_chat,
    },
  })
})

export const postOwnerTelegramDisconnect = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const disconnected = await disconnectOwnerTelegram({
    ownerId,
    organizationId,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'telegram.disconnected',
    entity_type: 'telegram_chat_link',
    metadata: { disconnected },
  })

  response.json({
    ok: true,
    disconnected,
  })
})

export const getOwnerAutomationSettingsController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const settings = await getOwnerAutomationSettings(ownerId, organizationId)

  response.json({
    ok: true,
    settings,
  })
})

export const putOwnerAutomationSettingsController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const parsed = ownerAutomationSettingsUpdateSchema.parse(request.body ?? {})

  if (Object.keys(parsed).length === 0) {
    throw new AppError('No automation settings provided', 400)
  }

  const settings = await updateOwnerAutomationSettings(ownerId, organizationId, parsed)
  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'automation.settings_updated',
    entity_type: 'owner_automation_settings',
    entity_id: settings.id,
    metadata: parsed,
  })

  response.json({
    ok: true,
    settings,
  })
})

export const getOwnerAutomationActivityController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const parsed = ownerAutomationActivityQuerySchema.parse(request.query)
  const listed = await listOwnerAutomationActivity({
    ownerId,
    organizationId,
    page: parsed.page,
    page_size: parsed.page_size,
  })

  response.json({
    ok: true,
    items: listed.items,
    pagination: {
      page: parsed.page,
      page_size: parsed.page_size,
      total: listed.total,
      total_pages: Math.max(1, Math.ceil(listed.total / parsed.page_size)),
    },
  })
})

export const getOwnerAutomationComplianceController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const compliance = await getOwnerComplianceOverview(ownerId, organizationId)

  response.json({
    ok: true,
    compliance,
  })
})

export const getOwnerAutomationPortfolioVisibilityController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const portfolio = await getOwnerPortfolioVisibilityOverview(ownerId, organizationId)

  response.json({
    ok: true,
    portfolio_visibility: portfolio,
  })
})

export const getOwnerAutomationCashFlowController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const cashFlow = await getOwnerCashFlowOverview(ownerId, organizationId)

  response.json({
    ok: true,
    cash_flow: cashFlow,
  })
})

export const getOwnerAutomationVacancyController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const vacancy = await getOwnerVacancyCampaignOverview(ownerId, organizationId)

  response.json({
    ok: true,
    vacancy,
  })
})

export const postOwnerAutomationCashFlowGenerateController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const parsed = ownerAutomationCashFlowGenerateSchema.parse(request.body ?? {})

  const result = await runCashFlowRefresh({
    ownerId,
    organizationId,
    scope: parsed.scope,
    year: parsed.year,
    month: parsed.month,
    triggerType: 'manual',
    allowAlerts: false,
    persist: true,
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'automation.cash_flow_generated',
    entity_type: 'cash_flow_report_snapshot',
    metadata: {
      scope: parsed.scope,
      year: parsed.year ?? null,
      month: parsed.month ?? null,
      snapshot_ids: result.cash_flow_snapshot_ids,
    },
  })

  response.status(201).json({
    ok: true,
    result,
  })
})

export const postOwnerAutomationMaintenanceCostController = asyncHandler(async (request: Request, response: Response) => {
  const { ownerId, organizationId } = requireOwnerContext(request)
  const parsed = ownerAutomationMaintenanceCostCreateSchema.parse(request.body ?? {})

  const property = await getPropertyForOwner(organizationId, parsed.property_id)
  if (!property) {
    throw new AppError('Property not found in your organization', 404)
  }

  const entry = await createMaintenanceCostEntry({
    organizationId,
    ownerId,
    propertyId: parsed.property_id,
    amount: parsed.amount,
    incurredOn: parsed.incurred_on,
    sourceType: parsed.source_type,
    vendorName: parsed.vendor_name ?? null,
    description: parsed.description ?? null,
    invoiceRef: parsed.invoice_ref ?? null,
    recordedByRole: 'owner',
    recordedByOwnerId: ownerId,
  })

  await enqueueCashFlowRefreshJob({
    organizationId,
    ownerId,
    sourceType: 'maintenance_cost_entry',
    sourceRef: entry.id,
    scope: 'current',
  })

  await createAuditLog({
    organization_id: organizationId,
    actor_id: ownerId,
    actor_role: 'owner',
    action: 'automation.maintenance_cost_recorded',
    entity_type: 'maintenance_cost_entry',
    entity_id: entry.id,
    metadata: {
      property_id: parsed.property_id,
      amount: parsed.amount,
      incurred_on: parsed.incurred_on,
      source_type: parsed.source_type,
    },
  })

  response.status(201).json({
    ok: true,
    entry,
  })
})
