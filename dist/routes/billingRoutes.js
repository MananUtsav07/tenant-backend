import { Router } from 'express';
import { getOwnerBilling, postCreateCheckoutSession, postCreatePortalSession } from '../controllers/billingController.js';
import { requireOwnerAuth } from '../middleware/ownerAuth.js';
export function createBillingRouter() {
    const router = Router();
    router.use(requireOwnerAuth);
    router.get('/subscription', getOwnerBilling);
    router.post('/create-checkout-session', postCreateCheckoutSession);
    router.post('/portal-session', postCreatePortalSession);
    return router;
}
//# sourceMappingURL=billingRoutes.js.map