import { Router } from 'express'
import { z } from 'zod'
import { getRecommendations } from '../modules/recommendations/service'
import { getOrgIdFromRequest } from '../middleware/auth'

const recommendationsQuery = z.object({
  org_id: z.string().optional(),
  warehouse_id: z.string(),
  date: z
    .string()
    .optional()
    .default(() => new Date().toISOString().slice(0, 10)),
  page: z.coerce.number().int().min(1).optional().default(1),
  page_size: z.coerce.number().int().min(10).max(200).optional().default(50),
})

export const recommendationsRouter = Router()

recommendationsRouter.get('/', async (req, res) => {
  const parsed = recommendationsQuery.safeParse(req.query)
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.message })
  }

  const { date, warehouse_id, org_id, page, page_size } = parsed.data
  try {
    const resolvedOrgId = await getOrgIdFromRequest(req, org_id)
    const result = await getRecommendations({
      orgId: resolvedOrgId,
      warehouseId: warehouse_id,
      date,
      page,
      pageSize: page_size,
    })
    return res.json({
      date,
      effective_date: result.effectiveDate
        ? result.effectiveDate.toISOString().slice(0, 10)
        : null,
      org_id: resolvedOrgId,
      warehouse_id,
      page,
      page_size,
      total: result.total,
      data: result.data,
    })
  } catch (error: any) {
    return res.status(error.statusCode ?? 400).json({ error: error.message })
  }
})
