import { createRequire } from 'node:module'

import { env } from '../../config/env.js'

const openAiApiKey = env.OPENAI_API_KEY?.trim() ?? ''

type OpenAiConstructor = new (options: { apiKey: string }) => unknown
type OpenAiModule = OpenAiConstructor | { default?: OpenAiConstructor }

const require = createRequire(import.meta.url)

function resolveOpenAiConstructor(): OpenAiConstructor | null {
  try {
    const loaded = require('openai') as OpenAiModule

    if (typeof loaded === 'function') {
      return loaded
    }

    if (loaded && typeof loaded.default === 'function') {
      return loaded.default
    }

    return null
  } catch {
    return null
  }
}

const OpenAI = resolveOpenAiConstructor()

export const aiClient = openAiApiKey && OpenAI ? new OpenAI({ apiKey: openAiApiKey }) : null

export function isAiConfigured(): boolean {
  return openAiApiKey.length > 0
}
