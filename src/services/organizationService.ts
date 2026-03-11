import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized.length > 0 ? normalized : 'organization'
}

async function slugExists(slug: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.from('organizations').select('id').eq('slug', slug).maybeSingle()
  throwIfError(error, 'Failed to verify organization slug')
  return Boolean(data)
}

export async function generateUniqueOrganizationSlug(seed: string): Promise<string> {
  const baseSlug = slugify(seed)
  if (!(await slugExists(baseSlug))) {
    return baseSlug
  }

  for (let index = 0; index < 20; index += 1) {
    const candidate = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`
    if (!(await slugExists(candidate))) {
      return candidate
    }
  }

  throw new AppError('Failed to generate a unique organization slug', 500)
}

export async function createOrganization(input: {
  name: string
  slug?: string
  plan_code?: string | null
  country_code?: string
  currency_code?: string
  created_at?: string
}) {
  const slug = input.slug ?? (await generateUniqueOrganizationSlug(input.name))

  const { data, error } = await supabaseAdmin
    .from('organizations')
    .insert({
      name: input.name,
      slug,
      plan_code: input.plan_code ?? 'starter',
      country_code: input.country_code ?? 'IN',
      currency_code: input.currency_code ?? 'INR',
      created_at: input.created_at ?? new Date().toISOString(),
    })
    .select('*')
    .single()

  throwIfError(error, 'Failed to create organization')
  return data
}

export async function getOrganizationById(organizationId: string) {
  const { data, error } = await supabaseAdmin.from('organizations').select('*').eq('id', organizationId).maybeSingle()
  throwIfError(error, 'Failed to load organization')
  return data
}

export async function listOrganizationsBasic(query: {
  page: number
  page_size: number
  search?: string
  sort_by: 'created_at' | 'name' | 'slug' | 'plan_code'
  sort_order: 'asc' | 'desc'
}) {
  const from = (query.page - 1) * query.page_size
  const to = from + query.page_size - 1

  let request = supabaseAdmin
    .from('organizations')
    .select('id, name, slug, plan_code, created_at', { count: 'exact' })
    .order(query.sort_by, { ascending: query.sort_order === 'asc' })
    .range(from, to)

  if (query.search && query.search.trim().length > 0) {
    const escaped = query.search.trim().replace(/[%_]/g, '').replaceAll(',', ' ')
    if (escaped.length > 0) {
      request = request.or(`name.ilike.%${escaped}%,slug.ilike.%${escaped}%,plan_code.ilike.%${escaped}%`)
    }
  }

  const { data, error, count } = await request
  throwIfError(error, 'Failed to list organizations')

  return {
    items: data ?? [],
    total: count ?? 0,
  }
}

export async function upsertOwnerMembership(input: {
  organization_id: string
  owner_id: string
  role?: 'owner' | 'manager' | 'viewer'
}) {
  const { data, error } = await supabaseAdmin
    .from('owner_memberships')
    .upsert(
      {
        organization_id: input.organization_id,
        owner_id: input.owner_id,
        role: input.role ?? 'owner',
      },
      { onConflict: 'organization_id,owner_id' },
    )
    .select('*')
    .single()

  throwIfError(error, 'Failed to create owner membership')
  return data
}
