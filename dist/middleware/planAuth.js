import { getOrganizationCurrentPlanCode, planSatisfies } from '../services/billingService.js';
export function requirePlan(requiredPlan) {
    return async (request, response, next) => {
        const organizationId = request.owner?.organizationId ?? request.auth?.organizationId ?? null;
        if (!organizationId) {
            response.status(401).json({
                ok: false,
                error: 'Owner authentication required',
            });
            return;
        }
        try {
            const currentPlan = await getOrganizationCurrentPlanCode(organizationId);
            if (!planSatisfies(requiredPlan, currentPlan)) {
                response.status(403).json({
                    ok: false,
                    error: `This action requires the ${requiredPlan} plan`,
                    details: {
                        required_plan: requiredPlan,
                        current_plan: currentPlan,
                    },
                });
                return;
            }
            next();
        }
        catch (error) {
            next(error);
        }
    };
}
//# sourceMappingURL=planAuth.js.map