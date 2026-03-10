const buckets = new Map();
function getClientIp(request) {
    const xForwardedFor = request.header('x-forwarded-for');
    if (xForwardedFor) {
        return xForwardedFor.split(',')[0]?.trim() ?? 'unknown';
    }
    return request.ip || request.socket.remoteAddress || 'unknown';
}
export function createRateLimiter(options) {
    return (request, response, next) => {
        const now = Date.now();
        const key = `${options.keyPrefix}:${getClientIp(request)}`;
        const bucket = buckets.get(key);
        if (!bucket || now > bucket.resetAt) {
            buckets.set(key, {
                count: 1,
                resetAt: now + options.windowMs,
            });
            next();
            return;
        }
        if (bucket.count >= options.max) {
            const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
            response.setHeader('Retry-After', String(retryAfterSeconds));
            response.status(429).json({
                ok: false,
                error: 'Too many requests. Please retry shortly.',
            });
            return;
        }
        bucket.count += 1;
        next();
    };
}
//# sourceMappingURL=rateLimit.js.map