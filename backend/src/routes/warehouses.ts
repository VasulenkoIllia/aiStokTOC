import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db/client'
import { getOrgIdFromRequest } from '../middleware/auth'

const listQuery = z.object({
  search: z.string().optional(),
})

export const warehousesRouter = Router()

warehousesRouter.get('/', async (req, res) => {
  const params = listQuery.safeParse(req.query)
  if (!params.success) {
    return res.status(400).json({ error: params.error.message })
  }

  try {
    const orgId = await getOrgIdFromRequest(req)
    const rows = await prisma.warehouses.findMany({
      where: {
        org_id: orgId,
        ...(params.data.search
          ? {
              name: {
                contains: params.data.search,
                mode: 'insensitive' as const,
              },
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
      },
    })

    const withDates = await Promise.all(
      rows.map(async (row) => {
        const agg = await prisma.stock_snapshots.aggregate({
          where: {
            org_id: orgId,
            warehouse_id: row.id,
          },
          _max: {
            date: true,
          },
        })
        return {
          id: row.id,
          name: row.name,
          latestStockDate: agg._max.date ?? null,
        }
      }),
    )

    return res.json({
      data: withDates,
    })
  } catch (error: any) {
    return res.status(error.statusCode ?? 400).json({ error: error.message })
  }
})
