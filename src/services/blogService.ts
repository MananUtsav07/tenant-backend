import { prisma } from '../lib/db.js'
import type { Prisma } from '@prisma/client'

type BlogListQuery = {
  page: number
  page_size: number
  search?: string
  sort_by: 'created_at' | 'title' | 'published'
  sort_order: 'asc' | 'desc'
  include_unpublished?: boolean
}

function escapeSearchTerm(term: string): string {
  return term.replace(/[%_]/g, '').replaceAll(',', ' ').trim()
}

const blogSelect = {
  id: true,
  title: true,
  slug: true,
  content: true,
  excerpt: true,
  cover_image: true,
  author: true,
  published: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.blog_postsSelect

export async function listBlogPosts(query: BlogListQuery) {
  const skip = (query.page - 1) * query.page_size
  const where: Prisma.blog_postsWhereInput = {}

  if (!query.include_unpublished) {
    where.published = true
  }

  if (query.search && query.search.trim().length > 0) {
    const escaped = escapeSearchTerm(query.search)
    if (escaped.length > 0) {
      where.OR = [
        { title: { contains: escaped, mode: 'insensitive' } },
        { excerpt: { contains: escaped, mode: 'insensitive' } },
        { author: { contains: escaped, mode: 'insensitive' } },
      ]
    }
  }

  const [items, total] = await prisma.$transaction([
    prisma.blog_posts.findMany({
      select: blogSelect,
      where,
      orderBy: { [query.sort_by]: query.sort_order },
      skip,
      take: query.page_size,
    }),
    prisma.blog_posts.count({ where }),
  ])

  return { items, total }
}

export async function getPublishedBlogPostBySlug(slug: string) {
  return prisma.blog_posts.findFirst({
    select: blogSelect,
    where: { slug, published: true },
  })
}

export async function createBlogPost(input: {
  title: string
  slug: string
  content: string
  excerpt: string
  cover_image?: string | null
  author?: string
  published?: boolean
}) {
  return prisma.blog_posts.create({
    data: {
      title: input.title,
      slug: input.slug,
      content: input.content,
      excerpt: input.excerpt,
      cover_image: input.cover_image ?? null,
      author: input.author ?? 'Prophives Team',
      published: input.published ?? false,
    },
    select: blogSelect,
  })
}

export async function updateBlogPost(
  blogPostId: string,
  patch: Partial<{
    title: string
    slug: string
    content: string
    excerpt: string
    cover_image: string | null
    author: string
    published: boolean
  }>,
) {
  return prisma.blog_posts.update({
    where: { id: blogPostId },
    data: patch,
    select: blogSelect,
  })
}

export async function deleteBlogPost(blogPostId: string) {
  await prisma.blog_posts.delete({ where: { id: blogPostId } })
  return 1
}
