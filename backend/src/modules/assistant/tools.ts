import { Prisma } from '@prisma/client'
import { addDays, formatISO, startOfDay, subDays } from 'date-fns'
import { z } from 'zod'
import { prisma } from '../../db/client'
import { getRecommendations } from '../recommendations/service'
import { buildExplainPayload } from './payload'

type ToolContext = {
  orgId: string
}

type ToolDefinition = {
  name: string
  description: string
  parameters: Record<string, any>
  handler: (ctx: ToolContext, args: unknown) => Promise<any>
}

type SalesDailyRow = {
  sku: string
  warehouse_id: string
  units: Prisma.Decimal | null
  revenue: Prisma.Decimal | null
  channel: string | null
}

type StockSnapshotRow = {
  warehouse_id: string
  batch_id: string
  qty_on_hand: Prisma.Decimal | null
  expiry_date: Date | null
  date: Date
}

const numberLike = z
  .union([z.number(), z.string().trim().transform(Number)])
  .refine((val) => !Number.isNaN(val), { message: 'Очікується число' })

const getTopSkusSchema = z.object({
  warehouse_id: z.string().trim().min(2).max(64).optional(),
  days: numberLike.optional(),
  limit: numberLike.optional(),
  metric: z.enum(['units', 'revenue']).optional(),
})

const getSalesByDaySchema = z.object({
  date: z.string().trim().optional(),
  warehouse_id: z.string().trim().min(2).max(64).optional(),
  limit: numberLike.optional(),
})

const getStockSchema = z.object({
  sku: z.string().trim().min(1),
  warehouse_id: z.string().trim().min(2).max(64).optional(),
  date: z.string().trim().optional(),
})

const getBufferSchema = z.object({
  sku: z.string().trim().min(1),
  warehouse_id: z.string().trim().min(2).max(64),
})

const getPurchaseOrdersSchema = z.object({
  sku: z.string().trim().min(1).optional(),
  status: z.enum(['pending', 'received', 'all']).optional(),
  limit: numberLike.optional(),
})

const getStockByWarehouseSchema = z.object({
  sku: z.string().trim().min(1),
  date: z.string().trim().optional(),
  limit: numberLike.optional(),
  sort_by: z.enum(['qty_desc', 'qty_asc', 'name']).optional(),
  warehouse_ids: z.array(z.string().trim().min(2).max(64)).optional(),
})

const getSalesSummarySchema = z.object({
  sku: z.string().trim().min(1).optional(),
  warehouse_id: z.string().trim().min(2).max(64).optional(),
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
  group_by: z.enum(['warehouse', 'sku', 'sku_warehouse']).optional(),
  metric: z.enum(['units', 'revenue']).optional(),
  limit: numberLike.optional(),
})

const suggestRebalanceSchema = z.object({
  sku: z.string().trim().min(1),
  date: z.string().trim().optional(),
  max_moves: numberLike.optional(),
})

function clampNumber(value: number, min: number, max: number) {
  if (Number.isNaN(value) || !Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

export const assistantTools: ToolDefinition[] = [
  {
    name: 'get_top_skus',
    description:
      'Повертає топ SKU за продажами (одиницями або виручкою) за останні N днів по організації або окремому складу.',
    parameters: {
      type: 'object',
      properties: {
        warehouse_id: {
          type: 'string',
          description: 'ID складу. Якщо не задано — береться вся організація.',
        },
        days: {
          type: 'number',
          description: 'Глибина у днях (1..365, за замовчуванням 60).',
        },
        limit: {
          type: 'number',
          description: 'Кількість SKU у відповіді (1..50, за замовчуванням 10).',
        },
        metric: {
          type: 'string',
          enum: ['units', 'revenue'],
          description: 'Метрика сортування: одиниці чи виручка. За замовчуванням units.',
        },
      },
    },
    handler: async ({ orgId }, args) => {
      const parsed = getTopSkusSchema.parse(args ?? {})
      const days = clampNumber(parsed.days ?? 60, 1, 365)
      const limit = clampNumber(parsed.limit ?? 10, 1, 50)
      const metric = parsed.metric ?? 'units'
      const since = subDays(new Date(), days)

      const orderBy =
        metric === 'units'
          ? { _sum: { units: 'desc' as const } }
          : { _sum: { revenue: 'desc' as const } }

      const rows = (await prisma.sales_daily.groupBy({
        by: ['sku'],
        where: {
          org_id: orgId,
          ...(parsed.warehouse_id ? { warehouse_id: parsed.warehouse_id } : {}),
          date: {
            gte: since,
          },
        },
        _sum: {
          units: true,
          revenue: true,
        },
        orderBy,
        take: limit,
      })) as Array<{
        sku: string
        _sum: { units: Prisma.Decimal | null; revenue: Prisma.Decimal | null }
      }>

      return {
        warehouse_id: parsed.warehouse_id ?? null,
        metric,
        lookback_days: days,
        from: formatISO(since, { representation: 'date' }),
        to: formatISO(new Date(), { representation: 'date' }),
        items: rows.map((row) => ({
          sku: row.sku,
          units: Number(row._sum.units ?? 0),
          revenue: Number(row._sum.revenue ?? 0),
        })),
      }
    },
  },
  {
    name: 'get_sales_by_day',
    description: 'Повертає продажі (units/revenue) для кожного SKU за конкретний день.',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Дата у форматі YYYY-MM-DD. Якщо не вказано — сьогодні.',
        },
        warehouse_id: {
          type: 'string',
          description: 'ID складу. Якщо не вказано — беруться всі склади.',
        },
        limit: {
          type: 'number',
          description: 'Скільки SKU повернути (сортування за units, максимум 50).',
        },
      },
    },
    handler: async ({ orgId }, args) => {
      const parsed = getSalesByDaySchema.parse(args ?? {})
      const targetDate = parsed.date ? startOfDay(new Date(parsed.date)) : startOfDay(new Date())
      const nextDay = addDays(targetDate, 1)
      const limit = clampNumber(parsed.limit ?? 50, 1, 200)

      const rows = (await prisma.sales_daily.findMany({
        where: {
          org_id: orgId,
          date: {
            gte: targetDate,
            lt: nextDay,
          },
          ...(parsed.warehouse_id ? { warehouse_id: parsed.warehouse_id } : {}),
        },
        orderBy: {
          units: 'desc',
        },
        take: limit,
      })) as SalesDailyRow[]

      return {
        date: formatISO(targetDate, { representation: 'date' }),
        warehouse_id: parsed.warehouse_id ?? null,
        rows: rows.map((row) => ({
          sku: row.sku,
          warehouse_id: row.warehouse_id,
          units: Number(row.units ?? 0),
          revenue: Number(row.revenue ?? 0),
          channel: row.channel,
        })),
      }
    },
  },
  {
    name: 'get_stock_status',
    description:
      'Повертає поточні або історичні залишки по SKU (qty_on_hand, партії, expiry) для організації/складу.',
    parameters: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'Код SKU (обовʼязково).' },
        warehouse_id: {
          type: 'string',
          description: 'ID складу. Якщо не вказано — сумарно по всіх складах.',
        },
        date: {
          type: 'string',
          description: 'Конкретна дата (YYYY-MM-DD). Якщо не вказано — останній доступний знімок.',
        },
      },
      required: ['sku'],
    },
    handler: async ({ orgId }, args) => {
      const parsed = getStockSchema.parse(args ?? {})
      const day =
        parsed.date !== undefined ? startOfDay(new Date(parsed.date)) : undefined
      const next = day ? addDays(day, 1) : undefined

      const baseWhere = {
        org_id: orgId,
        sku: parsed.sku,
        ...(parsed.warehouse_id ? { warehouse_id: parsed.warehouse_id } : {}),
      }

      let rows: StockSnapshotRow[] = []
      if (day !== undefined) {
        rows = (await prisma.stock_snapshots.findMany({
          where: {
            ...baseWhere,
            date: {
              gte: day,
              lt: next,
            },
          },
          orderBy: { date: 'desc' },
        })) as StockSnapshotRow[]
      }

      if (!rows.length) {
        const latest = await prisma.stock_snapshots.findFirst({
          where: baseWhere,
          orderBy: { date: 'desc' },
        })
        if (latest) {
          const latestDay = startOfDay(latest.date)
          rows = (await prisma.stock_snapshots.findMany({
            where: {
              ...baseWhere,
              date: {
                gte: latestDay,
                lt: addDays(latestDay, 1),
              },
            },
            orderBy: { date: 'desc' },
          })) as StockSnapshotRow[]
        }
      }

      if (!rows.length) {
        return {
          sku: parsed.sku,
          warehouse_id: parsed.warehouse_id ?? null,
          message: 'Немає знімків залишків для вказаних параметрів.',
        }
      }

      const total = rows.reduce((sum, row) => sum + Number(row.qty_on_hand ?? 0), 0)
      const earliestExpiry = rows
        .map((row) => row.expiry_date)
        .filter(Boolean)
        .sort((a, b) => (a!.getTime() - b!.getTime()))[0]

      return {
        sku: parsed.sku,
        warehouse_id: parsed.warehouse_id ?? null,
        date: formatISO(startOfDay(rows[0].date), { representation: 'date' }),
        qty_on_hand: total,
        earliest_expiry: earliestExpiry ? earliestExpiry.toISOString() : null,
        batches: rows.map((row) => ({
          warehouse_id: row.warehouse_id,
          batch_id: row.batch_id,
          qty: Number(row.qty_on_hand ?? 0),
          expiry_date: row.expiry_date?.toISOString() ?? null,
        })),
      }
    },
  },
  {
    name: 'get_stock_by_warehouse',
    description:
      'Показує, як розподілено залишки конкретного SKU між складами (на вибрану дату або на останній знімок).',
    parameters: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'SKU, який потрібно проаналізувати.' },
        date: {
          type: 'string',
          description: 'Дата (YYYY-MM-DD). Якщо немає знімка — повертається останній доступний.',
        },
        limit: {
          type: 'number',
          description: 'Скільки складів повернути (1..200, за замовчуванням 50).',
        },
        sort_by: {
          type: 'string',
          enum: ['qty_desc', 'qty_asc', 'name'],
          description: 'Як сортувати список: за залишком (спадання/зростання) або за назвою.',
        },
        warehouse_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Опційний whitelist складів.',
        },
      },
      required: ['sku'],
    },
    handler: async ({ orgId }, args) => {
      const parsed = getStockByWarehouseSchema.parse(args ?? {})
      const limit = clampNumber(parsed.limit ?? 50, 1, 200)
      const sortBy = parsed.sort_by ?? 'qty_desc'
      const distribution = await loadStockDistribution(orgId, parsed.sku, {
        requestedDate: parsed.date,
        warehouseIds: parsed.warehouse_ids,
      })
      if (!distribution) {
        return { message: 'Немає знімків залишків для цього SKU.' }
      }
      const warehouseIds = distribution.rows.map((row) => row.warehouse_id)
      const warehouseNames = warehouseIds.length
        ? await prisma.warehouses.findMany({
            where: { id: { in: warehouseIds } },
            select: { id: true, name: true },
          })
        : []
      const nameMap = new Map(warehouseNames.map((row) => [row.id, row.name]))

      const allItems = distribution.rows.map((row) => ({
        warehouse_id: row.warehouse_id,
        warehouse_name: nameMap.get(row.warehouse_id) ?? row.warehouse_id,
        qty_on_hand: Number(row._sum.qty_on_hand ?? 0),
      }))

      allItems.sort((a, b) => {
        if (sortBy === 'name') {
          return a.warehouse_name.localeCompare(b.warehouse_name)
        }
        if (sortBy === 'qty_asc') {
          return a.qty_on_hand - b.qty_on_hand
        }
        return b.qty_on_hand - a.qty_on_hand
      })

      const items = allItems.slice(0, limit)
      const totalQty = distribution.rows.reduce(
        (sum, row) => sum + Number(row._sum.qty_on_hand ?? 0),
        0,
      )

      return {
        sku: parsed.sku,
        requested_date: parsed.date ?? null,
        effective_date: formatISO(distribution.effectiveDate, { representation: 'date' }),
        total_qty: totalQty,
        warehouse_count: distribution.rows.length,
        warehouses: items,
      }
    },
  },
  {
    name: 'get_sales_summary',
    description:
      'Агрегує продажі за період і групує їх за складом/sku (для аналізу попиту та різниці між складами).',
    parameters: {
      type: 'object',
      properties: {
        sku: {
          type: 'string',
          description: 'Опційно обмежити одним SKU. Якщо не вказано — всі SKU.',
        },
        warehouse_id: {
          type: 'string',
          description: 'Опційно обмежити одним складом. Якщо не вказано — всі склади.',
        },
        from: {
          type: 'string',
          description: 'Дата початку (YYYY-MM-DD). За замовчуванням 30 днів тому.',
        },
        to: {
          type: 'string',
          description: 'Дата кінця (YYYY-MM-DD). Включно. За замовчуванням сьогодні.',
        },
        group_by: {
          type: 'string',
          enum: ['warehouse', 'sku', 'sku_warehouse'],
          description: 'Групування результатів (за складом, SKU або їх комбінацією).',
        },
        metric: {
          type: 'string',
          enum: ['units', 'revenue'],
          description: 'Поле для сортування результатів.',
        },
        limit: {
          type: 'number',
          description: 'Скільки рядків повернути (1..200, за замовчуванням 50).',
        },
      },
    },
    handler: async ({ orgId }, args) => {
      const parsed = getSalesSummarySchema.parse(args ?? {})
      const today = startOfDay(new Date())
      const fromDate = startOfDay(safeParseDate(parsed.from) ?? subDays(today, 30))
      let toDateExclusive = addDays(startOfDay(safeParseDate(parsed.to) ?? today), 1)
      const groupBy = parsed.group_by ?? (parsed.sku ? 'warehouse' : 'sku')
      const metric = parsed.metric ?? 'units'
      const limit = clampNumber(parsed.limit ?? 50, 1, 200)

      const baseWhere = {
        org_id: orgId,
        ...(parsed.sku ? { sku: parsed.sku } : {}),
        ...(parsed.warehouse_id ? { warehouse_id: parsed.warehouse_id } : {}),
      }

      const grouping =
        groupBy === 'sku'
          ? ['sku']
          : groupBy === 'sku_warehouse'
            ? ['sku', 'warehouse_id']
            : ['warehouse_id']

      const runSummary = async (from: Date, to: Date) =>
        (await prisma.sales_daily.groupBy({
          by: grouping as any,
          where: {
            ...baseWhere,
            date: {
              gte: from,
              lt: to,
            },
          },
          _sum: {
            units: true,
            revenue: true,
          },
          orderBy:
            metric === 'revenue'
              ? { _sum: { revenue: 'desc' as const } }
              : { _sum: { units: 'desc' as const } },
          take: limit,
        })) as Array<{
          sku?: string | null
          warehouse_id?: string | null
          _sum: { units: Prisma.Decimal | null; revenue: Prisma.Decimal | null }
        }>

      let rows = await runSummary(fromDate, toDateExclusive)

      if (!rows.length && !parsed.from && !parsed.to) {
        const oldest = await prisma.sales_daily.findFirst({
          where: baseWhere,
          orderBy: { date: 'asc' },
          select: { date: true },
        })
        if (oldest?.date) {
          const fallbackStart = startOfDay(oldest.date)
          rows = await runSummary(fallbackStart, toDateExclusive)
        }
      }

      const warehouseIds =
        grouping.includes('warehouse_id')
          ? Array.from(
              new Set(rows.map((row) => row.warehouse_id).filter(Boolean) as string[]),
            )
          : []
      const warehouseNames = warehouseIds.length
        ? await prisma.warehouses.findMany({
            where: { id: { in: warehouseIds } },
            select: { id: true, name: true },
          })
        : []
      const nameMap = new Map(warehouseNames.map((row) => [row.id, row.name]))

      return {
        from: formatISO(fromDate, { representation: 'date' }),
        to: formatISO(addDays(toDateExclusive, -1), { representation: 'date' }),
        group_by: groupBy,
        metric,
        filters: {
          sku: parsed.sku ?? null,
          warehouse_id: parsed.warehouse_id ?? null,
        },
        rows: rows.map((row) => ({
          warehouse_id: row.warehouse_id ?? null,
          warehouse_name:
            row.warehouse_id && nameMap.get(row.warehouse_id)
              ? nameMap.get(row.warehouse_id)
              : row.warehouse_id ?? null,
          sku: row.sku ?? null,
          units: Number(row._sum.units ?? 0),
          revenue: Number(row._sum.revenue ?? 0),
        })),
      }
    },
  },
  {
    name: 'get_buffer_status',
    description:
      'Пояснює стан буфера ТОС для конкретного SKU і складу (поточна зона, penetration, рекомендація).',
    parameters: {
      type: 'object',
      properties: {
        sku: { type: 'string' },
        warehouse_id: { type: 'string' },
      },
      required: ['sku', 'warehouse_id'],
    },
    handler: async ({ orgId }, args) => {
      const parsed = getBufferSchema.parse(args ?? {})
      const payload = await buildExplainPayload({
        orgId,
        warehouseId: parsed.warehouse_id,
        sku: parsed.sku,
      })
      if (!payload) {
        return { message: 'Буфер для вказаного SKU не знайдено.' }
      }
      return payload
    },
  },
  {
    name: 'get_purchase_orders',
    description:
      'Повертає останні замовлення постачальникам з рядками (можна фільтрувати за статусом чи SKU).',
    parameters: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'SKU, за яким потрібно відфільтрувати рядки.' },
        status: {
          type: 'string',
          enum: ['pending', 'received', 'all'],
          description: 'Статус PO: pending (ще в дорозі), received або all.',
        },
        limit: {
          type: 'number',
          description: 'Кількість замовлень (1..50, за замовчуванням 10).',
        },
      },
    },
    handler: async ({ orgId }, args) => {
      const parsed = getPurchaseOrdersSchema.parse(args ?? {})
      const limit = clampNumber(parsed.limit ?? 10, 1, 50)
      const where: Parameters<typeof prisma.purchase_orders.findMany>[0]['where'] = {
        org_id: orgId,
      }
      if (parsed.status === 'pending') {
        where.received_at = null
      } else if (parsed.status === 'received') {
        where.received_at = { not: null }
      }

      const orders = await prisma.purchase_orders.findMany({
        where,
        orderBy: { ordered_at: 'desc' },
        take: limit,
        include: {
          purchase_order_lines: {
            where: parsed.sku ? { sku: parsed.sku } : undefined,
          },
        },
      })

      return {
        status: parsed.status ?? 'all',
        sku: parsed.sku ?? null,
        orders: orders.map((order) => ({
          po_id: order.po_id,
          supplier_id: order.supplier_id,
          ordered_at: order.ordered_at.toISOString(),
          received_at: order.received_at?.toISOString() ?? null,
          lines: order.purchase_order_lines.map((line) => ({
            sku: line.sku,
            qty: Number(line.qty),
            moq: line.moq,
            pack_size: line.pack_size,
          })),
        })),
      }
    },
  },
  {
    name: 'get_recommendations_for_sku',
    description:
      'Повертає ТОС-рекомендацію для конкретного SKU на складі (target, on_hand, suggested).',
    parameters: {
      type: 'object',
      properties: {
        warehouse_id: { type: 'string' },
        sku: { type: 'string' },
        date: {
          type: 'string',
          description: 'Дата у форматі YYYY-MM-DD. За замовчуванням — сьогодні.',
        },
      },
      required: ['warehouse_id', 'sku'],
    },
    handler: async ({ orgId }, args) => {
      const schema = z.object({
        warehouse_id: z.string().trim().min(2).max(64),
        sku: z.string().trim().min(1),
        date: z.string().trim().optional(),
      })
      const parsed = schema.parse(args ?? {})
      const date = parsed.date ?? formatISO(new Date(), { representation: 'date' })
      const { data: recs } = await getRecommendations({
        orgId,
        warehouseId: parsed.warehouse_id,
        date,
        autoRecalc: true,
        pageSize: 100,
      })
      const match = recs.find((row) => row.sku === parsed.sku)
      if (!match) {
        return { message: 'Рекомендацію для цього SKU не знайдено.' }
      }
      return { date, warehouse_id: parsed.warehouse_id, ...match }
    },
  },
  {
    name: 'suggest_rebalance',
    description:
      'Аналізує SKU по всіх складах і підказує, між якими складами можна перемістити запас (надлишки → дефіцити).',
    parameters: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'SKU для аналізу.' },
        date: {
          type: 'string',
          description:
            'Дата, на яку дивимося залишки. Якщо немає даних — використовується останній знімок.',
        },
        max_moves: {
          type: 'number',
          description: 'Максимальна кількість рекомендацій з переміщення (1..20, за замовчуванням 5).',
        },
      },
      required: ['sku'],
    },
    handler: async ({ orgId }, args) => {
      const parsed = suggestRebalanceSchema.parse(args ?? {})
      const maxMoves = clampNumber(parsed.max_moves ?? 5, 1, 20)
      const bufferRows = await prisma.buffers.findMany({
        where: {
          org_id: orgId,
          sku: parsed.sku,
        },
      })
      if (!bufferRows.length) {
        return { message: 'Для цього SKU ще не розраховані буфери ТОС.' }
      }
      const warehouseIds = bufferRows.map((row) => row.warehouse_id)
      const distribution = await loadStockDistribution(orgId, parsed.sku, {
        requestedDate: parsed.date,
        warehouseIds,
      })
      if (!distribution) {
        return { message: 'Немає актуальних знімків запасів для цього SKU.' }
      }
      const stockMap = new Map(
        distribution.rows.map((row) => [row.warehouse_id, Number(row._sum.qty_on_hand ?? 0)]),
      )
      const warehouseNames = await prisma.warehouses.findMany({
        where: { id: { in: warehouseIds } },
        select: { id: true, name: true },
      })
      const nameMap = new Map(warehouseNames.map((row) => [row.id, row.name]))

      const analysis = bufferRows.map((buffer) => {
        const onHand = stockMap.get(buffer.warehouse_id) ?? 0
        const target = Number(buffer.buffer_qty ?? 0)
        const red = Number(buffer.red_th ?? 0)
        const yellow = Number(buffer.yellow_th ?? 0)
        const penetration = target > 0 ? roundNumber(onHand / target, 2) : null
        const surplus = Math.max(0, onHand - target)
        const deficit = Math.max(0, target - onHand)
        return {
          warehouse_id: buffer.warehouse_id,
          warehouse_name: nameMap.get(buffer.warehouse_id) ?? buffer.warehouse_id,
          target,
          onHand,
          red,
          yellow,
          penetration,
          surplus,
          deficit,
          zone: resolveZoneValue(onHand, red, yellow),
        }
      })

      const surplusList = analysis
        .filter((row) => row.surplus > 0)
        .sort((a, b) => b.surplus - a.surplus)
        .map((row) => ({ ...row }))
      const deficitList = analysis
        .filter((row) => row.deficit > 0)
        .sort((a, b) => b.deficit - a.deficit)
        .map((row) => ({ ...row }))

      const moves: Array<{
        from: { warehouse_id: string; warehouse_name: string }
        to: { warehouse_id: string; warehouse_name: string }
        qty: number
        note: string
      }> = []

      let i = 0
      let j = 0
      while (moves.length < maxMoves && i < surplusList.length && j < deficitList.length) {
        const donor = surplusList[i]
        const receiver = deficitList[j]
        const qty = Math.min(donor.surplus, receiver.deficit)
        if (qty <= 0) break
        moves.push({
          from: { warehouse_id: donor.warehouse_id, warehouse_name: donor.warehouse_name },
          to: { warehouse_id: receiver.warehouse_id, warehouse_name: receiver.warehouse_name },
          qty: roundNumber(qty),
          note: `У ${donor.warehouse_name} запас > target на ${roundNumber(
            donor.surplus,
          )}, у ${receiver.warehouse_name} бракує ${roundNumber(receiver.deficit)}.`,
        })
        donor.surplus -= qty
        if (donor.surplus <= 0.01) i += 1
        receiver.deficit -= qty
        if (receiver.deficit <= 0.01) j += 1
      }

      return {
        sku: parsed.sku,
        requested_date: parsed.date ?? null,
        effective_date: formatISO(distribution.effectiveDate, { representation: 'date' }),
        warehouses: analysis.map((row) => ({
          warehouse_id: row.warehouse_id,
          warehouse_name: row.warehouse_name,
          zone: row.zone,
          target: roundNumber(row.target),
          on_hand: roundNumber(row.onHand),
          penetration: row.penetration,
          surplus: roundNumber(row.surplus),
          deficit: roundNumber(row.deficit),
        })),
        suggestions: moves,
        note:
          moves.length > 0
            ? 'Перемістіть запас із складів із надлишком до складів із дефіцитом або замовте постачання.'
            : 'Надлишків/дефіцитів, що вимагають переміщення, не виявлено.',
      }
    },
  },
]

export const openAiToolDefinitions = assistantTools.map((tool) => ({
  type: 'function' as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  },
}))

export async function executeAssistantTool(
  toolName: string,
  ctx: ToolContext,
  argsJson: string | null | undefined,
) {
  const def = assistantTools.find((tool) => tool.name === toolName)
  if (!def) {
    throw new Error(`Невідомий інструмент AI: ${toolName}`)
  }
  let parsedArgs: unknown
  try {
    parsedArgs = argsJson ? JSON.parse(argsJson) : {}
  } catch (error) {
    throw new Error(`Не вдалося розібрати аргументи для ${toolName}: ${(error as Error).message}`)
  }
  return def.handler(ctx, parsedArgs)
}

type StockGroupRow = {
  warehouse_id: string
  _sum: { qty_on_hand: Prisma.Decimal | null }
}

async function loadStockDistribution(
  orgId: string,
  sku: string,
  options: { requestedDate?: string; warehouseIds?: string[] } = {},
) {
  const baseWhere: Prisma.stock_snapshotsWhereInput = {
    org_id: orgId,
    sku,
    ...(options.warehouseIds?.length ? { warehouse_id: { in: options.warehouseIds } } : {}),
  }

  const queryRange = async (dayStart: Date) => {
    return (await prisma.stock_snapshots.groupBy({
      by: ['warehouse_id'],
      where: {
        ...baseWhere,
        date: {
          gte: dayStart,
          lt: addDays(dayStart, 1),
        },
      },
      _sum: {
        qty_on_hand: true,
      },
    })) as StockGroupRow[]
  }

  const requested = safeParseDate(options.requestedDate)
  if (requested) {
    const dayStart = startOfDay(requested)
    const rows = await queryRange(dayStart)
    if (rows.length) {
      return { effectiveDate: dayStart, rows }
    }
  }

  const latest = await prisma.stock_snapshots.findFirst({
    where: baseWhere,
    orderBy: { date: 'desc' },
  })
  if (!latest) {
    return null
  }
  const latestDay = startOfDay(latest.date)
  const latestRows = await queryRange(latestDay)
  if (!latestRows.length) {
    return null
  }
  return { effectiveDate: latestDay, rows: latestRows }
}

function safeParseDate(value?: string | null) {
  if (!value) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function resolveZoneValue(onHand: number, red: number, yellow: number): 'red' | 'yellow' | 'green' {
  if (onHand <= red) return 'red'
  if (onHand <= yellow) return 'yellow'
  return 'green'
}

function roundNumber(value: number, precision = 1) {
  const factor = Math.pow(10, precision)
  return Math.round(value * factor) / factor
}
