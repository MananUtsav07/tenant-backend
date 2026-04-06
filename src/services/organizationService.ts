import { AppError } from '../lib/errors.js'
import { prisma } from '../lib/db.js'

function slugify(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized.length > 0 ? normalized : 'organization'
}

async function slugExists(slug: string): Promise<boolean> {
  const data = await prisma.organizations.findFirst({ where: { slug }, select: { id: true } })
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

  const data = await prisma.organizations.create({
    data: {
      name: input.name,
      slug,
      plan_code: input.plan_code ?? 'starter',
      country_code: input.country_code ?? 'IN',
      currency_code: input.currency_code ?? 'INR',
      created_at: input.created_at ?? new Date().toISOString(),
    },
  })

  return data
}

export async function getOrganizationById(organizationId: string) {
  const data = await prisma.organizations.findUnique({ where: { id: organizationId } })
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

  const where: Record<string, unknown> = {}

  if (query.search && query.search.trim().length > 0) {
    const escaped = query.search.trim().replace(/[%_]/g, '').replaceAll(',', ' ')
    if (escaped.length > 0) {
      where.OR = [
        { name: { contains: escaped, mode: 'insensitive' } },
        { slug: { contains: escaped, mode: 'insensitive' } },
        { plan_code: { contains: escaped, mode: 'insensitive' } },
      ]
    }
  }

  const [data, total] = await Promise.all([
    prisma.organizations.findMany({
      where,
      select: { id: true, name: true, slug: true, plan_code: true, created_at: true },
      orderBy: { [query.sort_by]: query.sort_order },
      skip: from,
      take: to - from + 1,
    }),
    prisma.organizations.count({ where }),
  ])

  return {
    items: data,
    total,
  }
}

export async function upsertOwnerMembership(input: {
  organization_id: string
  owner_id: string
  role?: 'owner' | 'manager' | 'viewer'
}) {
  const data = await prisma.owner_memberships.upsert({
    where: {
      organization_id_owner_id: {
        organization_id: input.organization_id,
        owner_id: input.owner_id,
      },
    },
    create: {
      organization_id: input.organization_id,
      owner_id: input.owner_id,
      role: input.role ?? 'owner',
    },
    update: {
      role: input.role ?? 'owner',
    },
  })

  return data
}
