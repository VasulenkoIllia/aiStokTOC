import { subDays } from 'date-fns'
import { prisma } from '../../db/client'

const DEFAULT_LEAD_TIME_DAYS = 7
const BUFFER_FACTOR = 1.2

type RecalcOptions = {
  orgId: string
  warehouseId: string
  lookbackDays?: number
}

export async function recalcBuffers({
  orgId,
  warehouseId,
  lookbackDays = 60,
}: RecalcOptions) {
  const sinceDate = subDays(new Date(), lookbackDays)
  const demandRows = await prisma.sales_daily.groupBy({
    by: ['sku'],
    where: {
      org_id: orgId,
      warehouse_id: warehouseId,
      date: {
        gte: sinceDate,
      },
    },
    _avg: {
      units: true,
    },
  })

  if (!demandRows.length) {
    return { updated: 0 }
  }

  await prisma.$transaction(
    demandRows.map((row) => {
      const avgDailyDemand = Number(row._avg.units ?? 0)
      const leadTimeDays = DEFAULT_LEAD_TIME_DAYS
      const bufferQty = avgDailyDemand * leadTimeDays * BUFFER_FACTOR
      return prisma.buffers.upsert({
        where: {
          org_id_sku_warehouse_id: {
            org_id: orgId,
            sku: row.sku,
            warehouse_id: warehouseId,
          },
        },
        update: {
          lead_time_days: leadTimeDays,
          avg_daily_demand: avgDailyDemand,
          buffer_qty: bufferQty,
          red_th: bufferQty / 3,
          yellow_th: (bufferQty * 2) / 3,
          updated_at: new Date(),
        },
        create: {
          org_id: orgId,
          warehouse_id: warehouseId,
          sku: row.sku,
          lead_time_days: leadTimeDays,
          avg_daily_demand: avgDailyDemand,
          buffer_qty: bufferQty,
          red_th: bufferQty / 3,
          yellow_th: (bufferQty * 2) / 3,
        },
      })
    }),
  )

  return { updated: demandRows.length }
}

function mapBuffer(row: {
  sku: string
  warehouse_id: string
  avg_daily_demand: any
  lead_time_days: any
  buffer_qty: any
  red_th: any
  yellow_th: any
  updated_at: Date
}) {
  return {
    sku: row.sku,
    warehouseId: row.warehouse_id,
    avgDailyDemand: Number(row.avg_daily_demand ?? 0),
    leadTimeDays: Number(row.lead_time_days ?? 0),
    bufferQty: Number(row.buffer_qty ?? 0),
    redThreshold: Number(row.red_th ?? 0),
    yellowThreshold: Number(row.yellow_th ?? 0),
    updatedAt: row.updated_at,
  }
}

export async function listBuffers(orgId: string, warehouseId: string) {
  const rows = await prisma.buffers.findMany({
    where: {
      org_id: orgId,
      warehouse_id: warehouseId,
    },
    orderBy: {
      sku: 'asc',
    },
  })

  return rows.map(mapBuffer)
}

export async function listBuffersPage(
  orgId: string,
  warehouseId: string,
  skip: number,
  take: number,
) {
  const where = {
    org_id: orgId,
    warehouse_id: warehouseId,
  }
  const [rows, total] = await Promise.all([
    prisma.buffers.findMany({
      where,
      orderBy: { sku: 'asc' },
      skip,
      take,
    }),
    prisma.buffers.count({ where }),
  ])
  return {
    items: rows.map(mapBuffer),
    total,
  }
}
