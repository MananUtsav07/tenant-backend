import cors from 'cors'
import express, { type Request } from 'express'
import helmet from 'helmet'
import morgan from 'morgan'

import { env } from './config/env.js'
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js'
import { createRateLimiter } from './middleware/rateLimit.js'
import { requestContext } from './middleware/requestContext.js'
import { createAdminRouter } from './routes/adminRoutes.js'
import { createAuthRouter } from './routes/authRoutes.js'
import { createBlogRouter } from './routes/blogRoutes.js'
import { createOwnerAiRouter } from './routes/ownerAiRoutes.js'
import { createOwnerRouter } from './routes/ownerRoutes.js'
import { createPublicRouter } from './routes/publicRoutes.js'
import { createTenantRouter } from './routes/tenantRoutes.js'

export function createApp() {
  const app = express()

  morgan.token('requestId', (request) => (request as Request).requestId ?? '-')

  app.use(requestContext)
  app.use((request, response, next) => {
    if (request.requestId) {
      response.setHeader('x-request-id', request.requestId)
    }
    next()
  })
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true)
          return
        }

        if (env.ALLOWED_ORIGIN_LIST.includes(origin)) {
          callback(null, true)
          return
        }

        callback(new Error('CORS origin not allowed'))
      },
      credentials: true,
    }),
  )
  app.use(helmet())
  app.use(express.json({ limit: '1mb' }))
  app.use(express.urlencoded({ extended: true }))
  app.use(morgan(':method :url :status :response-time ms reqId=:requestId'))

  const authRateLimit = createRateLimiter({
    keyPrefix: 'auth',
    windowMs: 10 * 60 * 1000,
    max: 60,
  })

  const publicRateLimit = createRateLimiter({
    keyPrefix: 'public-api',
    windowMs: 5 * 60 * 1000,
    max: 30,
  })

  const tenantRateLimit = createRateLimiter({
    keyPrefix: 'tenant-api',
    windowMs: 60 * 1000,
    max: 40,
  })

  app.get('/api/health', (_request, response) => {
    response.json({
      ok: true,
      env: env.NODE_ENV,
      service: 'tenant-backend',
      ts: new Date().toISOString(),
    })
  })

  app.use('/api/auth', authRateLimit, createAuthRouter())
  app.use('/api/public', publicRateLimit, createPublicRouter())
  app.use('/api/blog', publicRateLimit, createBlogRouter())
  app.use('/api/admin', authRateLimit, createAdminRouter())
  app.use('/api/owner', createOwnerAiRouter())
  app.use('/api/owners', createOwnerRouter())
  app.use('/api/tenants', tenantRateLimit, createTenantRouter())

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

export const app = createApp()
