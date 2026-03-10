import { z } from 'zod'

export const blogSlugSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
})

export const publicBlogListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(50).default(9),
  search: z.string().trim().max(120).optional(),
  sort_by: z.enum(['created_at', 'title']).default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
})

export const adminBlogListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(50).default(10),
  search: z.string().trim().max(120).optional(),
  sort_by: z.enum(['created_at', 'title', 'published']).default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
})

export const createBlogPostSchema = z.object({
  title: z.string().trim().min(3).max(200),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(160)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  content: z.string().trim().min(20),
  excerpt: z.string().trim().min(10).max(320),
  cover_image: z.string().trim().url().optional().nullable(),
  author: z.string().trim().min(2).max(120).optional(),
  published: z.boolean().optional(),
})

export const updateBlogPostSchema = createBlogPostSchema.partial()
