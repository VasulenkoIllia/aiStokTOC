import { formatISO, subDays } from 'date-fns'
import { Prisma } from '@prisma/client'
import { prisma } from '../../db/client'

type RebuildOptions = {
  orgId: string
  from?: string
  to?: string
}

const WAREHOUSE_FALLBACK = 'GLOBAL'
const CHANNEL_FALLBACK = 'ALL'

export async function rebuildSalesDaily({ orgId, from, to }: RebuildOptions) {
  const today = new Date()
  const fromDate =
    from ??
    formatISO(subDays(today, 90), {
      representation: 'date',
    })
  const toDate =
    to ??
    formatISO(today, {
      representation: 'date',
    })

  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO sales_daily (org_id, date, sku, warehouse_id, channel, units, revenue, orders)
      SELECT
        org_id,
        date(order_datetime) AS date,
        sku,
        coalesce(warehouse_id, ${WAREHOUSE_FALLBACK}) AS warehouse_id,
        coalesce(channel, ${CHANNEL_FALLBACK}) AS channel,
        coalesce(sum(qty), 0) AS units,
        coalesce(sum(net_amount), 0) AS revenue,
        count(distinct order_id) AS orders
      FROM sales_events
      WHERE org_id = ${orgId}
        AND order_datetime BETWEEN ${new Date(fromDate)}
            AND ${new Date(`${toDate}T23:59:59.999Z`)}
      GROUP BY org_id,
               date(order_datetime),
               sku,
               warehouse_id,
               channel
      ON CONFLICT (org_id, date, sku, warehouse_id, channel)
      DO UPDATE SET
        units = excluded.units,
        revenue = excluded.revenue,
        orders = excluded.orders,
        updated_at = now();
    `,
  )

  return { from: fromDate, to: toDate }
}
