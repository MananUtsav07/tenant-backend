export function respondValidationError(error, response) {
    return response.status(400).json({
        ok: false,
        error: 'Validation failed',
        issues: error.issues,
    });
}
//# sourceMappingURL=http.js.map