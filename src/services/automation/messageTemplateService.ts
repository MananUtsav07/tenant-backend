import { prisma } from '../../lib/db.js'

export type AutomationTemplateChannel = 'email' | 'whatsapp' | 'in_app'

type MessageTemplateRow = {
  organization_id: string | null
  template_key: string
  channel: AutomationTemplateChannel
  subject: string | null
  body: string
}

function lookupVariable(context: Record<string, unknown>, path: string): string {
  const resolved = path.split('.').reduce<unknown>((current, segment) => {
    if (current && typeof current === 'object' && segment in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[segment]
    }
    return undefined
  }, context)

  if (resolved === null || typeof resolved === 'undefined') return ''
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
  const templates = await prisma.message_templates.findMany({
    select: { organization_id: true, template_key: true, channel: true, subject: true, body: true },
    where: {
      template_key: input.templateKey,
      channel: input.channel,
      is_active: true,
      ...(input.organizationId
        ? { OR: [{ organization_id: input.organizationId }, { organization_id: null }] }
        : { organization_id: null }),
    },
  })

  const rows = templates as MessageTemplateRow[]
  const selected =
    rows.find((t) => t.organization_id === (input.organizationId ?? null)) ??
    rows.find((t) => t.organization_id === null) ??
    null

  const variables = input.variables ?? {}

  return {
    subject: renderMessageTemplate(selected?.subject ?? input.fallbackSubject ?? '', variables) || null,
    body: renderMessageTemplate(selected?.body ?? input.fallbackBody, variables),
    source: selected ? (selected.organization_id ? 'organization' : 'global') : 'fallback',
  }
}
