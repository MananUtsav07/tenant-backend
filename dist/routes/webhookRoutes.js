import { raw, Router } from 'express';
import { postStripeWebhook } from '../controllers/billingController.js';
export function createWebhookRouter() {
    const router = Router();
    router.post('/stripe', raw({ type: 'application/json' }), postStripeWebhook);
    return router;
}
//# sourceMappingURL=webhookRoutes.js.map