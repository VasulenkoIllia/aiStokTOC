import { addDays, format, formatISO, startOfDay, subDays } from 'date-fns'
import bcrypt from 'bcryptjs'
import { prisma } from '../src/db/client'
import { rebuildSalesDaily } from '../src/modules/sales/daily-builder'
import { recalcBuffers } from '../src/modules/calculations/buffers'

const ORG_ID = 'demo-org'
const DEMO_API_KEY = 'demo-org-api-key'
const SKU_COUNT = 100
const HISTORY_DAYS = 180
const CATEGORY_POOL = ['Двигун', 'Трансмісія', 'Гальмівна система', 'Підвіска', 'Електрика']
const CHANNELS = ['online', 'retail', 'service', 'b2b']
const SNAPSHOT_DAYS = 100

type SkuSegment = 'A' | 'B' | 'C'

const WAREHOUSES = [
  { id: 'WH-KYIV', name: 'Київський хаб', timezone: 'Europe/Kyiv', demandMultiplier: 1.25 },
  { id: 'WH-LVIV', name: 'Львівський склад', timezone: 'Europe/Kyiv', demandMultiplier: 0.95 },
  { id: 'WH-KHARKIV', name: 'Харківський РЦ', timezone: 'Europe/Kyiv', demandMultiplier: 1.1 },
  { id: 'WH-ODESA', name: 'Одеський сервісний центр', timezone: 'Europe/Kyiv', demandMultiplier: 0.85 },
]

const SUPPLIERS = [
  { id: 'SUP-MTR', name: 'MotorParts LLC', lead_time_days_default: 10, contact: 'ops@motorparts.example' },
  { id: 'SUP-BRK', name: 'BrakeWorks', lead_time_days_default: 8, contact: 'sales@brk.example' },
  { id: 'SUP-SUS', name: 'Suspension Group', lead_time_days_default: 12, contact: 'hello@sus.example' },
  { id: 'SUP-ELE', name: 'ElectroPro', lead_time_days_default: 7, contact: 'support@ele.example' },
]

const TODAY = formatISO(new Date(), { representation: 'date' })
const DEMO_USER = {
  email: 'demo@warehouse.ai',
  password: 'Demo1234!',
}

type SkuConfig = {
  sku: string
  name: string
  category: string
  segment: SkuSegment
  supplier_id: string
  uom: string
  shelfLifeDays: number
  baseDailyDemand: number
  price: number
  packSize: number
  moq: number
  seasonOffset: number
  stockoutChance: number
}

const SKU_CONFIG: SkuConfig[] = Array.from({ length: SKU_COUNT }).map((_, index) => {
  const supplier = SUPPLIERS[index % SUPPLIERS.length]
  const segment = resolveSegment(index, SKU_COUNT)
  const demandRange =
    segment === 'A' ? [18, 40] : segment === 'B' ? [8, 18] : [1, 8]
  const packSizeOptions = [1, 5, 10, 20]
  const packSize = packSizeOptions[randomInt(0, packSizeOptions.length - 1)]
  const baseDailyDemand = randomInt(demandRange[0], demandRange[1])
  const moq = packSize * randomInt(segment === 'A' ? 4 : segment === 'B' ? 3 : 2, 6)
  const stockoutChance = segment === 'A' ? 0.04 : segment === 'B' ? 0.08 : 0.15
  return {
    sku: `SKU-${String(index + 1).padStart(3, '0')}`,
    name: `Запчастина ${index + 1}`,
    category: CATEGORY_POOL[index % CATEGORY_POOL.length],
    segment,
    supplier_id: supplier.id,
    uom: 'шт',
    shelfLifeDays: randomInt(180, 720),
    baseDailyDemand,
    price: randomInt(200, 5000),
    packSize,
    moq,
    seasonOffset: randomInt(0, 30),
    stockoutChance,
  }
})

async function seed() {
  console.log('🔄 Truncating tables...')
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      sessions,
      users,
      recommendations,
      buffers,
      stock_snapshots,
      sales_daily,
      sales_events,
      purchase_order_lines,
      purchase_orders,
      lead_time_stats,
      catalog,
      warehouses,
      suppliers,
      orgs
    RESTART IDENTITY CASCADE
  `)

  console.log('🌱 Inserting orgs/warehouses/suppliers...')
  await prisma.orgs.create({
    data: { id: ORG_ID, name: 'Demo Org (ТОС + AI)', api_key: DEMO_API_KEY },
  })

  await prisma.warehouses.createMany({
    data: WAREHOUSES.map((wh) => ({
      id: wh.id,
      org_id: ORG_ID,
      name: wh.name,
      timezone: wh.timezone,
    })),
  })

  await prisma.suppliers.createMany({
    data: SUPPLIERS.map((sup) => ({
      id: sup.id,
      org_id: ORG_ID,
      name: sup.name,
      lead_time_days_default: sup.lead_time_days_default,
      contact: sup.contact,
    })),
  })

  console.log('👤 Creating demo admin user...')
  const passwordHash = await bcrypt.hash(DEMO_USER.password, 10)
  await prisma.users.create({
    data: {
      org_id: ORG_ID,
      email: DEMO_USER.email.toLowerCase(),
      name: 'Demo Admin',
      password_hash: passwordHash,
      role: 'admin',
    },
  })

  console.log('📦 Catalog items...')
  await prisma.catalog.createMany({
    data: SKU_CONFIG.map((item) => ({
      org_id: ORG_ID,
      sku: item.sku,
      name: item.name,
      category: item.category,
      uom: item.uom,
      shelf_life_days: item.shelfLifeDays,
    })),
    skipDuplicates: true,
  })

  console.log('🧾 Sales events (останні 6 місяців)...')
  const startDate = subDays(new Date(), HISTORY_DAYS)
  for (let offset = 0; offset < HISTORY_DAYS; offset += 1) {
    const currentDate = addDays(startDate, offset)
    const dailyEvents: Array<Parameters<typeof prisma.sales_events.createMany>[0]['data'][number]> =
      []
    for (const sku of SKU_CONFIG) {
      for (const wh of WAREHOUSES) {
        if (Math.random() < sku.stockoutChance) {
          continue
        }
        const trigBoost =
          1 + 0.15 * Math.sin(((2 * Math.PI) / 30) * (offset + sku.seasonOffset))
        const seasonalBoost = trigBoost * categorySeasonFactor(sku.category, currentDate)
        let demandMean = sku.baseDailyDemand * wh.demandMultiplier * seasonalBoost
        if (sku.segment === 'A' && Math.random() < 0.08) {
          demandMean *= 1.8
        } else if (sku.segment === 'C' && Math.random() < 0.12) {
          demandMean *= 0.6
        }
        const variation = demandMean * randomFloat(-0.3, 0.3)
        const qty = Math.max(0, Math.round(demandMean + variation))
        if (qty <= 0) continue
        dailyEvents.push({
          org_id: ORG_ID,
          order_id: `ORD-${format(currentDate, 'yyyyMMdd')}-${wh.id}-${sku.sku}`,
          line_id: '1',
          order_datetime: currentDate,
          sku: sku.sku,
          qty,
          net_amount: Number((qty * sku.price).toFixed(2)),
          unit_price: sku.price,
          warehouse_id: wh.id,
          channel: pick(CHANNELS),
          status: 'completed',
        })
      }
    }
    if (dailyEvents.length) {
      await prisma.sales_events.createMany({ data: dailyEvents })
    }
  }

  console.log(`📦 Stock snapshots (останні ${SNAPSHOT_DAYS} днів)...`)
  const snapshotStart = startOfDay(subDays(new Date(), SNAPSHOT_DAYS - 1))
  const todayKey = startOfDay(new Date()).getTime()
  const todayTotals = new Map<string, number>()
  for (let offset = 0; offset < SNAPSHOT_DAYS; offset += 1) {
    const snapshotDate = startOfDay(addDays(snapshotStart, offset))
    const stockSnapshots: Array<
      Parameters<typeof prisma.stock_snapshots.createMany>[0]['data'][number]
    > = []
    for (const sku of SKU_CONFIG) {
      for (const wh of WAREHOUSES) {
        const seasonFactor = categorySeasonFactor(sku.category, snapshotDate)
        const range = SEGMENT_DOS_RANGE[sku.segment]
        let daysOfSupply = randomInt(range[0], range[1])
        const roll = Math.random()
        if (roll < 0.2) {
          daysOfSupply = randomInt(0, 3)
        } else if (roll > 0.85) {
          daysOfSupply = randomInt(range[1] + 5, range[1] + 25)
        }
        const baseStock = sku.baseDailyDemand * daysOfSupply * wh.demandMultiplier * seasonFactor
        const qty = Math.max(0, Math.round(baseStock + baseStock * randomFloat(-0.25, 0.25)))
        stockSnapshots.push({
          org_id: ORG_ID,
          date: snapshotDate,
          sku: sku.sku,
          warehouse_id: wh.id,
          qty_on_hand: qty,
          batch_id: `BATCH-${sku.sku}-${wh.id}`,
          expiry_date:
            sku.shelfLifeDays > 0
              ? addDays(snapshotDate, randomInt(30, sku.shelfLifeDays))
              : null,
        })
        if (snapshotDate.getTime() === todayKey) {
          const current = todayTotals.get(sku.sku) ?? 0
          todayTotals.set(sku.sku, current + qty)
        }
      }
    }
    await prisma.stock_snapshots.createMany({ data: stockSnapshots })
  }

  console.log('📦 Purchase orders...')
  type PendingPO = {
    poId: string
    supplier_id: string
    ordered_at: Date
    received_at: Date | null
    lines: Array<{ sku: string; qty: number; moq: number; pack_size: number }>
  }
  const supplierOrders = new Map<string, PendingPO>()
  let poSequence = 1
  for (const sku of SKU_CONFIG) {
    const onHand = todayTotals.get(sku.sku) ?? 0
    const preferredStock = sku.baseDailyDemand * SEGMENT_TARGET_DOS[sku.segment]
    if (onHand > preferredStock * 0.8) continue
    const supplierId = sku.supplier_id
    let record = supplierOrders.get(supplierId)
    if (!record) {
      const orderedAt = subDays(new Date(), randomInt(1, 14))
      const receivedAt =
        Math.random() < 0.35 ? addDays(orderedAt, randomInt(5, 15)) : null
      record = {
        poId: `PO-${supplierId}-${String(poSequence).padStart(3, '0')}`,
        supplier_id: supplierId,
        ordered_at: orderedAt,
        received_at: receivedAt,
        lines: [],
      }
      supplierOrders.set(supplierId, record)
      poSequence += 1
    }
    const packs = randomInt(1, 4)
    const qty = Math.max(sku.moq, sku.packSize * packs * randomInt(1, 3))
    record.lines.push({
      sku: sku.sku,
      qty,
      moq: sku.moq,
      pack_size: sku.packSize,
    })
  }

  if (!supplierOrders.size) {
    const fallbackSku = SKU_CONFIG[0]
    const supplierId = fallbackSku.supplier_id
    supplierOrders.set(supplierId, {
      poId: `PO-${supplierId}-${String(poSequence).padStart(3, '0')}`,
      supplier_id: supplierId,
      ordered_at: subDays(new Date(), 3),
      received_at: null,
      lines: [
        {
          sku: fallbackSku.sku,
          qty: fallbackSku.moq * 2,
          moq: fallbackSku.moq,
          pack_size: fallbackSku.packSize,
        },
      ],
    })
  }

  const purchaseOrders: Parameters<typeof prisma.purchase_orders.createMany>[0]['data'] = []
  const purchaseOrderLines: Parameters<typeof prisma.purchase_order_lines.createMany>[0]['data'] =
    []

  for (const record of supplierOrders.values()) {
    const limitedLines = record.lines.slice(0, 6)
    purchaseOrders.push({
      org_id: ORG_ID,
      po_id: record.poId,
      supplier_id: record.supplier_id,
      ordered_at: record.ordered_at,
      received_at: record.received_at,
    })
    limitedLines.forEach((line) => {
      purchaseOrderLines.push({
        org_id: ORG_ID,
        po_id: record.poId,
        sku: line.sku,
        qty: line.qty,
        moq: line.moq,
        pack_size: line.pack_size,
      })
    })
  }

  if (purchaseOrders.length) {
    await prisma.purchase_orders.createMany({ data: purchaseOrders })
  }
  if (purchaseOrderLines.length) {
    await prisma.purchase_order_lines.createMany({ data: purchaseOrderLines })
  }

  console.log('📊 Rebuilding sales_daily & buffers...')
  const historyFrom = formatISO(subDays(new Date(), HISTORY_DAYS), { representation: 'date' })
  await rebuildSalesDaily({ orgId: ORG_ID, from: historyFrom, to: TODAY })
  for (const wh of WAREHOUSES) {
    await recalcBuffers({ orgId: ORG_ID, warehouseId: wh.id })
  }

  console.log('✅ Seed completed.')
  console.log(`   Org: ${ORG_ID}`)
  console.log(`   Admin login: ${DEMO_USER.email} / ${DEMO_USER.password}`)
  console.log(`   API key: ${DEMO_API_KEY}`)
  console.log(`   Warehouses: ${WAREHOUSES.length}, SKU: ${SKU_COUNT}, історія: ${HISTORY_DAYS} днів`)
  await prisma.$disconnect()
  process.exit(0)
}

seed().catch((err) => {
  console.error(err)
  prisma.$disconnect().finally(() => process.exit(1))
})

function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomFloat(min: number, max: number) {
  return Math.random() * (max - min) + min
}

function pick<T>(values: T[]) {
  return values[Math.floor(Math.random() * values.length)]
}

function resolveSegment(index: number, total: number): SkuSegment {
  const ratio = index / total
  if (ratio < 0.2) return 'A'
  if (ratio < 0.6) return 'B'
  return 'C'
}

function categorySeasonFactor(category: string, date: Date) {
  const month = date.getMonth() + 1
  switch (category) {
    case 'Двигун':
      return month === 12 || month <= 2 ? 1.2 : month >= 6 && month <= 8 ? 0.85 : 1
    case 'Підвіска':
      return month >= 3 && month <= 5 ? 1.15 : 1
    case 'Гальмівна система':
      return month >= 9 && month <= 10 ? 1.12 : 1
    case 'Електрика':
      return month >= 11 || month <= 1 ? 1.1 : 0.95
    default:
      return 1
  }
}

const SEGMENT_DOS_RANGE: Record<SkuSegment, [number, number]> = {
  A: [15, 35],
  B: [10, 25],
  C: [6, 15],
}

const SEGMENT_TARGET_DOS: Record<SkuSegment, number> = {
  A: 30,
  B: 22,
  C: 14,
}
