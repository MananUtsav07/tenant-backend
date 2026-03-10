import crypto from 'node:crypto';
export function generateTenantAccessId() {
    const suffix = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `TEN-${suffix}`;
}
//# sourceMappingURL=ids.js.map