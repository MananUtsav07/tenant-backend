export function withOrganizationScope<T extends { eq: (column: string, value: string) => T }>(query: T, organizationId: string) {
  return query.eq('organization_id', organizationId)
}
