import { Router } from 'express'
import { healthRouter } from './health'
import { recommendationsRouter } from './recommendations'
import { kpiRouter } from './kpi'
import { assistantRouter } from './assistant'
import { ingestRouter } from './ingest'
import { buffersRouter } from './buffers'
import { authRouter } from './auth'
import { authMiddleware } from '../middleware/auth'
import { warehousesRouter } from './warehouses'

export const apiRouter = Router()

apiRouter.use('/health', healthRouter)
apiRouter.use('/auth', authRouter)
apiRouter.use(authMiddleware)
apiRouter.use('/recommendations', recommendationsRouter)
apiRouter.use('/kpi', kpiRouter)
apiRouter.use('/assistant', assistantRouter)
apiRouter.use('/ingest', ingestRouter)
apiRouter.use('/buffers', buffersRouter)
apiRouter.use('/warehouses', warehousesRouter)
