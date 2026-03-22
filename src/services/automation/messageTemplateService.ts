import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../../lib/errors.js'
import { supabaseAdmin } from '../../lib/supabase.js'

export type AutomationTemplateChannel = 'email' | 'whatsapp' | 'in_app'

type MessageTemplateRow = {
  organization_id: string | null
  template_key: string
  channel: AutomationTemplateChannel
  subject: string | null
  body: string
}

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

function lookupVariable(context: Record<string, unknown>, path: string): string {
  const resolved = path.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[segment]
    }

    return undefined
  }, context)

  if (resolved === null || typeof resolved === 'undefined') {
    return ''
  }

  return String(resolved)
}

export function renderMessageTemplate(template: string, variables: Record<string, unknown>) {
  return template.replace(/{{\s*([a-zA-Z0-9_.-]+)\s*}}/g, (_fullMatch, token: string) => lookupVariable(variables, token))
}

export async function resolveAutomationMessageTemplate(input: {
  organizationId?: string | null
  templateKey: string
  channel: AutomationTemplateChannel
  fallbackBody: string
  fallbackSubject?: string | null
  variables?: Record<string, unknown>
}) {
  let query = supabaseAdmin
    .from('message_templates')
    .select('organization_id, template_key, channel, subject, body')
    .eq('template_key', input.templateKey)
    .eq('channel', input.channel)
    .eq('is_active', true)

  if (input.organizationId) {
    query = query.or(`organization_id.eq.${input.organizationId},organization_id.is.null`)
  } else {
    query = query.is('organization_id', null)
  }

  const { data, error } = await query

  throwIfError(error, 'Failed to resolve automation message template')

  const templates = (data ?? []) as MessageTemplateRow[]
  const selected =
    templates.find((template) => template.organization_id === (input.organizationId ?? null)) ??
    templates.find((template) => template.organization_id === null) ??
    null

  const variables = input.variables ?? {}

  return {
    subject: renderMessageTemplate(selected?.subject ?? input.fallbackSubject ?? '', variables) || null,
    body: renderMessageTemplate(selected?.body ?? input.fallbackBody, variables),
    source: selected ? (selected.organization_id ? 'organization' : 'global') : 'fallback',
  }
}
