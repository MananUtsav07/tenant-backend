export function nowIso() {
    return new Date().toISOString();
}
export function addDays(base, days) {
    const next = new Date(base);
    next.setUTCDate(next.getUTCDate() + days);
    return next;
}
export function toUtcDateWithDay(base, dayOfMonth) {
    const year = base.getUTCFullYear();
    const month = base.getUTCMonth();
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const safeDay = Math.max(1, Math.min(dayOfMonth, lastDay));
    return new Date(Date.UTC(year, month, safeDay, 9, 0, 0, 0));
}
export function nextDueDateFromDay(paymentDueDay, now = new Date()) {
    const candidate = toUtcDateWithDay(now, paymentDueDay);
    if (candidate >= now) {
        return candidate;
    }
    const nextMonthBase = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 9, 0, 0, 0));
    return toUtcDateWithDay(nextMonthBase, paymentDueDay);
}
//# sourceMappingURL=date.js.map