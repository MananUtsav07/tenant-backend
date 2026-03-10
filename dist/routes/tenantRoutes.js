import { Router } from 'express';
import { getTenantDashboardSummary, getTenantOwnerContact, getTenantProperty, getTenantTickets, postTenantTicket, } from '../controllers/tenantController.js';
import { requireTenantAuth } from '../middleware/tenantAuth.js';
export function createTenantRouter() {
    const router = Router();
    router.use(requireTenantAuth);
    router.get('/dashboard-summary', getTenantDashboardSummary);
    router.get('/property', getTenantProperty);
    router.get('/tickets', getTenantTickets);
    router.post('/tickets', postTenantTicket);
    router.get('/owner-contact', getTenantOwnerContact);
    return router;
}
//# sourceMappingURL=tenantRoutes.js.map