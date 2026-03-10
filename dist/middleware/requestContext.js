import crypto from 'node:crypto';
export function requestContext(request, _response, next) {
    request.requestId = crypto.randomUUID();
    next();
}
//# sourceMappingURL=requestContext.js.map