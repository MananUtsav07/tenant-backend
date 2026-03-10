import { AppError } from '../lib/errors.js';
import { supabaseAdmin } from '../lib/supabase.js';
function throwIfError(error, message) {
    if (error) {
        throw new AppError(message, 500, error.message);
    }
}
function escapeSearchTerm(term) {
    return term.replace(/[%_]/g, '').replaceAll(',', ' ').trim();
}
export async function createAnalyticsEvent(input) {
    const { data, error } = await supabaseAdmin
        .from('analytics_events')
        .insert({
        event_name: input.event_name,
        user_type: input.user_type,
        metadata: input.metadata ?? {},
    })
        .select('id, event_name, user_type, metadata, created_at')
        .single();
    throwIfError(error, 'Failed to create analytics event');
    if (!data) {
        throw new AppError('Failed to create analytics event', 500);
    }
    return data;
}
export async function listAnalyticsEvents(query) {
    const from = (query.page - 1) * query.page_size;
    const to = from + query.page_size - 1;
    let request = supabaseAdmin
        .from('analytics_events')
        .select('id, event_name, user_type, metadata, created_at', { count: 'exact' })
        .order(query.sort_by, { ascending: query.sort_order === 'asc' })
        .range(from, to);
    if (query.search && query.search.trim().length > 0) {
        const escaped = escapeSearchTerm(query.search);
        if (escaped.length > 0) {
            request = request.or(`event_name.ilike.%${escaped}%,user_type.ilike.%${escaped}%`);
        }
    }
    if (typeof query.days === 'number' && query.days > 0) {
        const since = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000).toISOString();
        request = request.gte('created_at', since);
    }
    const { data, error, count } = await request;
    throwIfError(error, 'Failed to list analytics events');
    return {
        items: data ?? [],
        total: count ?? 0,
    };
}
export async function summarizeAnalytics(days) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
        .from('analytics_events')
        .select('event_name, user_type, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1000);
    throwIfError(error, 'Failed to summarize analytics events');
    const byEvent = new Map();
    const byUserType = new Map();
    for (const event of data ?? []) {
        byEvent.set(event.event_name, (byEvent.get(event.event_name) ?? 0) + 1);
        byUserType.set(event.user_type, (byUserType.get(event.user_type) ?? 0) + 1);
    }
    return {
        total_events: (data ?? []).length,
        by_event: Array.from(byEvent.entries())
            .map(([event_name, count]) => ({ event_name, count }))
            .sort((a, b) => b.count - a.count),
        by_user_type: Array.from(byUserType.entries())
            .map(([user_type, count]) => ({ user_type, count }))
            .sort((a, b) => b.count - a.count),
    };
}
//# sourceMappingURL=analyticsService.js.map