import { Router } from 'express'

import {
  adminMe,
  deleteAdminBlogPostById,
  getAdminAnalytics,
  getAdminAiStatus,
  getAdminAutomationErrors,
  getAdminAutomationHealth,
  getAdminAutomationRuns,
  getAdminBlogPosts,
  getAdminContactMessages,
  getAdminDashboard,
  getAdminOrganizationById,
  getAdminOrganizations,
  getAdminOwners,
  getAdminProperties,
  getAdminSystemHealth,
  getAdminTenants,
  getAdminTickets,
  loginAdmin,
  postAdminBlogPost,
  putAdminBlogPost,
} from '../controllers/adminController.js'
import { requireAdminAuth } from '../middleware/adminAuth.js'

export function createAdminRouter() {
  const router = Router()

  router.post('/login', loginAdmin)

  router.use(requireAdminAuth)

  router.get('/me', adminMe)
  router.get('/dashboard-summary', getAdminDashboard)
  router.get('/owners', getAdminOwners)
  router.get('/organizations', getAdminOrganizations)
  router.get('/organizations/:id', getAdminOrganizationById)
  router.get('/tenants', getAdminTenants)
  router.get('/properties', getAdminProperties)
  router.get('/tickets', getAdminTickets)
  router.get('/contact-messages', getAdminContactMessages)
  router.get('/analytics', getAdminAnalytics)
  router.get('/ai-status', getAdminAiStatus)
  router.get('/automations/health', getAdminAutomationHealth)
  router.get('/automations/runs', getAdminAutomationRuns)
  router.get('/automations/errors', getAdminAutomationErrors)
  router.get('/system-health', getAdminSystemHealth)

  router.get('/blog', getAdminBlogPosts)
  router.post('/blog', postAdminBlogPost)
  router.put('/blog/:id', putAdminBlogPost)
  router.delete('/blog/:id', deleteAdminBlogPostById)

  return router
}
