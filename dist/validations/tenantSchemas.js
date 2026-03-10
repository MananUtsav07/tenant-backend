import { z } from 'zod';
export const createTenantTicketSchema = z.object({
    subject: z.string().trim().min(2).max(200),
    message: z.string().trim().min(5).max(3000),
});
//# sourceMappingURL=tenantSchemas.js.map