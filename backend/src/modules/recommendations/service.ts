import { addDays, startOfDay } from 'date-fns'
import { prisma } from '../../db/client'
import { listBuffers, listBuffersPage, recalcBuffers } from '../calculations/buffers'

type RecommendationInput = {
  orgId: string
  warehouseId: string
  date: string
  autoRecalc?: boolean
  page?: number
  pageSize?: number
}

export type RecommendationRow = {
  sku: string
  category?: string | null
  name: string
  segment: 'A' | 'B' | 'C'
  zone: 'red' | 'yellow' | 'green'
  target: number
  onHand: number
  inbound: number
  suggestedQty: number
  reason: string
  overstock?: {
    ratio: number
    message: string
  }
  avgDailyDemand: number
  leadTimeDays: number
  daysOfSupply: number | null
  bufferPenetration: number | null
  monthlyDemand: number
}

export type RecommendationPage = {
  data: RecommendationRow[]
  total: number
  effectiveDate: Date | null
}

export async function getRecommendations({
  orgId,
  warehouseId,
  date,
  autoRecalc = true,
  page = 1,
  pageSize = 100,
}: RecommendationInput): Promise<RecommendationPage> {
  if (autoRecalc) {
    await recalcBuffers({ orgId, warehouseId })
  }

  const dayStart = startOfDay(new Date(date))
  const dayEnd = addDays(dayStart, 1)

  const skip = Math.max(0, (page - 1) * pageSize)
  const { items: buffers, total } = await listBuffersPage(orgId, warehouseId, skip, pageSize)
  if (!buffers.length) {
    return {
      data: [],
      total,
    }
  }

  const skuList = buffers.map((b) => b.sku)
  const fetchStockRows = async (rangeStart: Date, rangeEnd: Date) => {
    if (!skuList.length) return []
    return prisma.stock_snapshots.groupBy({
      by: ['sku'],
      where: {
        org_id: orgId,
        warehouse_id: warehouseId,
        date: {
          gte: rangeStart,
          lt: rangeEnd,
        },
        sku: { in: skuList },
      },
      _sum: {
        qty_on_hand: true,
      },
    })
  }

  let effectiveDate: Date | null = null
  let stockRows = await fetchStockRows(dayStart, dayEnd)
  if (stockRows.length) {
    effectiveDate = dayStart
  } else {
    const fallbackDate = await prisma.stock_snapshots.findFirst({
      where: {
        org_id: orgId,
        warehouse_id: warehouseId,
        date: {
          lte: dayEnd,
        },
      },
      orderBy: {
        date: 'desc',
      },
      select: {
        date: true,
      },
    })
    if (fallbackDate?.date) {
      const fallbackStart = startOfDay(fallbackDate.date)
      const fallbackEnd = addDays(fallbackStart, 1)
      stockRows = await fetchStockRows(fallbackStart, fallbackEnd)
      if (stockRows.length) {
        effectiveDate = fallbackStart
      }
    }
  }

  const catalogRows = skuList.length
    ? await prisma.catalog.findMany({
        where: {
          org_id: orgId,
          sku: { in: skuList },
        },
        select: {
          sku: true,
          category: true,
          name: true,
        },
      })
    : []

  const stockMap = new Map(
    stockRows.map((row) => [row.sku, Number(row._sum?.qty_on_hand ?? 0)]),
  )
  const catalogMap = new Map(
    catalogRows.map((row) => [row.sku, { category: row.category ?? null, name: row.name }]),
  )

  const recommendations: RecommendationRow[] = buffers.map((buffer) => {
    const onHand = stockMap.get(buffer.sku) ?? 0
    const inbound = 0 // TODO: додати фактичні поставки з PO
    const target = buffer.bufferQty
    const orderRaw = target - (onHand + inbound)
    const suggestedQty = Math.max(0, Math.ceil(orderRaw))
    const zone = resolveZone(onHand, buffer.redThreshold, buffer.yellowThreshold)
    const reason =
      zone === 'red'
        ? 'рівень у червоній зоні, необхідне термінове поповнення'
        : zone === 'yellow'
          ? 'жовта зона — заплануйте замовлення'
          : 'зелена зона — запас у нормі'

    const avgDailyDemand = Number(buffer.avgDailyDemand ?? 0)
    const leadTimeDays = Number(buffer.leadTimeDays ?? 0)
    const daysOfSupply = avgDailyDemand > 0 ? roundNumber(onHand / avgDailyDemand, 1) : null
    const bufferPenetration =
      target > 0 ? roundNumber((onHand + inbound) / target, 2) : null
    const overstock = detectOverstock(onHand, avgDailyDemand)

    return {
      sku: buffer.sku,
      category: catalogMap.get(buffer.sku)?.category ?? null,
      name: catalogMap.get(buffer.sku)?.name ?? buffer.sku,
      segment: classifySegment(avgDailyDemand),
      zone,
      target: roundNumber(target),
      onHand: roundNumber(onHand),
      inbound,
      suggestedQty,
      reason,
      overstock,
      avgDailyDemand: roundNumber(avgDailyDemand),
      leadTimeDays: roundNumber(leadTimeDays),
      daysOfSupply,
      bufferPenetration,
      monthlyDemand: roundNumber(avgDailyDemand * 30),
    }
  })

  return {
    data: recommendations,
    total,
    effectiveDate,
  }
}

function resolveZone(onHand: number, red: number, yellow: number): 'red' | 'yellow' | 'green' {
  if (onHand <= red) return 'red'
  if (onHand <= yellow) return 'yellow'
  return 'green'
}

function roundNumber(value: number, precision = 1) {
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}

function detectOverstock(onHand: number, avgDailyDemand: number | undefined | null) {
  if (!avgDailyDemand || avgDailyDemand <= 0) return undefined
  const demand30 = avgDailyDemand * 30
  if (demand30 <= 0) return undefined
  const ratio = onHand / demand30
  if (ratio <= 1.1) return undefined
  return {
    ratio: roundNumber(ratio, 2),
    message: `Запас ≈${Math.round(ratio * 100)}% від місячного попиту`,
  }
}

function classifySegment(avgDailyDemand: number): 'A' | 'B' | 'C' {
  if (avgDailyDemand >= 20) return 'A'
  if (avgDailyDemand >= 10) return 'B'
  return 'C'
}
