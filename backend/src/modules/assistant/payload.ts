import { prisma } from '../../db/client'
import { subDays } from 'date-fns'

type ExplainParams = {
  orgId: string
  warehouseId: string
  sku: string
  date?: string
}

type ExplainPayload = {
  sku: string
  warehouse_id: string
  date: string
  zone: 'Red' | 'Yellow' | 'Green'
  avg_daily_demand: number
  demand_variability: number | null
  lead_time_days: number
  lt_variability: number | null
  buffer_factor: number
  buffer_qty: number
  on_hand: number
  inbound: number
  reservations: number
  order_raw: number
  buffer_penetration: number
  order_constraints: {
    moq: number | null
    pack_size: number | null
  }
  context: {
    abc?: string | null
    xyz?: string | null
    promo?: boolean
    seasonal_index?: number | null
  }
  time_series?: {
    daily_units_last_60: number[]
    start_date: string
  }
}

const DEFAULT_BUFFER_FACTOR = 1.2

export async function buildExplainPayload(params: ExplainParams): Promise<ExplainPayload | null> {
  const targetDate = params.date ? new Date(params.date) : new Date()
  const isoDate = targetDate.toISOString().slice(0, 10)

  const buffer = await prisma.buffers.findUnique({
    where: {
      org_id_sku_warehouse_id: {
        org_id: params.orgId,
        sku: params.sku,
        warehouse_id: params.warehouseId,
      },
    },
  })

  const avgDailyDemand =
    Number(buffer?.avg_daily_demand ?? (await computeAvgDailyDemand(params, targetDate))) || 0
  const bufferFactor = buffer ? Number(buffer.buffer_qty) / (avgDailyDemand || 1) : DEFAULT_BUFFER_FACTOR
  const leadTimeDays =
    Number(buffer?.lead_time_days ?? (await computeLeadTime(params))) || 7
  const bufferQty = avgDailyDemand * leadTimeDays * bufferFactor

  const salesStats = await computeDemandStats(params, targetDate)
  const demandVariability = salesStats?.variability ?? null

  const stockSnapshot = await prisma.stock_snapshots.findFirst({
    where: {
      org_id: params.orgId,
      warehouse_id: params.warehouseId,
      sku: params.sku,
      date: targetDate,
    },
  })

  const latestStock =
    stockSnapshot ??
    (await prisma.stock_snapshots.findFirst({
      where: {
        org_id: params.orgId,
        warehouse_id: params.warehouseId,
        sku: params.sku,
      },
      orderBy: { date: 'desc' },
    }))

  if (!latestStock && avgDailyDemand === 0 && bufferQty === 0) {
    return null
  }

  const onHand = Number(latestStock?.qty_on_hand ?? 0)
  const inbound = await computeInboundQty(params)
  const reservations = 0
  const stockPosition = onHand + inbound - reservations
  const penetration = bufferQty > 0 ? stockPosition / bufferQty : 0
  const zone = penetration <= 1 / 3 ? 'Red' : penetration <= 2 / 3 ? 'Yellow' : 'Green'
  const orderRaw = bufferQty - stockPosition

  const constraints = await fetchOrderConstraints(params)

  const timeSeries = await fetchTimeSeries(params, targetDate)

  return {
    sku: params.sku,
    warehouse_id: params.warehouseId,
    date: isoDate,
    zone,
    avg_daily_demand: round(avgDailyDemand),
    demand_variability,
    lead_time_days: round(leadTimeDays, 2),
    lt_variability: null,
    buffer_factor: round(bufferFactor, 2),
    buffer_qty: round(bufferQty),
    on_hand: round(onHand),
    inbound: round(inbound),
    reservations,
    order_raw: round(orderRaw),
    buffer_penetration: round(penetration, 2),
    order_constraints: constraints,
    context: {
      abc: null,
      xyz: null,
      promo: false,
      seasonal_index: salesStats?.seasonalIndex ?? null,
    },
    time_series: timeSeries,
  }
}

async function computeAvgDailyDemand(params: ExplainParams, targetDate: Date) {
  const fromDate = subDays(targetDate, 60)
  const stats = await prisma.sales_daily.aggregate({
    where: {
      org_id: params.orgId,
      warehouse_id: params.warehouseId,
      sku: params.sku,
      date: {
        gte: fromDate,
        lte: targetDate,
      },
    },
    _avg: { units: true },
  })
  return Number(stats._avg.units ?? 0)
}

async function computeDemandStats(params: ExplainParams, targetDate: Date) {
  const fromDate = subDays(targetDate, 60)
  const rows = await prisma.sales_daily.findMany({
    where: {
      org_id: params.orgId,
      warehouse_id: params.warehouseId,
      sku: params.sku,
      date: {
        gte: fromDate,
        lte: targetDate,
      },
    },
    orderBy: { date: 'asc' },
  })

  if (!rows.length) return null
  const units = rows.map((row) => Number(row.units ?? 0))
  const mean =
    units.reduce((sum, value) => sum + value, 0) / (units.length || 1)
  const variance =
    units.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
    (units.length || 1)
  const stdDev = Math.sqrt(variance)
  return {
    variability: mean ? Number((stdDev / mean).toFixed(2)) : null,
    seasonalIndex: null,
  }
}

async function computeInboundQty(params: ExplainParams) {
  const result = await prisma.$queryRaw<
    Array<{
      inbound: number | null
    }>
  >`
    SELECT COALESCE(SUM(pol.qty), 0) AS inbound
    FROM purchase_order_lines pol
    INNER JOIN purchase_orders po
      ON po.org_id = pol.org_id AND po.po_id = pol.po_id
    WHERE pol.org_id = ${params.orgId}
      AND pol.sku = ${params.sku}
      AND po.received_at IS NULL
  `
  return Number(result[0]?.inbound ?? 0)
}

async function fetchOrderConstraints(params: ExplainParams) {
  const line = await prisma.purchase_order_lines.findFirst({
    where: {
      org_id: params.orgId,
      sku: params.sku,
    },
    orderBy: {
      created_at: 'desc',
    },
  })

  return {
    moq: line?.moq ?? null,
    pack_size: line?.pack_size ?? null,
  }
}

async function fetchTimeSeries(params: ExplainParams, targetDate: Date) {
  const fromDate = subDays(targetDate, 60)
  const rows = await prisma.sales_daily.findMany({
    where: {
      org_id: params.orgId,
      warehouse_id: params.warehouseId,
      sku: params.sku,
      date: {
        gte: fromDate,
        lte: targetDate,
      },
    },
    orderBy: { date: 'asc' },
  })

  if (!rows.length) return undefined

  return {
    start_date: fromDate.toISOString().slice(0, 10),
    daily_units_last_60: rows.map((row) => Number(row.units ?? 0)),
  }
}

async function computeLeadTime(params: ExplainParams) {
  const stat = await prisma.lead_time_stats.findFirst({
    where: {
      org_id: params.orgId,
      sku: params.sku,
    },
  })
  return Number(stat?.lead_time_days_median ?? 7)
}

function round(value: number, precision = 1) {
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}
