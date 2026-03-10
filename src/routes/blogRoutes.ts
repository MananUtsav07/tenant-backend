import { Router } from 'express'

import { getPublicBlogPostBySlug, getPublicBlogPosts } from '../controllers/blogController.js'

export function createBlogRouter() {
  const router = Router()

  router.get('/', getPublicBlogPosts)
  router.get('/:slug', getPublicBlogPostBySlug)

  return router
}
