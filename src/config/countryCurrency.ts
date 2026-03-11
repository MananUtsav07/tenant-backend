export const supportedCountryCodes = [
  'IN',
  'US',
  'GB',
  'AE',
  'CA',
  'AU',
  'SG',
  'DE',
  'FR',
  'SA',
  'NZ',
  'MY',
  'QA',
  'ZA',
  'JP',
] as const

export type SupportedCountryCode = (typeof supportedCountryCodes)[number]

export const countryCurrencyMap: Record<SupportedCountryCode, string> = {
  IN: 'INR',
  US: 'USD',
  GB: 'GBP',
  AE: 'AED',
  CA: 'CAD',
  AU: 'AUD',
  SG: 'SGD',
  DE: 'EUR',
  FR: 'EUR',
  SA: 'SAR',
  NZ: 'NZD',
  MY: 'MYR',
  QA: 'QAR',
  ZA: 'ZAR',
  JP: 'JPY',
}

export function normalizeCountryCode(countryCode: string): SupportedCountryCode | null {
  const normalized = countryCode.trim().toUpperCase()
  if (!normalized) {
    return null
  }

  if ((supportedCountryCodes as readonly string[]).includes(normalized)) {
    return normalized as SupportedCountryCode
  }

  return null
}

export function resolveCurrencyCode(countryCode: string): string {
  const normalizedCountryCode = normalizeCountryCode(countryCode)
  if (!normalizedCountryCode) {
    return countryCurrencyMap.IN
  }
  return countryCurrencyMap[normalizedCountryCode]
}
