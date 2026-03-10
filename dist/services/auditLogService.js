import { AppError } from '../lib/errors.js';
import { supabaseAdmin } from '../lib/supabase.js';
function throwIfError(error, message) {
    if (error) {
        throw new AppError(message, 500, error.message);
    }
}
export async function createAuditLog(input) {
    const { data, error } = await supabaseAdmin
        .from('audit_logs')
        .insert({
        organization_id: input.organization_id ?? null,
        actor_id: input.actor_id,
        actor_role: input.actor_role,
        action: input.action,
        entity_type: input.entity_type,
        entity_id: input.entity_id ?? null,
        metadata: input.metadata ?? {},
    })
        .select('id, created_at')
        .single();
    throwIfError(error, 'Failed to create audit log');
    return data;
}
//# sourceMappingURL=auditLogService.js.map