import type { Request, Response } from 'express'

import { AppError, asyncHandler } from '../lib/errors.js'
import { getPublishedBlogPostBySlug, listBlogPosts } from '../services/blogService.js'
import { blogSlugSchema, publicBlogListQuerySchema } from '../validations/blogSchemas.js'

export const getPublicBlogPosts = asyncHandler(async (request: Request, response: Response) => {
  const parsed = publicBlogListQuerySchema.parse(request.query)
  const listed = await listBlogPosts({
    ...parsed,
    include_unpublished: false,
  })

  response.json({
    ok: true,
    posts: listed.items,
    pagination: {
      page: parsed.page,
      page_size: parsed.page_size,
      total: listed.total,
      total_pages: Math.max(1, Math.ceil(listed.total / parsed.page_size)),
    },
  })
})

export const getPublicBlogPostBySlug = asyncHandler(async (request: Request, response: Response) => {
  const parsed = blogSlugSchema.parse(request.params)
  const post = await getPublishedBlogPostBySlug(parsed.slug)
  if (!post) {
    throw new AppError('Blog post not found', 404)
  }

  response.json({
    ok: true,
    post,
  })
})
