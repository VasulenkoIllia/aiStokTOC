import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import swaggerUi from 'swagger-ui-express'
import pinoHttp from 'pino-http'
import { apiRouter } from './routes'
import { env } from './config/env'
import { logger } from './config/logger'
import { openapiSpec } from './openapi/spec'

export function buildApp() {
  const app = express()

  app.use(helmet())
  app.use(cors({ origin: true }))
  app.use(express.json({ limit: '10mb' }))
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  )

  app.use(
    pinoHttp({
      logger,
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error'
        if (res.statusCode >= 400) return 'warn'
        return 'info'
      },
    }),
  )

  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiSpec))
  app.use('/api', apiRouter)

  app.get('/', (_req, res) => res.redirect('/docs'))

  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Warehouse Assistant API (Express) готовий')

  return app
}
