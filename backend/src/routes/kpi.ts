import { Router } from 'express'
import { z } from 'zod'
import { getSkuKpi } from '../modules/kpi/service'
import { getOrgIdFromRequest } from '../middleware/auth'

const kpiParams = z.object({
  sku: z.string(),
})

const kpiQuery = z.object({
  org_id: z.string().optional(),
  warehouse_id: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

export const kpiRouter = Router()

kpiRouter.get('/sku/:sku', async (req, res) => {
  const params = kpiParams.safeParse(req.params)
  const query = kpiQuery.safeParse(req.query)
  if (!params.success) return res.status(400).json({ error: params.error.message })
  if (!query.success) return res.status(400).json({ error: query.error.message })

  const { sku } = params.data
  const { from, to, warehouse_id, org_id } = query.data
  try {
    const resolvedOrgId = await getOrgIdFromRequest(req, org_id)
    const payload = await getSkuKpi({
      orgId: resolvedOrgId,
      sku,
      warehouseId: warehouse_id,
      from,
      to,
    })

    return res.json(payload)
  } catch (error: any) {
    return res.status(error.statusCode ?? 400).json({ error: error.message })
  }
})
