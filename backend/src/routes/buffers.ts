import { Router } from 'express'
import { z } from 'zod'
import { listBuffers, recalcBuffers } from '../modules/calculations/buffers'
import { getOrgIdFromRequest } from '../middleware/auth'

const querySchema = z.object({
  org_id: z.string().optional(),
  warehouse_id: z.string(),
  recalc: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
})

export const buffersRouter = Router()

buffersRouter.get('/', async (req, res) => {
  const parsed = querySchema.safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message })
  }

  const { org_id, warehouse_id, recalc } = parsed.data

  try {
    const resolvedOrgId = await getOrgIdFromRequest(req, org_id)

    if (recalc) {
      await recalcBuffers({ orgId: resolvedOrgId, warehouseId: warehouse_id })
    }

    const data = await listBuffers(resolvedOrgId, warehouse_id)
    return res.json({ org_id: resolvedOrgId, data })
  } catch (error: any) {
    return res.status(error.statusCode ?? 400).json({ error: error.message })
  }
})
