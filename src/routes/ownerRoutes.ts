import { Router } from 'express'

import {
  createOwnerProperty,
  getOwnerBrokerList,
  createOwnerTenant,
  getOwnerNotificationList,
  getOwnerNotificationPreferencesController,
  getOwnerContractorDirectoryController,
  getOwnerAutomationActivityController,
  getOwnerAutomationCashFlowController,
  getOwnerAutomationComplianceController,
  getOwnerAutomationPortfolioVisibilityController,
  getOwnerAutomationVacancyController,
  getOwnerAutomationSettingsController,
  getOwnerRentPaymentApprovals,
  getOwnerProperties,
  getOwnerConditionReportDetailController,
  getOwnerSummary,
  getOwnerTelegramDeliveryLogsController,
  getOwnerScreeningApplicantDetailController,
  getOwnerScreeningOverviewController,
  getOwnerTelegramOnboarding,
  getOwnerTenantById,
  getOwnerTenantConditionReportsController,
  getOwnerTicketById,
  getOwnerTicketMaintenanceWorkflowController,
  getOwnerTenants,
  getOwnerTicketList,
  getOwnerVacancyCampaignDetailController,
  getOwnerVacancyCampaignListController,
  markAllOwnerNotificationsRead,
  markOwnerNotificationRead,
  patchOwnerProperty,
  patchOwnerBroker,
  patchOwnerConditionReportRoomController,
  patchOwnerRentPaymentApproval,
  patchOwnerContractorDirectoryController,
  patchOwnerVacancyCampaignDraftController,
  patchOwnerScreeningApplicantController,
  patchOwnerScreeningApplicantDecisionController,
  patchOwnerTicketMaintenanceAssignmentController,
  patchOwnerTenant,
  patchOwnerTicket,
  postOwnerContractorDirectoryController,
  postOwnerTicketMaintenanceQuoteApprovalController,
  postOwnerTicketMaintenanceQuoteController,
  postOwnerTicketMaintenanceQuoteRequestsController,
  postOwnerTicketMaintenanceTriageController,
  postOwnerPropertyVacancyCampaignController,
  postOwnerAutomationMaintenanceCostController,
  postOwnerConditionReportConfirmController,
  postOwnerConditionReportMediaController,
  postOwnerScreeningApplicantController,
  postOwnerScreeningApplicantDocumentController,
  postOwnerScreeningApplicantRefreshController,
  postOwnerVacancyCampaignApplicationController,
  postOwnerVacancyCampaignApproveController,
  postOwnerVacancyCampaignLeadController,
  postOwnerVacancyCampaignViewingController,
  postOwnerTicketReply,
  postOwnerAutomationCashFlowGenerateController,
  postOwnerTelegramDisconnect,
  putOwnerNotificationPreferencesController,
  postOwnerTenantConditionReportController,
  processReminders,
  postOwnerBroker,
  putOwnerAutomationSettingsController,
  removeOwnerProperty,
  removeOwnerBroker,
  removeOwnerTenant,
} from '../controllers/ownerController.js'
import { requireOwnerAuth } from '../middleware/ownerAuth.js'

export function createOwnerRouter() {
  const router = Router()

  router.use(requireOwnerAuth)

  router.post('/properties', createOwnerProperty)
  router.get('/properties', getOwnerProperties)
  router.patch('/properties/:id', patchOwnerProperty)
  router.delete('/properties/:id', removeOwnerProperty)
  router.post('/properties/:id/vacancy-campaigns', postOwnerPropertyVacancyCampaignController)

  router.get('/brokers', getOwnerBrokerList)
  router.post('/brokers', postOwnerBroker)
  router.patch('/brokers/:brokerId', patchOwnerBroker)
  router.delete('/brokers/:brokerId', removeOwnerBroker)

  router.post('/tenants', createOwnerTenant)
  router.get('/tenants', getOwnerTenants)
  router.get('/tenants/:id', getOwnerTenantById)
  router.get('/tenants/:id/condition-reports', getOwnerTenantConditionReportsController)
  router.post('/tenants/:id/condition-reports', postOwnerTenantConditionReportController)
  router.patch('/tenants/:id', patchOwnerTenant)
  router.delete('/tenants/:id', removeOwnerTenant)

  router.get('/condition-reports/:reportId', getOwnerConditionReportDetailController)
  router.patch('/condition-reports/:reportId/rooms/:roomEntryId', patchOwnerConditionReportRoomController)
  router.post('/condition-reports/:reportId/media', postOwnerConditionReportMediaController)
  router.post('/condition-reports/:reportId/confirm', postOwnerConditionReportConfirmController)

  router.get('/tickets', getOwnerTicketList)
  router.get('/tickets/:id', getOwnerTicketById)
  router.post('/tickets/:id/replies', postOwnerTicketReply)
  router.patch('/tickets/:id', patchOwnerTicket)
  router.get('/tickets/:id/maintenance-workflow', getOwnerTicketMaintenanceWorkflowController)
  router.post('/tickets/:id/maintenance-workflow/triage', postOwnerTicketMaintenanceTriageController)
  router.post('/tickets/:id/maintenance-workflow/request-quotes', postOwnerTicketMaintenanceQuoteRequestsController)
  router.post('/tickets/:id/maintenance-workflow/quotes', postOwnerTicketMaintenanceQuoteController)
  router.post('/tickets/:id/maintenance-workflow/quotes/:quoteId/approve', postOwnerTicketMaintenanceQuoteApprovalController)
  router.patch('/tickets/:id/maintenance-workflow/assignment', patchOwnerTicketMaintenanceAssignmentController)

  router.get('/contractors', getOwnerContractorDirectoryController)
  router.post('/contractors', postOwnerContractorDirectoryController)
  router.patch('/contractors/:contractorId', patchOwnerContractorDirectoryController)

  router.get('/notifications', getOwnerNotificationList)
  router.get('/notifications/preferences', getOwnerNotificationPreferencesController)
  router.put('/notifications/preferences', putOwnerNotificationPreferencesController)
  router.patch('/notifications/read-all', markAllOwnerNotificationsRead)
  router.patch('/notifications/:id/read', markOwnerNotificationRead)
  router.get('/telegram/onboarding', getOwnerTelegramOnboarding)
  router.post('/telegram/disconnect', postOwnerTelegramDisconnect)
  router.get('/telegram/delivery-logs', getOwnerTelegramDeliveryLogsController)

  router.get('/dashboard-summary', getOwnerSummary)
  router.get('/rent-payment-approvals', getOwnerRentPaymentApprovals)
  router.patch('/rent-payment-approvals/:id', patchOwnerRentPaymentApproval)
  router.post('/process-reminders', processReminders)
  router.get('/automation/settings', getOwnerAutomationSettingsController)
  router.put('/automation/settings', putOwnerAutomationSettingsController)
  router.get('/automation/activity', getOwnerAutomationActivityController)
  router.get('/automation/compliance', getOwnerAutomationComplianceController)
  router.get('/automation/portfolio-visibility', getOwnerAutomationPortfolioVisibilityController)
  router.get('/automation/cash-flow', getOwnerAutomationCashFlowController)
  router.get('/automation/vacancy', getOwnerAutomationVacancyController)
  router.post('/automation/cash-flow/generate', postOwnerAutomationCashFlowGenerateController)
  router.post('/automation/cash-flow/maintenance-costs', postOwnerAutomationMaintenanceCostController)
  router.get('/screening/applicants', getOwnerScreeningOverviewController)
  router.post('/screening/applicants', postOwnerScreeningApplicantController)
  router.get('/screening/applicants/:applicantId', getOwnerScreeningApplicantDetailController)
  router.patch('/screening/applicants/:applicantId', patchOwnerScreeningApplicantController)
  router.post('/screening/applicants/:applicantId/documents', postOwnerScreeningApplicantDocumentController)
  router.patch('/screening/applicants/:applicantId/decision', patchOwnerScreeningApplicantDecisionController)
  router.post('/screening/applicants/:applicantId/refresh', postOwnerScreeningApplicantRefreshController)
  router.get('/vacancy-campaigns', getOwnerVacancyCampaignListController)
  router.get('/vacancy-campaigns/:campaignId', getOwnerVacancyCampaignDetailController)
  router.patch('/vacancy-campaigns/:campaignId/draft', patchOwnerVacancyCampaignDraftController)
  router.post('/vacancy-campaigns/:campaignId/approve', postOwnerVacancyCampaignApproveController)
  router.post('/vacancy-campaigns/:campaignId/leads', postOwnerVacancyCampaignLeadController)
  router.post('/vacancy-campaigns/:campaignId/viewings', postOwnerVacancyCampaignViewingController)
  router.post('/vacancy-campaigns/:campaignId/applications', postOwnerVacancyCampaignApplicationController)

  return router
}
