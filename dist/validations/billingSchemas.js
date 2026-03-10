import { z } from 'zod';
export const planCodeSchema = z.enum(['starter', 'professional', 'enterprise']);
export const createCheckoutSessionSchema = z.object({
    plan_code: planCodeSchema,
    success_url: z.string().url().optional(),
    cancel_url: z.string().url().optional(),
});
export const createPortalSessionSchema = z.object({
    return_url: z.string().url().optional(),
});
//# sourceMappingURL=billingSchemas.js.map