import { differenceInCalendarDays, formatISO, parseISO, subDays } from 'date-fns'
import { prisma } from '../../db/client'

type KpiInput = {
  orgId: string
  sku: string
  warehouseId?: string
  from?: string
  to?: string
}

export async function getSkuKpi({ orgId, sku, warehouseId, from, to }: KpiInput) {
  const today = new Date()
  const fromDateObj = from ? new Date(from) : subDays(today, 30)
  const toDateObj = to ? new Date(to) : today
  const fromDate = formatISO(fromDateObj, { representation: 'date' })
  const toDate = formatISO(toDateObj, { representation: 'date' })
  const warehouse = warehouseId ?? 'GLOBAL'

  const whereClause = {
    org_id: orgId,
    sku,
    warehouse_id: warehouse,
    date: {
      gte: new Date(fromDate),
      lte: new Date(`${toDate}T23:59:59.999Z`),
    },
  }

  const salesAgg = await prisma.sales_daily.aggregate({
    where: whereClause,
    _sum: {
      units: true,
    },
    _avg: {
      units: true,
    },
  })

  const windowDays = Math.max(
    1,
    differenceInCalendarDays(parseISO(toDate), parseISO(fromDate)) + 1,
  )

  const totalUnits = Number(salesAgg._sum.units ?? 0)
  const avgDailyDemand = Number(salesAgg._avg.units ?? 0)

  const latestStock = await prisma.stock_snapshots.findFirst({
    where: {
      org_id: orgId,
      sku,
      warehouse_id: warehouse,
    },
    orderBy: {
      date: 'desc',
    },
  })

  let onHand = 0
  let minExpiry: string | null = null
  if (latestStock) {
    const stockAgg = await prisma.stock_snapshots.aggregate({
      where: {
        org_id: orgId,
        sku,
        warehouse_id: warehouse,
        date: latestStock.date,
      },
      _sum: {
        qty_on_hand: true,
      },
      _min: {
        expiry_date: true,
      },
    })
    onHand = Number(stockAgg._sum.qty_on_hand ?? 0)
    minExpiry = stockAgg._min.expiry_date?.toISOString() ?? null
  }

  const dos = avgDailyDemand > 0 ? onHand / avgDailyDemand : null
  const dailyUnits = windowDays > 0 ? totalUnits / windowDays : 0
  const turns = onHand > 0 ? (dailyUnits * 365) / onHand : 0
  const medianDaysToSell =
    turns > 0 ? Math.round(365 / turns) : dos ? Math.round(dos) : undefined

  const fefoRisk =
    !!minExpiry && dos
      ? differenceInCalendarDays(parseISO(minExpiry), today) < Math.ceil(dos)
      : false

  return {
    sku,
    from: fromDate,
    to: toDate,
    metrics: {
      dos,
      turns,
      median_days_to_sell: medianDaysToSell,
      fefo_risk: fefoRisk,
      on_hand: onHand,
      avg_daily_demand: avgDailyDemand,
    },
  }
}
