import type { PostgrestError } from '@supabase/supabase-js'

import { AppError } from '../lib/errors.js'
import { supabaseAdmin } from '../lib/supabase.js'

type BlogListQuery = {
  page: number
  page_size: number
  search?: string
  sort_by: 'created_at' | 'title' | 'published'
  sort_order: 'asc' | 'desc'
  include_unpublished?: boolean
}

function throwIfError(error: PostgrestError | null, message: string): void {
  if (error) {
    throw new AppError(message, 500, error.message)
  }
}

function escapeSearchTerm(term: string): string {
  return term.replace(/[%_]/g, '').replaceAll(',', ' ').trim()
}

const blogSelectFields =
  'id, title, slug, content, excerpt, cover_image, author, published, created_at, updated_at'

export async function listBlogPosts(query: BlogListQuery) {
  const from = (query.page - 1) * query.page_size
  const to = from + query.page_size - 1

  let request = supabaseAdmin
    .from('blog_posts')
    .select(blogSelectFields, { count: 'exact' })
    .order(query.sort_by, { ascending: query.sort_order === 'asc' })
    .range(from, to)

  if (!query.include_unpublished) {
    request = request.eq('published', true)
  }

  if (query.search && query.search.trim().length > 0) {
    const escaped = escapeSearchTerm(query.search)
    if (escaped.length > 0) {
      request = request.or(`title.ilike.%${escaped}%,excerpt.ilike.%${escaped}%,author.ilike.%${escaped}%`)
    }
  }

  const { data, error, count } = await request
  throwIfError(error, 'Failed to list blog posts')

  return {
    items: data ?? [],
    total: count ?? 0,
  }
}

export async function getPublishedBlogPostBySlug(slug: string) {
  const { data, error } = await supabaseAdmin
    .from('blog_posts')
    .select(blogSelectFields)
    .eq('slug', slug)
    .eq('published', true)
    .maybeSingle()

  throwIfError(error, 'Failed to load blog post')
  return data
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
  const { data, error } = await supabaseAdmin
    .from('blog_posts')
    .insert({
      title: input.title,
      slug: input.slug,
      content: input.content,
      excerpt: input.excerpt,
      cover_image: input.cover_image ?? null,
      author: input.author ?? 'Prophives Team',
      published: input.published ?? false,
    })
    .select(blogSelectFields)
    .single()

  throwIfError(error, 'Failed to create blog post')
  if (!data) {
    throw new AppError('Failed to create blog post', 500)
  }
  return data
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
  const { data, error } = await supabaseAdmin
    .from('blog_posts')
    .update(patch)
    .eq('id', blogPostId)
    .select(blogSelectFields)
    .maybeSingle()

  throwIfError(error, 'Failed to update blog post')
  return data
}

export async function deleteBlogPost(blogPostId: string) {
  const { error, count } = await supabaseAdmin.from('blog_posts').delete({ count: 'exact' }).eq('id', blogPostId)
  throwIfError(error, 'Failed to delete blog post')
  return count ?? 0
}
